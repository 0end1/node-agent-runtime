import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PriceTable, RunUsage } from "@node-agent-runtime/types";
import { usageCost } from "@node-agent-runtime/types";

describe("usageCost (M7-1)", () => {
  it("仅 output 计费精确", () => {
    const price: PriceTable = { inputPerMTok: 1, outputPerMTok: 2 };
    const u: RunUsage = { inputTokens: 0, outputTokens: 1_000_000, modelCalls: 1 };
    assert.equal(usageCost(u, price), 2);
  });

  it("input + output 计费精确", () => {
    const price: PriceTable = { inputPerMTok: 1, outputPerMTok: 2 };
    const u: RunUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, modelCalls: 1 };
    assert.equal(usageCost(u, price), 3);
  });

  it("缓存命中按 cachedInputPerMTok 计费", () => {
    const price: PriceTable = { inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: 0.5 };
    const u: RunUsage = {
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      modelCalls: 1,
    };
    // nonCached 1e6*1 + cached 1e6*0.5 + output 1e6*2 = 3.5
    assert.equal(usageCost(u, price), 3.5);
  });

  it("未配缓存价时回退到 inputPerMTok", () => {
    const price: PriceTable = { inputPerMTok: 1, outputPerMTok: 2 };
    const u: RunUsage = {
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      modelCalls: 1,
    };
    // nonCached 1e6*1 + cached 1e6*1 + output 1e6*2 = 4
    assert.equal(usageCost(u, price), 4);
  });

  it("零用量成本为 0", () => {
    const price: PriceTable = { inputPerMTok: 9, outputPerMTok: 9 };
    const u: RunUsage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };
    assert.equal(usageCost(u, price), 0);
  });

  it("非整值保留 6 位小数精度", () => {
    const price: PriceTable = { inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: 0.5 };
    const u: RunUsage = { inputTokens: 1234, outputTokens: 567, cachedInputTokens: 100, modelCalls: 1 };
    // (1134*1 + 100*0.5 + 567*2)/1e6 = 2318/1e6 = 0.002318
    assert.ok(Math.abs(usageCost(u, price) - 0.002318) < 1e-9);
  });
});
