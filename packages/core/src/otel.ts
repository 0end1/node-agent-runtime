import type {
  RunEndEvent,
  RunStartEvent,
  RuntimeEvent,
  StepStartEvent,
  ToolEndEvent,
  ToolStartEvent,
} from "@node-agent-runtime/types";

export type OtelSpanKind = "run" | "step" | "tool";

/**
 * OTLP-JSON span shape (a subset we emit). IDs are 32/16 hex, derived
 * deterministically from the event payload so the function is pure and tests
 * are reproducible — no randomness, no transport dependency.
 */
export interface OtelSpan {
  /** 32 hex chars. Derived from `event.traceId` (or runId) — not the raw string. */
  traceId: string;
  /** 16 hex chars. */
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: OtelSpanKind;
  /** Nanoseconds since epoch (OTLP-JSON encodes these as strings). */
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  status: { code: "OK" | "ERROR"; message?: string };
}

export interface OtelContext {
  /** Emitted as `service.name` on the run span. */
  serviceName?: string;
}

// ---- deterministic id derivation (zero deps) ----

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashHex(input: string, bytes: number): string {
  let out = "";
  let salt = 0;
  while (out.length < bytes * 2) {
    out += fnv1a(`${input}#${salt}`).toString(16).padStart(8, "0");
    salt++;
  }
  return out.slice(0, bytes * 2);
}

const traceHex = (traceId: string): string => hashHex(`t:${traceId}`, 16); // 32 hex
const spanHex = (seed: string): string => hashHex(`s:${seed}`, 8); // 16 hex
const ns = (ms: number): string => String(Math.round(ms) * 1_000_000);

/**
 * Convert runtime events into OTEL spans. Parent/child is derived from
 * `runId` + `step` (run → step → tool). Requires `step:start.at` /
 * `tool:start.at` / `tool:end.at` (M7-2 timestamps) for accurate timing; when
 * absent it falls back to the run's start/end so a span is still produced.
 *
 * Pure: identical input → identical output (deterministic ids, no clock reads).
 */
export function toOtelSpans(input: RuntimeEvent | RuntimeEvent[], ctx?: OtelContext): OtelSpan[] {
  const events = Array.isArray(input) ? input : [input];
  const spans: OtelSpan[] = [];

  const byRun = new Map<string, RuntimeEvent[]>();
  for (const e of events) {
    // 并非所有事件都带 runId（session/task 等生命周期事件不带），仅按 run 归组。
    if (!("runId" in e)) continue;
    const arr = byRun.get(e.runId);
    if (arr) arr.push(e);
    else byRun.set(e.runId, [e]);
  }

  for (const [runId, evs] of byRun) {
    const runStart = evs.find((e): e is RunStartEvent => e.type === "run:start");
    const runEnd = evs.find((e): e is RunEndEvent => e.type === "run:end");
    const steps = evs
      .filter((e): e is StepStartEvent => e.type === "step:start")
      .sort((a, b) => a.step - b.step);
    const toolStarts = evs.filter((e): e is ToolStartEvent => e.type === "tool:start");
    const toolEnds = evs.filter((e): e is ToolEndEvent => e.type === "tool:end");

    const traceId = traceHex(runStart?.traceId ?? runId);
    const runSpanId = spanHex(`${traceId}/run`);
    const runStartMs = runStart?.startedAt ?? 0;
    const runEndMs = runEnd?.endedAt ?? runStartMs + 1;

    spans.push({
      traceId,
      spanId: runSpanId,
      name: "run",
      kind: "run",
      startTimeUnixNano: ns(runStartMs),
      endTimeUnixNano: ns(runEndMs),
      attributes: {
        "run.id": runId,
        ...(runStart?.agentName ? { "agent.name": runStart.agentName } : {}),
        ...(ctx?.serviceName ? { "service.name": ctx.serviceName } : {}),
      },
      status: { code: "OK" },
    });

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const start = st.at ?? runStartMs;
      const next = steps[i + 1];
      const endRaw = next?.at !== undefined && next.at > start ? next.at : runEndMs;
      const end = endRaw > start ? endRaw : start + 1;
      const stepSpanId = spanHex(`${traceId}/step/${st.step}`);

      spans.push({
        traceId,
        spanId: stepSpanId,
        parentSpanId: runSpanId,
        name: `step ${st.step}`,
        kind: "step",
        startTimeUnixNano: ns(start),
        endTimeUnixNano: ns(end),
        attributes: {
          "step.index": st.step,
          ...(st.declaredTools ? { "step.declaredTools": st.declaredTools.length } : {}),
        },
        status: { code: "OK" },
      });

      for (const ts of toolStarts.filter((t) => t.step === st.step)) {
        const te = toolEnds.find((e) => e.step === ts.step && e.toolCall.id === ts.toolCall.id);
        const tStart = ts.at ?? start;
        const tEnd = te?.at !== undefined && te.at > tStart ? te.at : tStart + 1;
        spans.push({
          traceId,
          spanId: spanHex(`${traceId}/step/${st.step}/tool/${ts.toolCall.id}`),
          parentSpanId: stepSpanId,
          name: ts.toolCall.name,
          kind: "tool",
          startTimeUnixNano: ns(tStart),
          endTimeUnixNano: ns(tEnd),
          attributes: {
            "tool.name": ts.toolCall.name,
            "tool.ok": te?.ok ?? false,
            ...(te?.durationMs !== undefined ? { "tool.durationMs": te.durationMs } : {}),
          },
          status: { code: te?.ok === false ? "ERROR" : "OK" },
        });
      }
    }
  }

  return spans;
}
