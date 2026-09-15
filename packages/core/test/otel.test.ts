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
  type StepStartEvent,
  type ToolEndEvent,
  type ToolStartEvent,
  toOtelSpans,
  type OtelSpan,
} from "@node-agent-runtime/core";

const TRACE = "trace_1";
const RUN = "r1";

function echoTool(name: string, description = `tool ${name}`): AnyTool {
  return { name, description, execute: async () => `ran ${name}` };
}

/** Deterministic event sequence: 1 run + 1 step + 2 tools (one failing). */
function events(): RuntimeEvent[] {
  const base = { runId: RUN, traceId: TRACE };
  return [
    { type: "run:start", runId: RUN, agentName: "a", input: "x", startedAt: 1000, traceId: TRACE },
    { type: "step:start", ...base, step: 1, at: 1100 } as StepStartEvent,
    {
      type: "tool:start",
      ...base,
      step: 1,
      at: 1200,
      toolCall: { id: "t1", name: "weather", arguments: {} },
    } as ToolStartEvent,
    {
      type: "tool:end",
      ...base,
      step: 1,
      at: 1300,
      toolCall: { id: "t1", name: "weather", arguments: {} },
      result: "ok",
      durationMs: 100,
      ok: true,
    } as ToolEndEvent,
    {
      type: "tool:start",
      ...base,
      step: 1,
      at: 1400,
      toolCall: { id: "t2", name: "geocode", arguments: {} },
    } as ToolStartEvent,
    {
      type: "tool:end",
      ...base,
      step: 1,
      at: 1500,
      toolCall: { id: "t2", name: "geocode", arguments: {} },
      result: "boom",
      durationMs: 100,
      ok: false,
    } as ToolEndEvent,
    {
      type: "run:end",
      runId: RUN,
      steps: 1,
      output: "done",
      usage: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
      stoppedByMaxSteps: false,
      endedAt: 1600,
      traceId: TRACE,
    },
  ];
}

const ms = (nano: string): number => Number(nano) / 1e6;

describe("M7-2 toOtelSpans", () => {
  it("1 run + 1 step + 2 tools → 4 spans with run→step→tool 父子", () => {
    const spans = toOtelSpans(events());
    assert.equal(spans.length, 4);

    const run = spans.find((s) => s.kind === "run")!;
    const step = spans.find((s) => s.kind === "step")!;
    const tools = spans.filter((s) => s.kind === "tool");
    assert.equal(tools.length, 2);

    assert.equal(run.parentSpanId, undefined);
    assert.equal(step.parentSpanId, run.spanId);
    for (const t of tools) assert.equal(t.parentSpanId, step.spanId);
    assert.equal(step.name, "step 1");
    assert.deepEqual(tools.map((t) => t.name).sort(), ["geocode", "weather"]);
  });

  it("id 形态：traceId 32 hex、spanId 16 hex，且确定性可复现", () => {
    const a = toOtelSpans(events());
    const b = toOtelSpans(events());
    for (const s of a) {
      assert.match(s.traceId, /^[0-9a-f]{32}$/);
      assert.match(s.spanId, /^[0-9a-f]{16}$/);
    }
    assert.deepEqual(a, b); // 纯函数：相同输入 → 相同输出
  });

  it("时间戳单调：run ≤ step ≤ 各 tool，且 tool 内部 start < end", () => {
    const spans = toOtelSpans(events());
    const run = spans.find((s) => s.kind === "run")!;
    const step = spans.find((s) => s.kind === "step")!;
    const tools = spans.filter((s) => s.kind === "tool");
    const runStart = ms(run.startTimeUnixNano);
    const runEnd = ms(run.endTimeUnixNano);
    const stepStart = ms(step.startTimeUnixNano);
    const stepEnd = ms(step.endTimeUnixNano);

    assert.ok(runStart <= stepStart);
    assert.ok(stepStart <= stepEnd);
    assert.ok(stepEnd <= runEnd);
    for (const t of tools) {
      const s = ms(t.startTimeUnixNano);
      const e = ms(t.endTimeUnixNano);
      assert.ok(s < e, `tool ${t.name} 应 start < end`);
      assert.ok(stepStart <= s && e <= stepEnd);
    }
  });

  it("失败工具 span 状态为 ERROR；属性携带 ok / durationMs", () => {
    const spans = toOtelSpans(events());
    const geocode = spans.find((s) => s.name === "geocode")!;
    const weather = spans.find((s) => s.name === "weather")!;
    assert.equal(geocode.status.code, "ERROR");
    assert.equal(weather.status.code, "OK");
    assert.equal(geocode.attributes["tool.ok"], false);
    assert.equal(weather.attributes["tool.durationMs"], 100);
  });

  it("跨 run 的 traceId 不同", () => {
    const evs = events();
    const other = events().map((e) => ({ ...e, runId: "r2", traceId: "trace_2" }));
    const spans = toOtelSpans([...evs, ...other]);
    const traces = new Set(spans.map((s) => s.traceId));
    assert.equal(traces.size, 2);
  });

  it("ctx.serviceName 写入 run span 属性", () => {
    const spans = toOtelSpans(events(), { serviceName: "agent-runtime" });
    const run = spans.find((s) => s.kind === "run")!;
    assert.equal(run.attributes["service.name"], "agent-runtime");
  });
});

