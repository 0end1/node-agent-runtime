import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkRunLimits, type LimitProbe, type RunLimits } from "../src/limits.js";
import type { RunUsage } from "../src/types.js";

const usage: RunUsage = { modelCalls: 0, inputTokens: 0, outputTokens: 0 };

function probe(over: Partial<LimitProbe> = {}): LimitProbe {
  return { steps: 1, elapsedMs: 0, toolCallTimes: [], ...over };
}

describe("checkRunLimits (P3.4 pure budget check)", () => {
  it("returns undefined when every cap is far below its limit", () => {
    const limits: RunLimits = {
      maxSteps: 10,
      maxDurationMs: 60_000,
      maxTotalTokens: 1000,
      maxCostUsd: 5,
      toolRate: { maxCalls: 10, windowMs: 1000 },
    };
    const out = checkRunLimits(
      { modelCalls: 2, inputTokens: 100, outputTokens: 200 },
      probe({ steps: 3, elapsedMs: 800, costUsd: 0.02, toolCallTimes: [100, 300] }),
      limits,
    );
    assert.equal(out, undefined);
  });

  it("trips maxSteps", () => {
    const out = checkRunLimits(usage, probe({ steps: 3 }), { maxSteps: 2 });
    assert.equal(out?.kind, "steps");
    assert.equal(out?.actual, 3);
  });

  it("trips maxDurationMs", () => {
    const out = checkRunLimits(usage, probe({ elapsedMs: 6000 }), { maxDurationMs: 5000 });
    assert.equal(out?.kind, "duration");
  });

  it("trips token caps (input/output/total)", () => {
    assert.equal(checkRunLimits({ modelCalls: 0, inputTokens: 900, outputTokens: 0 }, probe(), { maxInputTokens: 800 })?.kind, "inputTokens");
    assert.equal(checkRunLimits({ modelCalls: 0, inputTokens: 0, outputTokens: 900 }, probe(), { maxOutputTokens: 800 })?.kind, "outputTokens");
    assert.equal(
      checkRunLimits({ modelCalls: 0, inputTokens: 500, outputTokens: 400 }, probe(), { maxTotalTokens: 800 })?.kind,
      "totalTokens",
    );
  });

  it("trips maxCostUsd only when the probe reports a cost (no cost = not evaluated)", () => {
    assert.equal(checkRunLimits(usage, probe({ costUsd: 0.5 }), { maxCostUsd: 1 }), undefined); // under
    const out = checkRunLimits(usage, probe({ costUsd: 2 }), { maxCostUsd: 1 });
    assert.equal(out?.kind, "cost");
    assert.equal(checkRunLimits(usage, probe(), { maxCostUsd: 0.001 }), undefined);
  });

  it("trips the sliding-window tool rate using call timestamps", () => {
    const limits: RunLimits = { toolRate: { maxCalls: 3, windowMs: 1000 } };
    // 最后调用前 1s 内有 6 次 → 超限
    assert.equal(
      checkRunLimits(usage, probe({ toolCallTimes: [0, 100, 200, 300, 400, 500] }), limits)?.kind,
      "toolRate",
    );
    // 窗口内只有 2 次（0 与 50 都落在 2s 前）→ 不超
    assert.equal(checkRunLimits(usage, probe({ toolCallTimes: [0, 50, 2000, 2050] }), limits), undefined);
  });

  it("first violated limit wins when several are exceeded", () => {
    const out = checkRunLimits(
      { modelCalls: 99, inputTokens: 0, outputTokens: 0 },
      probe({ steps: 5, elapsedMs: 999_999 }),
      { maxSteps: 4, maxModelCalls: 10, maxDurationMs: 1000 },
    );
    assert.equal(out?.kind, "steps");
  });
});
