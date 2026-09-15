import { redact } from "@node-agent-runtime/core";
import type { ApprovalQuery, ApprovalRecord, ApprovalStore } from "@node-agent-runtime/types";

export type AuditFormat = "csv" | "json";

/**
 * Fixed column order. Deliberately carries only `argumentsFingerprint` — never
 * the raw tool arguments (P3.2 / P3.3: the audit trail must not become a second
 * copy of secrets). `decidedAt` is rendered as ISO-8601 UTC.
 */
const COLUMNS = [
  "decisionId",
  "runId",
  "sessionId",
  "taskId",
  "toolName",
  "argumentsFingerprint",
  "verdict",
  "source",
  "reason",
  "decidedAt",
] as const;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** RFC 4180 field: quote when it contains comma/quote/newline; double inner quotes. */
function csvField(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Redact any secret-shaped value before it reaches the export (P3.2 regression). */
function redactRecord(r: ApprovalRecord): ApprovalRecord {
  return redact(r) as ApprovalRecord;
}

function orderedRow(r: ApprovalRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of COLUMNS) {
    out[col] =
      col === "decidedAt"
        ? iso(r.decidedAt)
        : ((r as unknown as Record<string, unknown>)[col] ?? "");
  }
  return out;
}

/**
 * Serialize approval records to a deterministic, secret-safe string.
 * - `csv`: fixed header, RFC 4180 escaping, ISO-8601 time, UTF-8, `\n` endings.
 * - `json`: stable key-order array.
 * Every record is run through `redact` first — a secret-shaped `reason` (e.g.
 * `sk-…`) is masked, never exported in cleartext.
 */
export function serializeAudit(records: ApprovalRecord[], opts?: { format?: AuditFormat }): string {
  const format = opts?.format ?? "csv";
  const safe = records.map(redactRecord);
  if (format === "json") {
    return JSON.stringify(safe.map(orderedRow), null, 2) + "\n";
  }
  const header = COLUMNS.join(",");
  const lines = safe.map((r) =>
    COLUMNS.map((col) =>
      csvField(
        col === "decidedAt" ? iso(r.decidedAt) : (r as unknown as Record<string, unknown>)[col],
      ),
    ).join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

/** Pull records from a store (optionally filtered) and serialize them. */
export async function exportAudit(
  store: ApprovalStore,
  query?: ApprovalQuery,
  opts?: { format?: AuditFormat },
): Promise<string> {
  const records = await store.list(query);
  return serializeAudit(records, opts);
}