// ---- 集成：验证 runtime 真为 step/tool 事件打 at 时间戳 ----
class ScriptedProvider implements ModelProvider {
  id = "scripted";
  label = "scripted";
  private queue: ModelResponse[] = [];
  push(r: ModelResponse): void {
    this.queue.push(r);
  }
  async chat(req: ModelRequest): Promise<ModelResponse> {
    return this.queue.shift() ?? { content: "done", toolCalls: [], finishReason: "stop" };
  }
}

function rawCall(id: string, name: string): RawToolCall {
  return { id, name, arguments: "{}" };
}

describe("M7-2 集成：runtime 为 step/tool 事件打 at", () => {
  it("step:start / tool:start / tool:end 携带 at，且 toOtelSpans 仍可产出单调 span", async () => {
    const provider = new ScriptedProvider();
    provider.push({
      content: null,
      toolCalls: [rawCall("t1", "weather"), rawCall("t2", "geocode")],
      finishReason: "tool_calls",
    });
    provider.push({ content: "done", toolCalls: [], finishReason: "stop" });

    const rt = new AgentRuntime({ provider });
    const collected: RuntimeEvent[] = [];
    const off = rt.subscribe((e) => collected.push(e));
    try {
      await rt.run({
        agent: new Agent({ name: "x", tools: [echoTool("weather"), echoTool("geocode")] }),
        input: "hi",
      });
    } finally {
      off();
    }

    const stepStart = collected.filter((e) => e.type === "step:start") as StepStartEvent[];
    const toolStarts = collected.filter((e) => e.type === "tool:start") as ToolStartEvent[];
    const toolEnds = collected.filter((e) => e.type === "tool:end") as ToolEndEvent[];

    assert.ok(stepStart.length >= 1);
    for (const s of stepStart) assert.ok(typeof s.at === "number");
    for (const t of [...toolStarts, ...toolEnds]) assert.ok(typeof t.at === "number");
    assert.equal(toolStarts.length, 2);
    assert.equal(toolEnds.length, 2);

    const spans: OtelSpan[] = toOtelSpans(collected);
    assert.equal(spans.filter((s) => s.kind === "run").length, 1);
    assert.equal(spans.filter((s) => s.kind === "step").length, stepStart.length);
    assert.equal(spans.filter((s) => s.kind === "tool").length, 2);
    const run = spans.find((s) => s.kind === "run")!;
    const steps = spans.filter((s) => s.kind === "step");
    assert.equal(run.parentSpanId, undefined);
    // 每个 tool span 都挂在某 step span 之下
    for (const t of spans.filter((s) => s.kind === "tool")) {
      assert.ok(steps.some((s) => s.spanId === t.parentSpanId));
    }
  });
});
