/** Tiny shared helpers. */

/**
 * `process.env`-shaped record (P4.5).
 *
 * Declared here (instead of reusing `NodeJS.ProcessEnv`) so the published
 * `.d.ts` files stay self-contained: consumers must not be forced to install
 * `@types/node` just to typecheck against `@node-agent-runtime/*`.
 */
export type ProcessEnv = Record<string, string | undefined>;

export function newId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Serialize a tool return value into the string that will be fed back to the model. */
export function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Short, stable fingerprint of a JSON-serializable value (P3.3 audit trails).
 * Keys are sorted first so `{a,b}` and `{b,a}` hash identically; the value
 * itself is never stored, only this digest.
 */
export function fingerprint(value: unknown): string {
  const json = stableStringify(value);
  // FNV-1a — tiny, dependency-free, good enough for audit correlation.
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}-${json.length}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Pretty numeric output avoiding float noise (0.30000000000000004 -> 0.3). */
export function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(12)));
}
