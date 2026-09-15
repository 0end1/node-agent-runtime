import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Agent,
  AgentRuntime,
  type AnyTool,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RawToolCall,
  type RuntimeEvent,
  type StepSnapshot,
  type StepStartEvent,
  type ToolEndEvent,
} from "@node-agent-runtime/core";

function echoTool(name: string, description = `tool ${name}`): AnyTool {
  return { name, description, execute: async () => `ran ${name}` };
}

function rawCall(id: string, name: string, args: Record<string, unknown>): RawToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

/** 可脚本化的 provider：按队列返回响应，并记录本轮回传给模型的工具。 */
class ScriptedProvider implements ModelProvider {
  id = "scripted";
  label = "scripted";
  lastTools?: readonly AnyTool[];
  private queue: ModelResponse[] = [];
  push(resp: ModelResponse): void {
    this.queue.push(resp);
  }
  async chat(req: ModelRequest): Promise<ModelResponse> {
    this.lastTools = req.tools;
    return this.queue.shift() ?? { content: "done", toolCalls: [], finishReason: "stop" };
  }
}

const isStepStart = (e: RuntimeEvent): e is StepStartEvent => e.type === "step:start";
const isToolEnd = (e: RuntimeEvent): e is ToolEndEvent => e.type === "tool:end";

describe("M7-6a 检索式工具声明", () => {
  it("默认关闭：全量声明，无 tool_search，declaredTools=全部", async () => {
    const tools = [echoTool("a"), echoTool("b"), echoTool("c")];
    const provider = new ScriptedProvider();
    provider.push({ content: "done", toolCalls: [], finishReason: "stop" });
    const rt = new AgentRuntime({ provider });
    const events: RuntimeEvent[] = [];
    const off = rt.subscribe((e) => events.push(e));
    try {
      await rt.run({ agent: new Agent({ name: "x", tools }), input: "hi" });
    } finally {
      off();
    }
    assert.equal(provider.lastTools?.length, 3);
    assert.deepEqual(events.filter(isStepStart)[0].declaredTools, ["a", "b", "c"]);
  });

  it("search 开启但工具数 ≤ maxDeclared：不注入 tool_search", async () => {
    const tools = Array.from({ length: 10 }, (_, i) => echoTool(`t${i}`));
    const provider = new ScriptedProvider();
    provider.push({ content: "done", toolCalls: [], finishReason: "stop" });
    const rt = new AgentRuntime({ provider });
    await rt.run({
      agent: new Agent({ name: "x", tools }),
      input: "hi",
      toolBudget: { search: true, maxDeclared: 50 },
    });
    assert.equal(provider.lastTools?.length, 10);
    assert.ok(!provider.lastTools?.some((t) => t.name === "tool_search"));
  });

  it("60 工具 + maxDeclared:50 → 声明面裁剪为 ≤51（50 + tool_search）；tool_search 可发现、未声明工具仍可执行", async () => {
    const tools: AnyTool[] = [
      echoTool("weather", "获取天气数据"),
      echoTool("geocode", "地理编码与天气"),
      ...Array.from({ length: 58 }, (_, i) => echoTool(`t${i}`)), // t0..t57
    ];
    assert.equal(tools.length, 60);

    const provider = new ScriptedProvider();
    // step1: 调 tool_search("天气")；step2: 调 t55（不在声明面）；step3: 结束
    provider.push({
      content: null,
      toolCalls: [rawCall("1", "tool_search", { query: "天气" })],
      finishReason: "tool_calls",
    });
    provider.push({ content: null, toolCalls: [rawCall("2", "t55", {})], finishReason: "tool_calls" });
    provider.push({ content: "done", toolCalls: [], finishReason: "stop" });

    const rt = new AgentRuntime({ provider });
    const events: RuntimeEvent[] = [];
    const snapshots: StepSnapshot[] = [];
    const off = rt.subscribe((e) => events.push(e));
    try {
      await rt.run({
        agent: new Agent({ name: "x", tools }),
        input: "hi",
        toolBudget: { search: true, maxDeclared: 50 },
        onStepEnd: (s) => {
          snapshots.push(s);
        },
      });
    } finally {
      off();
    }

    // provider 实际收到：50 真实工具 + tool_search
    assert.equal(provider.lastTools?.length, 51);
    assert.ok(provider.lastTools?.some((t) => t.name === "tool_search"));

    // step:start.declaredTools 与实际注入完全一致
    const start = events.filter(isStepStart)[0];
    assert.equal(start.declaredTools?.length, 51);
    assert.ok(start.declaredTools?.includes("tool_search"));

    // tool_search 命中 weather / geocode 且执行成功
    const toolEnds = events.filter(isToolEnd);
    const searchEnd = toolEnds.find((e) => e.toolCall.name === "tool_search");
    assert.ok(searchEnd?.ok, "tool_search 应执行成功");
    assert.match(searchEnd!.result as string, /weather|geocode/);

    // 未声明工具 t55 仍可执行（toolMap 保留全量，gate/sandbox 不变）
    const t55 = toolEnds.find((e) => e.toolCall.name === "t55");
    assert.ok(t55?.ok, "未声明工具 t55 仍应执行成功");

    // 末步快照的 toolSurface：声明面含 tool_search，执行面含 tool_search 与 t55
    const last = snapshots.at(-1)!;
    assert.ok(last.toolSurface?.declared.includes("tool_search"));
    assert.ok(last.toolSurface?.used.includes("tool_search"));
    assert.ok(last.toolSurface?.used.includes("t55"));
  });

  it("declared 变化不影响 toolsHash 续跑护栏（toolSurface 与续跑独立）", async () => {
    // 仅验证两者字段独立存在、可同时采集，不互相替换（续跑校验在 memory 层）。
    const tools = [echoTool("a"), echoTool("b")];
    const provider = new ScriptedProvider();
    provider.push({ content: null, toolCalls: [rawCall("1", "a", {})], finishReason: "tool_calls" });
    provider.push({ content: "done", toolCalls: [], finishReason: "stop" });
    const rt = new AgentRuntime({ provider });
    const snapshots: StepSnapshot[] = [];
    await rt.run({
      agent: new Agent({ name: "x", tools }),
      input: "hi",
      onStepEnd: (s) => {
        snapshots.push(s);
      },
    });
    const last = snapshots.at(-1)!;
    assert.ok(last.toolSurface?.declared.length === 2);
    assert.ok(last.toolSurface?.used.includes("a"));
    assert.ok(!last.toolSurface?.used.includes("b")); // b 未被调用
  });
});
