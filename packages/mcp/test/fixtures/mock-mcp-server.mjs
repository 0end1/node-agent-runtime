/**
 * A self-contained MCP stdio server used by the M4 test suite.
 *
 * Deliberately independent: it implements JSON-RPC framing + the handful of
 * MCP methods it answers *by hand* (no shared code with the client under
 * test), so the round trip genuinely exercises the wire protocol.
 *
 * Speaks: initialize, notifications/initialized, tools/list, tools/call, ping.
 */
import { createInterface } from "node:readline";

const SERVER_INFO = { name: "mock-stdio-server", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "echo",
    description: "把传入的 text 原样返回（前缀 echo: ）",
    inputSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "EchoArgs",
      type: "object",
      properties: { text: { type: "string", description: "要回显的文本" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "两个整数相加",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "integer", description: "第一个加数" },
        b: { type: "integer", description: "第二个加数" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "fail",
    description: "总是报告业务错误（isError）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "write_note",
    description: "把文本追加写为一条 note（含文件路径参数，测试越界用）",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "目标路径" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
];

function methodNotFound(name) {
  return { code: -32601, message: `method not found: ${name}` };
}

function invokeTool(name, args) {
  if (name === "echo") {
    return { content: [{ type: "text", text: `echo: ${String(args?.text ?? "")}` }] };
  }
  if (name === "add") {
    const sum = Number(args?.a) + Number(args?.b);
    return { content: [{ type: "text", text: String(sum) }] };
  }
  if (name === "fail") {
    return { content: [{ type: "text", text: "远端拒绝：这是故意的失败" }], isError: true };
  }
  if (name === "write_note") {
    return {
      content: [{ type: "text", text: `note written at ${String(args?.path)}` }],
      isError: true, // mock 不真正落盘，模拟远端越界/失败语义
    };
  }
  return methodNotFound(name);
}

function handle(msg) {
  if (msg === null || typeof msg !== "object") return;
  if (msg.id === undefined) return; // notification（initialize 后的 initialized 等）
  const { id, method = "", params = {} } = msg;
  try {
    let result;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        result = invokeTool(params?.name, params?.arguments);
        break;
      }
      default:
        throw methodNotFound(method);
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  } catch (err) {
    const e = err?.code ? err : { code: -32603, message: String(err?.message ?? err) };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: e }) + "\n");
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(msg);
});

// Logs go to stderr (never stdout — stdout is the protocol channel).
process.stderr.write(`mock-mcp-server ready (${PROTOCOL_VERSION})\n`);
