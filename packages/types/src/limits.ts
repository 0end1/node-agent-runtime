import type { RunUsage } from "./types.js";

/**
 * Budget guardrails (P3.4).
 *
 * Limits are declared as **pure data** so hosts can derive them from config
 * (`RuntimeConfig.limits`), per-tenant plans or a UI form; the engine only
 * evaluates them. Every field is optional — unset means "no cap".
 */

/** Sliding-window cap on tool invocations. */
export interface ToolRateLimit {
  /** Max tool calls allowed inside `windowMs`. */
  maxCalls: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RunLimits {
  /** Max model round-trips (a.k.a. steps) per run. */
  maxSteps?: number;
  maxModelCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  /** Wall-clock budget for the whole run. */
  maxDurationMs?: number;
  /** Estimated USD budget; needs a provider that reports cost or a host price hook. */
  maxCostUsd?: number;
  /** Cap on tool invocations inside a sliding window. */
  toolRate?: ToolRateLimit;
}

export type LimitKind =
  | "steps"
  | "modelCalls"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "duration"
  | "cost"
  | "toolRate";

export interface LimitViolation {
  kind: LimitKind;
  /** The configured cap that was hit. */
  limit: number;
  /** The value observed when the cap tripped. */
  actual: number;
  message: string;
}

/** Live measurements the engine feeds into `checkRunLimits`. */
export interface LimitProbe {
  /** Steps completed so far (1-based count of model round-trips started). */
  steps: number;
  /** Milliseconds since the run started. */
  elapsedMs: number;
  /** Estimated spend so far, when the provider reports it. */
  costUsd?: number;
  /** Epoch-ms timestamps of tool calls in this run (sliding-window check). */
  toolCallTimes?: readonly number[];
}

/**
 * Pure budget evaluation: returns the **first** violated limit, or `undefined`
 * when everything is still within budget. Deterministic and side-effect free
 * (no clock, no IO) so it can be unit-tested and reused by hosts for preflight.
 */
export function checkRunLimits(
  usage: RunUsage,
  probe: LimitProbe,
  limits: RunLimits,
): LimitViolation | undefined {
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const now = probe.toolCallTimes?.length
    ? probe.toolCallTimes[probe.toolCallTimes.length - 1]
    : undefined;

  if (limits.maxSteps !== undefined && probe.steps > limits.maxSteps) {
    return violation("steps", limits.maxSteps, probe.steps, `已达最大步数 ${limits.maxSteps}`);
  }
  if (limits.maxModelCalls !== undefined && usage.modelCalls > limits.maxModelCalls) {
    return violation(
      "modelCalls",
      limits.maxModelCalls,
      usage.modelCalls,
      `已达模型调用上限 ${limits.maxModelCalls}`,
    );
  }
  if (limits.maxInputTokens !== undefined && usage.inputTokens > limits.maxInputTokens) {
    return violation(
      "inputTokens",
      limits.maxInputTokens,
      usage.inputTokens,
      `已达输入 token 上限 ${limits.maxInputTokens}`,
    );
  }
  if (limits.maxOutputTokens !== undefined && usage.outputTokens > limits.maxOutputTokens) {
    return violation(
      "outputTokens",
      limits.maxOutputTokens,
      usage.outputTokens,
      `已达输出 token 上限 ${limits.maxOutputTokens}`,
    );
  }
  if (limits.maxTotalTokens !== undefined && totalTokens > limits.maxTotalTokens) {
    return violation(
      "totalTokens",
      limits.maxTotalTokens,
      totalTokens,
      `已达总 token 上限 ${limits.maxTotalTokens}`,
    );
  }
  if (limits.maxDurationMs !== undefined && probe.elapsedMs > limits.maxDurationMs) {
    return violation(
      "duration",
      limits.maxDurationMs,
      probe.elapsedMs,
      `已超时 ${limits.maxDurationMs}ms`,
    );
  }
  if (limits.maxCostUsd !== undefined && probe.costUsd !== undefined && probe.costUsd > limits.maxCostUsd) {
    return violation("cost", limits.maxCostUsd, probe.costUsd, `已达成本上限 ${limits.maxCostUsd} USD`);
  }
  if (limits.toolRate && probe.toolCallTimes?.length && now !== undefined) {
    const { maxCalls, windowMs } = limits.toolRate;
    const recent = probe.toolCallTimes.filter((t) => now - t < windowMs).length;
    if (recent > maxCalls) {
      return violation(
        "toolRate",
        maxCalls,
        recent,
        `工具调用速率超限：${windowMs}ms 内最多 ${maxCalls} 次`,
      );
    }
  }
  return undefined;
}

function violation(
  kind: LimitKind,
  limit: number,
  actual: number,
  message: string,
): LimitViolation {
  return { kind, limit, actual, message };
}
