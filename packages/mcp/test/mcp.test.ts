import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { AddressInfo } from "node:net";

import {
  Agent,
  AgentRuntime,
  MemoryStorage,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RuntimeEvent,
} from "@agent-runtime/core";
import { SessionManager } from "@agent-runtime/host";
import {
  McpClient,
  McpConnectionError,
  McpError,
  McpRegistry,
  McpTimeoutError,
  StdioTransport,
  StreamableHttpTransport,
  mcpToolName,
  normalizeSchema,
  parseMcpToolName,
  pathArgKeysOf,
} from "@agent-runtime/mcp";

// ------------------------------------------------------- test doubles

function toolCallResp(name: string, args: Record<string, unknown>): ModelResponse {
  return {
    content: `调用 ${name}`,
    toolCalls: [{ id: `call_${Math.random()}`, name, arguments: JSON.stringify(args) }],
    finishReason: "tool_calls",
    usage: { inputTokens: 2, outputTokens: 2 },
  };
}

function finalResp(text: string): ModelResponse {
  return {
    content: text,
    toolCalls: [],
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

class ScriptedProvider implements ModelProvider {
  readonly id = "script";
  readonly label = "scripted test model";
  calls = 0;
  constructor(private readonly script: Array<() => ModelResponse>) {}
  async chat(_request: ModelRequest): Promise<ModelResponse> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls += 1;
    return step();
  }
}

/** Independent "server-side" tool list (mirrors the stdio fixture). */
const REMOTE_TOOLS = [
  {
    name: "echo",
    description: "echo text back",
    inputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "EchoArgs",
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "sum two integers",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "integer" },
        b: { type: "integer" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "fail",
    description: "always business-fails",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "write_note",
    description: "remote note writer (has a path arg)",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
];

/** Build a JSON-RPC response envelope as the *server* would. */
function answerRequest(
  msg: {
    id?: unknown;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  },
  serverName: string,
  version: string,
): Record<string, unknown> | undefined {
  if (msg.id === undefined) return undefined; // notification
  const id = msg.id;
  try {
    let result: Record<string, unknown>;
    switch (msg.method) {
      case "initialize":
        result = {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: serverName, version: "1.0.0" },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: REMOTE_TOOLS };
        break;
      case "tools/call": {
        const name = msg.params?.name ?? "";
        const args = msg.params?.arguments ?? {};
        if (name === "echo") {
          result = { content: [{ type: "text", text: `echo: ${String(args.text ?? "")}` }] };
        } else if (name === "add") {
          result = { content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] };
        } else if (name === "fail") {
          result = { content: [{ type: "text", text: "远端拒绝：故意的失败" }], isError: true };
        } else if (name === "write_note") {
          result = { content: [{ type: "text", text: `note@${String(args.path)}` }] };
        } else {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `unknown tool: ${name}` },
          };
        }
        break;
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${msg.method}` },
        };
    }
    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: String(err) },
    };
  }
}

/**
 * Start an in-process mock MCP server over Streamable HTTP.
 * Behavior switches come from request headers:
 *   x-mcp-return: "sse" | "json"   (default sse)
 *   x-mcp-delay-ms: <ms>          hold tools/call replies (timeout tests)
 */
function mockHttpServer(t: { after: (fn: () => void) => void }, name = "mock-http-server") {
  let overrideVersion: string | undefined;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.on("error", () => {}); // swallow ECONNRESET once the client timed out
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
    });
    req.on("end", () => {
      let msg: {
        id?: unknown;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      try {
        msg = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "parse error" },
          }),
        );
        return;
      }
      if (msg.id === undefined) {
        // notification -> 202 Accepted, no body
        res.writeHead(202, { "content-type": "application/json" });
        res.end();
        return;
      }
      const send = () => {
        const version = overrideVersion ?? "2024-11-05";
        const payload = answerRequest(msg, name, version);
        const mode = String(req.headers["x-mcp-return"] ?? "sse");
        if (mode === "json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        } else {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        }
      };
      const delay = msg.method === "tools/call" ? Number(req.headers["x-mcp-delay-ms"] ?? 0) : 0;
      if (delay > 0) setTimeout(send, delay);
      else send();
    });
  });
  return new Promise<{ url: string; setVersion: (v: string) => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      t.after(() => new Promise<void>((done) => server.close(() => done())));
      resolve({
        url: `http://127.0.0.1:${port}/mcp`,
        setVersion: (v) => {
          overrideVersion = v;
        },
      });
    });
  });
}

function httpClient(name: string, url: string, extra: Record<string, string> = {}) {
  return new McpClient({
    name,
    transport: new StreamableHttpTransport({ url, headers: extra, requestTimeoutMs: 500 }),
  });
}

const STDOUT_FIXTURE = fileURLToPath(new URL("./fixtures/mock-mcp-server.mjs", import.meta.url));

