import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocalSandbox, type ToolExecutionContext } from "@node-agent-runtime/core";
import {
  McpRegistry,
  McpResourceError,
  MCP_RESOURCE_MARKER,
  mcpResourceToolName,
  resourceText,
  type McpCallToolResult,
  type McpReadResourceResult,
  type McpResourceMeta,
  type McpServerHandle,
  type McpToolMeta,
} from "@node-agent-runtime/mcp";

/**
 * Hand-rolled `McpServerHandle`: the registry only ever talks through this
 * interface, so registry-level behavior (naming, declared-URI guard, caps,
 * search) is testable without a transport.
 */
class FakeServer implements McpServerHandle {
  readonly name: string;
  closed = false;
  readonly reads: string[] = [];

  constructor(
    name: string,
    private readonly tools: McpToolMeta[] = [],
    private readonly resources: McpResourceMeta[] = [],
    private readonly payloads: Record<string, McpReadResourceResult> = {},
  ) {
    this.name = name;
  }

  async connect(): Promise<void> {}
  async listTools(): Promise<McpToolMeta[]> {
    return this.tools;
  }
  async callTool(name: string): Promise<McpCallToolResult> {
    return { content: [{ type: "text", text: `called ${name}` }] };
  }
  async listResources(): Promise<McpResourceMeta[]> {
    return this.resources;
  }
  async readResource(uri: string): Promise<McpReadResourceResult> {
    this.reads.push(uri);
    const payload = this.payloads[uri];
    if (!payload) throw new Error(`unknown resource: ${uri}`);
    return payload;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

const RESOURCES: McpResourceMeta[] = [
  { uri: "file:///README.md", name: "README", description: "项目说明", mimeType: "text/markdown" },
  { uri: "file:///config.json", name: "config", mimeType: "application/json" },
];

const PAYLOADS: Record<string, McpReadResourceResult> = {
  "file:///README.md": {
    contents: [{ uri: "file:///README.md", mimeType: "text/markdown", text: "# 标题\n只读内容" }],
  },
  "file:///config.json": {
    contents: [{ uri: "file:///config.json", mimeType: "application/json", text: '{"a":1}' }],
  },
};

function docs() {
  return new FakeServer(
    "docs",
    [{ name: "search", description: "search the docs" }],
    RESOURCES,
    PAYLOADS,
  );
}

function ctx(): ToolExecutionContext {
  return { conversationId: "c", runId: "r", now: () => new Date(0) };
}

describe("M7-6b — McpRegistry resources (m7-base-governance §5-3)", () => {
  it("lists a server's declared resources with their materialized tool name", async (t) => {
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    await registry.register(docs());

    const listed = registry.listResources();
    assert.deepEqual(
      listed.map((r) => r.uri),
      ["file:///README.md", "file:///config.json"],
    );
    assert.equal(listed[0]?.server, "docs");
    assert.ok(listed[0]?.toolName?.startsWith("mcp__docs__resource__"));
    // narrowing to one server works, unknown server yields nothing
    assert.equal(registry.listResources("docs").length, 2);
    assert.deepEqual(registry.listResources("nope"), []);
  });

  it("materializes resources as read-only tools whose URI is fixed", async (t) => {
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    await registry.register(docs());

    const names = registry.tools().map((tool) => tool.name);
    const resourceTools = names.filter((n) => n.includes(`__${MCP_RESOURCE_MARKER}`));
    assert.equal(resourceTools.length, 2);

    const readme = registry.get(mcpResourceToolName("docs", "file:///README.md"))!;
    // 保守敏感度：资源读取按 network-read 走既有 gate / sandbox（非 harmless）
    assert.equal(readme.meta?.kind, "network-read");
    assert.equal(await readme.execute({}, ctx()), "# 标题\n只读内容");
    assert.equal(
      await registry.get(mcpResourceToolName("docs", "file:///config.json"))!.execute({}, ctx()),
      '{"a":1}',
    );
  });

  it("derives resource tool names deterministically and without collisions", () => {
    const a = mcpResourceToolName("docs", "file:///README.md");
    assert.equal(a, mcpResourceToolName("docs", "file:///README.md"));
    assert.notEqual(a, mcpResourceToolName("docs", "file:///README.MD?x=1"));
    // only characters a tool name may carry
    assert.match(a.slice("mcp__docs__".length), /^[a-z0-9_]+$/);
  });

  it("reads a declared resource and rejects an undeclared (越权) URI", async (t) => {
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    const server = docs();
    await registry.register(server);

    const read = await registry.readResource("file:///README.md");
    assert.equal(read.server, "docs");
    assert.equal(read.contents[0]?.text, "# 标题\n只读内容");

    // 越权：URI 未经 resources/list 声明（模型幻觉 / 提示注入都可能走到这里）
    await assert.rejects(
      () => registry.readResource("file:///etc/shadow"),
      (err: Error) => {
        assert.ok(err instanceof McpResourceError);
        assert.match(err.message, /未被声明/);
        return true;
      },
    );
    await assert.rejects(() => registry.readResource("   "), McpResourceError);
    // nothing was forwarded to the server for the rejected URIs
    assert.deepEqual(server.reads, ["file:///README.md"]);
  });

  it("routes resource reads through the existing sandbox (network deny ⇒ 拒绝)", async (t) => {
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    await registry.register(docs());

    const sandbox = new LocalSandbox({ timeoutMs: 0 });
    const handle = await sandbox.begin(
      "workspace-write",
      { workspace: "/tmp", writablePaths: [], network: "deny" },
    );
    const guarded = handle.wrap(registry.get(mcpResourceToolName("docs", "file:///README.md"))!);
    await assert.rejects(() => guarded.execute({}, ctx()), /沙箱已禁网/);

    // 放行网络后即可读（走既有 gate / sandbox 链路，未新增旁路）
    const open = await sandbox.begin(
      "workspace-write",
      { workspace: "/tmp", writablePaths: [], network: "allowlist", networkAllowlist: ["*"] },
    );
    const allowed = open.wrap(registry.get(mcpResourceToolName("docs", "file:///README.md"))!);
    assert.equal(await allowed.execute({}, ctx()), "# 标题\n只读内容");
  });

  it("honours resourceTools: false — no tool, but reads still work", async (t) => {
    const registry = new McpRegistry({ resourceTools: false });
    t.after(() => registry.closeAll());
    await registry.register(docs());

    assert.deepEqual(
      registry.tools().map((tool) => tool.name),
      ["mcp__docs__search"],
    );
    assert.equal(registry.listResources()[0]?.toolName, undefined);
    const read = await registry.readResource("file:///config.json");
    assert.equal(read.contents[0]?.text, '{"a":1}');
  });

  it("caps materialized resource tools so a huge catalog cannot blow up the surface", async (t) => {
    const many: McpResourceMeta[] = Array.from({ length: 7 }, (_, i) => ({
      uri: `file:///f${i}.txt`,
      name: `f${i}`,
    }));
    const registry = new McpRegistry({ maxResourceTools: 2 });
    t.after(() => registry.closeAll());
    await registry.register(new FakeServer("big", [], many, {}));

    const resourceTools = registry
      .tools()
      .filter((tool) => tool.name.includes(`__${MCP_RESOURCE_MARKER}`));
    assert.equal(resourceTools.length, 2);
    // 声明域仍是完整的 7 条：未被物化的资源依旧可按 URI 读取
    assert.equal(registry.listResources().length, 7);
    assert.equal(registry.listResources().filter((r) => r.toolName).length, 2);
  });

  it("drops resource tools on unregister", async (t) => {
    const registry = new McpRegistry();
    await registry.register(docs());
    assert.equal(registry.tools().length, 3);
    await registry.unregister("docs");
    assert.equal(registry.tools().length, 0);
    assert.deepEqual(registry.listResources(), []);
  });

  it("searchTools ranks the catalog (tools + resource tools) and is query-safe", async (t) => {
    const registry = new McpRegistry();
    t.after(() => registry.closeAll());
    await registry.register(docs());

    const hits = registry.searchTools("readme");
    assert.ok(hits.length >= 1);
    assert.ok(hits[0]!.name.includes(`__${MCP_RESOURCE_MARKER}`));
    assert.equal(registry.searchTools("search")[0]?.name, "mcp__docs__search");
    // 空查询 / 无命中：不抛错
    assert.deepEqual(registry.searchTools("   "), []);
    assert.deepEqual(registry.searchTools("绝对不存在的东西"), []);
    // 索引随注册变化而失效重建
    await registry.register(new FakeServer("wiki", [{ name: "lookup" }], [], {}));
    assert.ok(registry.searchTools("lookup").some((entry) => entry.name === "mcp__wiki__lookup"));
  });
});

describe("M7-6b — resourceText (pure)", () => {
  it("flattens text contents and reports empty resources", () => {
    assert.equal(
      resourceText({
        contents: [
          { uri: "a", text: "one" },
          { uri: "b", text: "two" },
        ],
      }),
      "one\ntwo",
    );
    assert.equal(resourceText({ contents: [] }), "（资源无文本内容）");
    assert.equal(resourceText(undefined), "（资源无文本内容）");
  });

  it("decodes text-ish blobs but keeps binary out of the context", () => {
    const json = Buffer.from('{"ok":true}', "utf8").toString("base64");
    assert.equal(
      resourceText({ contents: [{ uri: "a", mimeType: "application/json", blob: json }] }),
      '{"ok":true}',
    );
    const png = resourceText({
      contents: [{ uri: "a", mimeType: "image/png", blob: "AAAA" }],
    });
    assert.match(png, /二进制资源 image\/png/);
  });

  it("caps resource text (context governance, M7-1)", () => {
    const long = "x".repeat(100);
    const out = resourceText({ contents: [{ uri: "a", text: long }] }, 10);
    assert.equal(out.startsWith("xxxxxxxxxx"), true);
    assert.match(out, /已截断：共 100 字符，上限 10/);
  });
});
