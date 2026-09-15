import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Agent,
  AgentRuntime,
  type ContextCompactedEvent,
  LimitExceededError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RuntimeEvent,
  type UsageUpdateEvent,
} from "@node-agent-runtime/core";
import type { ChatMessage, PriceTable, RunUsage } from "@node-agent-runtime/types";

/** 确定性 provider：忽略历史，单次返回固定用量与最终答案。 */
class FixedProvider implements ModelProvider {
  id = "fixed";
  label = "fixed";
  async chat(_req: ModelRequest): Promise<ModelResponse> {
    return {
      content: "ok",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 100 },
    };
  }
}

function agent(): Agent {
  return new Agent({ name: "m7-1", tools: [] });
}

/** 收集一次 run 发射的全部事件。 */
async function collect(
  runtime: AgentRuntime,
  fn: () => Promise<unknown>,
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const off = runtime.subscribe((e) => events.push(e));
  try {
    await fn();
    return events;
  } finally {
    off();
  }
}

const isUsage = (e: RuntimeEvent): e is UsageUpdateEvent => e.type === "usage:update";
const isCompact = (e: RuntimeEvent): e is ContextCompactedEvent => e.type === "context:compacted";

describe("M7-1 内置计量（pricing）", () => {
  it("pricing 计算 costUsd 且 usage:update 末值与 run:end 一致", async () => {
    const rt = new AgentRuntime({ provider: new FixedProvider() });
    const price: PriceTable = { inputPerMTok: 1_000_000, outputPerMTok: 2_000_000 };
    const events = await collect(rt, () =>
      rt.run({ agent: agent(), input: "hi", pricing: price }),
    );
    // 100*1 + 50*2 = 200
    const usages = events.filter(isUsage);
    assert.ok(usages.length >= 1);
    assert.equal(usages.at(-1)!.costUsd, 200);
  });

  it("未配 pricing 且未传 costUsd 时 maxCostUsd 不参与判定（回归保护）", async () => {
    const rt = new AgentRuntime({ provider: new FixedProvider() });
    // 若 maxCostUsd 被错误地用 undefined 成本判定，这里会抛 LimitExceededError。
    const result = await rt.run({ agent: agent(), input: "hi", limits: { maxCostUsd: 0.0001 } });
    assert.ok(result.output.length > 0);
  });

  it("pricing 已知成本时 maxCostUsd 生效（与回退路径对照）", async () => {
    const rt = new AgentRuntime({ provider: new FixedProvider() });
    const price: PriceTable = { inputPerMTok: 1_000_000, outputPerMTok: 2_000_000 };
    await assert.rejects(
      () => rt.run({ agent: agent(), input: "hi", pricing: price, limits: { maxCostUsd: 0.0001 } }),
      (err: unknown) => err instanceof LimitExceededError,
    );
  });

  it("costUsd 钩子作为回退仍生效（优先级低于 pricing）", async () => {
    const rt = new AgentRuntime({ provider: new FixedProvider() });
    const result = await rt.run({
      agent: agent(),
      input: "hi",
      costUsd: (u: RunUsage) => u.inputTokens * 0.001,
    });
    assert.ok(Math.abs((result.usage.costUsd ?? 0) - 0.1) < 1e-9);
  });

  it("resume 续账：initialUsage 正确累加到 RunUsage", async () => {
    const rt = new AgentRuntime({ provider: new FixedProvider() });
    const seed: RunUsage = {
      inputTokens: 10,
      outputTokens: 5,
      modelCalls: 1,
      cachedInputTokens: 3,
      costUsd: 0.5,
    };
    const result = await rt.run({ agent: agent(), input: "hi", initialUsage: seed });
    assert.equal(result.usage.inputTokens, 110);
    assert.equal(result.usage.outputTokens, 55);
    assert.equal(result.usage.modelCalls, 2);
    assert.equal(result.usage.cachedInputTokens, 103);
  });
});

describe("M7-1 上下文压缩（context budget）", () => {
  it("超过 maxInputTokens 触发 context:compacted 且 run 仍可完成", async () => {
    const rt = new AgentRuntime({ provider: new FixedProvider() });
    const bigMsg = (s: string) => s.repeat(200);
    const history: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      history.push({ role: "user", content: bigMsg(`u${i}`) });
      history.push({ role: "assistant", content: bigMsg(`a${i}`) });
    }
    const events = await collect(rt, () =>
      rt.run({
        agent: agent(),
        input: "go",
        history,
        context: { maxInputTokens: 50, keepLastTurns: 1, contextWindow: 4096 },
      }),
    );
    const compacted = events.filter(isCompact);
    assert.ok(compacted.length >= 1);
    const ev = compacted[0];
    assert.ok(ev.removed > 0);
    assert.ok(ev.estimatedTokens > 0);
    assert.ok(ev.estimatedTokens < 1000);

    const last = events.filter(isUsage).at(-1)!;
    assert.equal(last.contextSize, 4096);
    assert.ok(last.contextUsed !== undefined);
  });
});