function stdioClient(name: string, requestTimeoutMs = 2_000) {
  return new McpClient({
    name,
    transport: new StdioTransport({ args: [STDOUT_FIXTURE], requestTimeoutMs }),
  });
}

// ---------------------------------------------------------------- tests

describe("normalizeSchema / pathArgKeysOf (§5.3 protocol translation)", () => {
  it("keeps only the engine's schema fields, recursively", () => {
    const out = normalizeSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "T",
      type: "object",
      properties: {
        text: { type: "string", default: "hi" },
        nested: { $ref: "#/defs/x" },
      },
    })!;
    assert.equal((out as Record<string, unknown>).$schema, undefined);
    assert.equal((out as Record<string, unknown>).title, undefined);
    assert.equal(out.type, "object");
    assert.ok(out.properties?.text);
    assert.equal((out.properties!.text as Record<string, unknown>).default, undefined);
    assert.equal((out.properties!.text as Record<string, unknown>).$ref, undefined);
  });
  it("detects path-bearing argument keys from a schema", () => {
    const inputSchema = {
      type: "object",
      properties: { path: {}, filename: {}, count: {} },
    } as Record<string, unknown>;
    assert.deepEqual(pathArgKeysOf(inputSchema), ["path", "filename"]);
  });
});

describe("McpClient over Streamable HTTP (§5.3 transport)", () => {
  it("handshakes, lists and calls tools over SSE replies", async (t) => {
    const { url } = await mockHttpServer(t);
    const client = httpClient("httpd", url);
    t.after(() => client.close());
    await client.connect();
    assert.equal(client.serverInfo?.name, "mock-http-server");
    assert.equal(client.negotiatedProtocolVersion, "2024-11-05");
    const tools = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["echo", "add", "fail", "write_note"],
    );
    const res = await client.callTool("add", { a: 40, b: 2 });
    assert.equal(res.content[0].text, "42");
  });

  it("understands plain-JSON replies too", async (t) => {
    const { url } = await mockHttpServer(t);
    const client = httpClient("httpd-json", url, { "x-mcp-return": "json" });
    t.after(() => client.close());
    await client.connect();
    const res = await client.callTool("echo", { text: "json-ok" });
    assert.equal(res.content[0].text, "echo: json-ok");
  });

  it("surfaces remote JSON-RPC errors as McpError", async (t) => {
    const { url } = await mockHttpServer(t);
    const client = httpClient("httpd-err", url);
    t.after(() => client.close());
    await client.connect();
    await assert.rejects(
      () => client.callTool("nope", {}),
      (err: Error) => {
        assert.ok(err instanceof McpError);
        assert.equal((err as McpError).remote, true);
        return true;
      },
    );
  });

  it("times out when a tools/call exceeds the deadline", async (t) => {
    const { url } = await mockHttpServer(t);
    const client = new McpClient({
      name: "httpd-slow",
      transport: new StreamableHttpTransport({
        url,
        headers: { "x-mcp-delay-ms": "400" },
        requestTimeoutMs: 80,
      }),
    });
    t.after(() => client.close());
    await client.connect(); // initialize answers promptly
    await assert.rejects(() => client.callTool("echo", { text: "hi" }), McpTimeoutError);
  });

  it("rejects a server that negotiates an unsupported protocol version", async (t) => {
    const { url, setVersion } = await mockHttpServer(t);
    setVersion("2023-06-10");
    const client = httpClient("httpd-old", url);
    t.after(() => client.close());
    await assert.rejects(() => client.connect(), McpError);
  });
});

describe("McpClient over stdio (real child process)", () => {
  it("handshakes, lists and calls a real subprocess server", async (t) => {
    const client = stdioClient("stdio");
    t.after(() => client.close());
    await client.connect();
    assert.equal(client.serverInfo?.name, "mock-stdio-server");
    const tools = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["echo", "add", "fail", "write_note"],
    );
    const echo = await client.callTool("echo", { text: "来自子进程" });
    assert.equal(echo.content[0].text, "echo: 来自子进程");
    assert.equal((await client.callTool("add", { a: 1, b: 2 })).content[0].text, "3");
    const failed = await client.callTool("fail", {});
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /故意的失败/);
  });

  it("rejects tool calls issued before connect", async () => {
    const client = stdioClient("stdio-early");
    await assert.rejects(() => client.listTools(), McpConnectionError);
    await client.close();
  });
});

