import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  AgentRuntime,
  MockProvider,
  builtinTools,
  defineTool,
  type AnyTool,
  type RuntimeEvent,
} from "@agent-runtime/core";

function makeRuntime() {
  return new AgentRuntime({
    provider: new MockProvider({ now: () => new Date("2026-09-04T10:30:00+08:00") }),
  });
}

function agentWith(tools: AnyTool[] = builtinTools) {
  return new Agent({ name: "test", tools });
}

describe("AgentRuntime multi-step loop", () => {
  it("calculator: model calls tool then answers", async () => {
    const runtime = makeRuntime();
    const result = await runtime.run({ agent: agentWith(), input: "2 + 3 * 4 = ?" });
    assert.ok(result.output.includes("= 14"), `got: ${result.output}`);
    assert.ok(result.usage.modelCalls >= 2, "至少两轮往返（决策 + 收尾）");
  });

  it("weather: multi-step geocode -> weather -> answer", async () => {
    const runtime = makeRuntime();
    const result = await runtime.run({ agent: agentWith(), input: "北京天气怎么样" });
    assert.ok(result.output.includes("北京"), `got: ${result.output}`);
    assert.ok(result.output.includes("°C") || result.output.includes("天气"), result.output);
    assert.ok(result.usage.modelCalls >= 3);
  });

  it("emits ordered lifecycle events", async () => {
    const runtime = makeRuntime();
    const types: string[] = [];
    const off = runtime.subscribe((e: RuntimeEvent) => types.push(e.type));
    await runtime.run({ agent: agentWith(), input: "现在几点了？" });
    off();

    assert.equal(types[0], "run:start");
    assert.ok(types.includes("message:user"));
    assert.ok(types.includes("step:start"));
    assert.ok(types.includes("model:response"));
    assert.ok(types.includes("tool:start"));
    assert.ok(types.includes("tool:end"));
    assert.equal(types[types.length - 1], "run:end");
    // sanity: no interleaving of tool:end before its tool:start
    const toolSection = types.filter((t) => t.startsWith("tool:"));
    for (let i = 0; i < toolSection.length; i += 2) {
      assert.equal(toolSection[i], "tool:start");
      assert.equal(toolSection[i + 1], "tool:end");
    }
  });

  it("continues from history (multi-turn session)", async () => {
    const runtime = makeRuntime();
    const agent = agentWith();
    let history = (await runtime.run({ agent, input: "2 + 2 = ?" })).messages;
    const second = await runtime.run({
      agent,
      input: "那 4 + 5 = ?",
      history,
    });
    // session state carried over: two user turns, final computed
    const users = second.messages.filter((m) => m.role === "user");
    assert.equal(users.length, 2);
    const last = [...second.messages].reverse().find((m) => m.role === "assistant");
    assert.ok((last!.content as string).includes("= 9"), `got: ${last!.content}`);
  });

  it("caps at maxSteps and marks stoppedByMaxSteps", async () => {
    // a model that never stops calling tools -> loop must terminate
    const foreverProvider = {
      id: "forever",
      label: "forever-tool-caller",
      async chat() {
        return {
          content: "keep going",
          toolCalls: [{ id: "c1", name: "calculator", arguments: '{"expression":"1+1"}' }],
          finishReason: "tool_calls" as const,
        };
      },
    };
    const runtime = new AgentRuntime({ provider: foreverProvider });
    const result = await runtime.run({ agent: agentWith([builtinTools[0]]), input: "hi" });
    assert.ok(result.stoppedByMaxSteps);
    assert.equal(result.usage.modelCalls, 8); // agent default maxSteps
    assert.ok(result.output.includes("最大步数"));
  });
});

describe("tool safety", () => {
  it("rejects unknown tool names with a helpful message", async () => {
    const evil = {
      id: "evil",
      label: "evil",
      async chat() {
        return {
          content: null,
          toolCalls: [{ id: "c1", name: "definitely-not-registered", arguments: "{}" }],
          finishReason: "tool_calls" as const,
        };
      },
    };
    const runtime = new AgentRuntime({ provider: evil });
    const result = await runtime.run({
      agent: agentWith(), // does not register that tool
      input: "hi",
    });
    const toolResults = result.messages.filter((m) => m.role === "tool");
    assert.ok(toolResults.length > 0);
    assert.ok((toolResults[0].content as string).includes("未知工具"));
    assert.ok(result.stoppedByMaxSteps);
  });

  it("reports argument validation failures instead of crashing", async () => {
    const spy = defineTool({
      name: "echo",
      description: "echo",
      parameters: {
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
      },
      execute(args: { n: number }) {
        return { echoed: args.n };
      },
    });
    // bad arguments: "n" is a string
    const provider = {
      id: "bad-args",
      label: "bad-args",
      async chat() {
        return {
          content: null,
          toolCalls: [{ id: "c1", name: "echo", arguments: '{"n":"not-a-number"}' }],
          finishReason: "tool_calls" as const,
        };
      },
    };
    const runtime = new AgentRuntime({ provider });
    const result = await runtime.run({ agent: agentWith([spy]), input: "hi" });
    assert.ok(result.stoppedByMaxSteps); // tool kept failing -> never converges
    // the failure was reported back as a tool result, no crash
    const toolResults = result.messages.filter((m) => m.role === "tool");
    assert.ok(toolResults.length > 0);
    assert.ok((toolResults[0].content as string).includes("参数校验失败"));
  });

  it("aborts a run via AbortSignal", async () => {
    const slow = {
      id: "slow",
      label: "slow",
      async chat(_req: { signal?: AbortSignal }) {
        return new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("timeout")), 200);
          _req.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const e = new Error("Aborted");
            e.name = "AbortError";
            reject(e);
          });
        });
      },
    };
    const runtime = new AgentRuntime({ provider: slow });
    const controller = new AbortController();
    const p = runtime.run({ agent: agentWith(), input: "hi", signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(() => p);
  });
});
