import type { ChatMessage } from "@node-agent-runtime/types";
import type { Storage } from "@node-agent-runtime/types";

/**
 * Memory (docs/architecture.md §8.2).
 *
 * Two layers live behind one facade:
 *
 *   1. **Session layer** — the conversation transcript, stored as the
 *      per-session append-only message stream (same source of truth the
 *      SessionManager already used in M1).
 *   2. **Long-term fact layer** — a small key/value store per session
 *      (`remember` / `recall`) that an Agent recipe can inject as
 *      "summary/facts" later. Scoring is a dependency-free lexical match:
 *      good enough for a local single-machine product, and swappable for a
 *      vector backend without touching the engine.
 *
 * The engine never reads memory directly: the host loads `messages()` and
 * passes them into `runtime.run()` as `history`.
 */

export interface MemoryFact {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface MemoryRecall {
  key: string;
  value: unknown;
  /** Lexical match score in [0, 1]; higher is a better match. */
  score: number;
}

export interface Memory {
  // ---- session layer (conversation transcript) ----
  append(message: ChatMessage): Promise<void>;
  messages(limit?: number): Promise<ChatMessage[]>;

  // ---- long-term fact layer (KV; vector search is a future backend) ----
  remember(key: string, value: unknown): Promise<void>;
  recall(query: string, limit?: number): Promise<MemoryRecall[]>;
}

export interface SessionMemoryOptions {
  storage: Storage;
  sessionId: string;
  /** Clock injectable for deterministic tests. */
  now?: () => number;
}

/** Persisted shape of the fact layer: one document per session. */
interface MemoryDoc {
  sessionId: string;
  facts: Record<string, { value: unknown; updatedAt: number }>;
  updatedAt: number;
}

export class SessionMemory implements Memory {
  private readonly storage: Storage;
  private readonly sessionId: string;
  private readonly now: () => number;

  constructor(options: SessionMemoryOptions) {
    this.storage = options.storage;
    this.sessionId = options.sessionId;
    this.now = options.now ?? (() => Date.now());
  }

  async append(message: ChatMessage): Promise<void> {
    await this.storage.appendStream("message", this.sessionId, JSON.stringify(message));
  }

  async messages(limit?: number): Promise<ChatMessage[]> {
    const lines = await this.storage.readStream("message", this.sessionId);
    const parsed: ChatMessage[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as ChatMessage);
      } catch {
        // skip a corrupt line rather than losing the whole session
      }
    }
    return limit && limit > 0 ? parsed.slice(-limit) : parsed;
  }

  async remember(key: string, value: unknown): Promise<void> {
    const trimmed = key?.trim();
    if (!trimmed) throw new Error("remember(): key 不能为空");
    const doc = await this.loadDoc();
    doc.facts[trimmed] = { value, updatedAt: this.now() };
    doc.updatedAt = this.now();
    await this.storage.saveDoc("memory", this.sessionId, doc);
  }

  async recall(query: string, limit = 5): Promise<MemoryRecall[]> {
    const text = (query ?? "").trim();
    if (!text) return [];
    const doc = await this.loadDoc();
    const needle = tokenize(text);
    if (needle.length === 0) return [];

    const scored: MemoryRecall[] = [];
    for (const [key, entry] of Object.entries(doc.facts)) {
      const haystack = tokenize(`${key} ${stringifyValue(entry.value)}`);
      const score = overlapScore(needle, haystack);
      if (score > 0) scored.push({ key, value: entry.value, score });
    }
    scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    return limit && limit > 0 ? scored.slice(0, limit) : scored;
  }

  /** Every remembered fact (debug / host UI). */
  async facts(): Promise<MemoryFact[]> {
    const doc = await this.loadDoc();
    return Object.entries(doc.facts)
      .map(([key, entry]) => ({ key, value: entry.value, updatedAt: entry.updatedAt }))
      .sort((a, b) => a.updatedAt - b.updatedAt);
  }

  private async loadDoc(): Promise<MemoryDoc> {
    const existing = await this.storage.loadDoc<MemoryDoc>("memory", this.sessionId);
    return existing ?? { sessionId: this.sessionId, facts: {}, updatedAt: this.now() };
  }
}

// ------------------------------------------------------------------ scoring

/**
 * Split text into comparable tokens: latin words, CJK characters and CJK
 * bigrams (so "北京天气" still matches a fact mentioning "北京").
 */
function tokenize(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9_]+/g) ?? []) {
    if (word.length > 1) out.add(word);
  }
  for (const run of lower.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    for (const ch of run) out.add(ch);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/** Share of query tokens that appear in the candidate text. */
function overlapScore(needle: string[], haystack: string[]): number {
  if (needle.length === 0 || haystack.length === 0) return 0;
  const set = new Set(haystack);
  let hits = 0;
  for (const token of needle) if (set.has(token)) hits++;
  return hits / needle.length;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
