import type { RunUsage } from "./types.js";

/**
 * Per-model pricing used by the engine's built-in cost meter (M7-1).
 * Rates are USD per *million* tokens, matching how providers quote them.
 */
export interface PriceTable {
  /** USD per 1M input (prompt) tokens. */
  inputPerMTok: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMTok: number;
  /** USD per 1M cache-read input tokens. Falls back to `inputPerMTok` when absent. */
  cachedInputPerMTok?: number;
}

/**
 * Deterministic cost of a run's usage under `price` (M7-1).
 *
 * Cache-read input tokens are billed at `cachedInputPerMTok` when present,
 * otherwise at `inputPerMTok` (the "未配缓存价的回退" case). Output tokens are
 * always billed at `outputPerMTok`. The result is rounded to 6 decimals for a
 * stable, serializable USD figure.
 */
export function usageCost(usage: RunUsage, price: PriceTable): number {
  const cached = usage.cachedInputTokens ?? 0;
  const nonCached = Math.max(0, usage.inputTokens - cached);
  const input =
    nonCached * price.inputPerMTok + cached * (price.cachedInputPerMTok ?? price.inputPerMTok);
  const output = usage.outputTokens * price.outputPerMTok;
  const total = (input + output) / 1_000_000;
  return Math.round(total * 1e6) / 1e6;
}