describe("McpRegistry — materialization into local tools (§5.3)", () => {
  it("registers a server and yields prefixed, schema-normalized tools", async (t) => {
    const { url } = await mockHttpServer(t, "math-server");
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    const registered = await registry.register(httpClient("math-server", url));
    assert.equal(registered.tools.length, 4);
    assert.deepEqual(
      registry.tools().map((tool) => tool.name),
      [
        "mcp__math-server__echo",
        "mcp__math-server__add",
        "mcp__math-server__fail",
        "mcp__math-server__write_note",
      ],
    );
    // schema normalized: no $schema/title survived into the local definition
    const echo = registry.get("mcp__math-server__echo")!;
    const params = echo.parameters as Record<string, unknown>;
    assert.equal(params.$schema, undefined);
    assert.equal(params.title, undefined);
    assert.equal(echo.meta?.kind, "harmless");
    assert.equal(registry.get("mcp__math-server__write_note")?.meta?.kind, "write");
    assert.deepEqual(registry.get("mcp__math-server__write_note")?.meta?.pathArgs, ["path"]);
    // name round-trips
    assert.deepEqual(parseMcpToolName("mcp__math-server__echo"), {
      server: "math-server",
      tool: "echo",
    });
    assert.deepEqual(parseMcpToolName(mcpToolName("a", "b")), { server: "a", tool: "b" });
    assert.equal(
      registry.resolve({ server: "math-server", tool: "add" })?.name,
      "mcp__math-server__add",
    );
    assert.equal(registry.resolve({ server: "math-server", tool: "missing" }), undefined);
  });

  it("re-registering the same server name is idempotent", async (t) => {
    const { url } = await mockHttpServer(t, "once");
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    const client = httpClient("once", url);
    const first = await registry.register(client);
    const second = await registry.register(client);
    assert.equal(registry.tools().length, 4);
    assert.equal(first, second);
  });

  it("executes remote tools through their materialized definition", async (t) => {
    const { url } = await mockHttpServer(t, "exec-server");
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    await registry.register(httpClient("exec-server", url));
    const add = registry.get("mcp__exec-server__add")!;
    assert.equal(await add.execute({ a: 20, b: 22 }, ctx()), "42");
    const echo = registry.get("mcp__exec-server__echo")!;
    assert.equal(await echo.execute({ text: "执行" }, ctx()), "echo: 执行");
    // business-level isError -> execute throws so the model can self-correct
    const fail = registry.get("mcp__exec-server__fail")!;
    await assert.rejects(() => fail.execute({}, ctx()), /故意的失败/);
  });

  it("unregister closes the server and drops its tools", async (t) => {
    const { url } = await mockHttpServer(t, "bye");
    const registry = new McpRegistry();
    await registry.register(httpClient("bye", url));
    assert.ok(registry.has("bye"));
    assert.equal(registry.tools().length, 4);
    await registry.unregister("bye");
    assert.equal(registry.has("bye"), false);
    assert.equal(registry.tools().length, 0);
    // double unregister is safe
    await registry.unregister("bye");
    await registry.closeAll();
  });
});

// ------------------------------------------------ M4 acceptance (§11)

describe("M4 acceptance — mock MCP server's tools callable by the model", () => {
  it("agent over the runtime can call a materialized MCP tool (stdio, end to end)", async (t) => {
    const registry = new McpRegistry();
    const client = stdioClient("demo-server");
    t.after(() => registry.closeAll());
    await registry.register(client);

    const agent = new Agent({
      name: "demo",
      tools: registry.tools(),
    });
    const provider = new ScriptedProvider([
      () => toolCallResp("mcp__demo-server__echo", { text: "hello from MCP" }),
      () => finalResp("回声收到"),
    ]);
    const runtime = new AgentRuntime({ provider });
    const events: RuntimeEvent[] = [];
    runtime.subscribe((e) => events.push(e));

    const run = await runtime.run({ agent, input: "帮我 echo hello from MCP" });
    assert.equal(run.output, "回声收到");
    assert.ok(
      events.some(
        (e) => e.type === "tool:end" && e.toolCall.name === "mcp__demo-server__echo" && e.ok,
      ),
    );
    const toolTurn = run.messages.find((m) => m.role === "tool") as { content: string } | undefined;
    assert.equal(toolTurn?.content, "echo: hello from MCP");
  });

  it("host SessionManager governance lets a harmless MCP tool through", async (t) => {
    const registry = new McpRegistry();
    const client = stdioClient("host-server");
    t.after(() => registry.closeAll());
    await registry.register(client);

    const agent = new Agent({ name: "hosted", tools: registry.tools() });
    const provider = new ScriptedProvider([
      () => toolCallResp("mcp__host-server__add", { a: 7, b: 6 }),
      () => finalResp("和为 13"),
    ]);
    const runtime = new AgentRuntime({ provider });
    const storage = new MemoryStorage();
    const manager = new SessionManager({ runtime, storage, agents: [agent] });
    const session = await manager.createSession({ agentId: "hosted" });
    const out = await manager.chat(session.id, "帮我算 7+6");
    assert.equal(out.task.status, "done");
    assert.equal(out.run.output, "和为 13");
  });
});

function ctx() {
  return {
    conversationId: "c",
    runId: "r",
    now: () => new Date(0),
  } as unknown as import("@agent-runtime/core").ToolExecutionContext;
}
