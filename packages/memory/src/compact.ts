import type { ChatMessage } from "@node-agent-runtime/types";

/**
 * Context budget for the long-context compaction (M7-1). Pure-data config; the
 * engine evaluates it with `compactMessages` (a deterministic, zero-dependency
 * pure function). No tokenizer is pulled in — token count is estimated by
 * default and can be overridden by injecting a real counter.
 */
export interface ContextBudget {
  /** Hard cap on approx input tokens sent to the model each step. */
  maxInputTokens?: number;
  /** Total context window, reported back via `usage:update.contextSize`. */
  contextWindow?: number;
  /** Keep the last N user-initiated turns intact when compacting (default 3). */
  keepLastTurns?: number;
}

export interface CompactResult {
  /** Compacted transcript (system messages preserved, tail turns intact). */
  messages: ChatMessage[];
  /** How many messages were folded into the summary placeholder. */
  removed: number;
  /** Approximate token count of the compacted transcript. */
  estimatedTokens: number;
}

/** Default keep-last-turns when a budget enables compaction but omits it. */
const DEFAULT_KEEP_LAST_TURNS = 3;

/** Approximate token estimator: 1 token ≈ 4 chars (rounded up). No deps. */
export function estimateTokens(text: string): number {
  return Math.ceil(Math.max(0, text.length) / 4);
}

/** Approximate token count of a single message (text only). */
function messageTokens(message: ChatMessage, count: (s: string) => number): number {
  switch (message.role) {
    case "system":
    case "user":
    case "assistant":
      return count(message.content);
    case "tool":
      return count(message.toolCallId) + count(message.content);
  }
}

/** Approximate token count of a transcript. */
export function countMessagesTokens(
  messages: readonly ChatMessage[],
  countTokens: (s: string) => number = estimateTokens,
): number {
  let total = 0;
  for (const m of messages) total += messageTokens(m, countTokens);
  return total;
}

/** Split a transcript into user-initiated "turns" (user → … → assistant). */
function splitTurns(body: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  for (const m of body) {
    if (m.role === "user" && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(m);
  }
  if (current.length > 0) turns.push(current);
  return turns;
}

/** Build a structured, deterministic summary of the folded region. */
function summarizeFolded(head: ChatMessage[]): string {
  const firstUser = head.find((m) => m.role === "user");
  const goal = firstUser && firstUser.role === "user" ? firstUser.content : "(unknown)";
  const toolResults = head
    .filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool")
    .map((m) => `  - ${m.toolCallId}: ${m.content.slice(0, 120)}`);
  const toolNote = toolResults.length
    ? `\n关键工具结果摘要：\n${toolResults.join("\n")}`
    : "";
  return (
    `【历史已压缩】原始目标：${goal}\n` +
    `已折叠 ${head.length} 条历史消息（结构化保留用户原始目标与工具结果关键字段）。${toolNote}`
  );
}

/**
 * Deterministically compact a transcript to fit `budget.maxInputTokens`.
 *
 * - System messages are always preserved.
 * - The last `keepLastTurns` turns are kept intact (so recent context is never
 *   mutated); everything between is folded into a single structured summary
 *   placeholder (preserving the original user goal and tool-result key fields).
 * - Pure & deterministic: same input → same output, so a compacted transcript
 *   replays identically (and `computeToolsHash` is unaffected → resume works).
 */
export function compactMessages(
  messages: readonly ChatMessage[],
  budget: ContextBudget,
  countTokens: (s: string) => number = estimateTokens,
): CompactResult {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const body = messages.filter((m) => m.role !== "system");

  const base: CompactResult = {
    messages: [...messages],
    removed: 0,
    estimatedTokens: countMessagesTokens(messages, countTokens),
  };
  if (budget.maxInputTokens === undefined) return base;
  if (base.estimatedTokens <= budget.maxInputTokens) return base;

  const keep = budget.keepLastTurns ?? DEFAULT_KEEP_LAST_TURNS;
  const turns = splitTurns(body);
  const tail = turns.slice(-keep).flat();
  const head = body.slice(0, body.length - tail.length);
  if (head.length === 0) return base;

  const summary: ChatMessage = { role: "system", content: summarizeFolded(head) };
  const compacted = [...systemMsgs, summary, ...tail];
  return {
    messages: compacted,
    removed: body.length - compacted.length,
    estimatedTokens: countMessagesTokens(compacted, countTokens),
  };
}
