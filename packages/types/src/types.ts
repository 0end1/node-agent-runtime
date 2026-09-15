/**
 * Core message & tool-call types shared by the whole runtime.
 */

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

/** A structured request issued by the model to run a tool. */
export interface ToolCall {
  id: string;
  name: string;
  /** Arguments already parsed into a JSON object (before validation). */
  arguments: Record<string, unknown>;
}

export interface AssistantMessage {
  role: "assistant";
  /** Free text produced by the model. Empty when the message only contains tool calls. */
  content: string;
  toolCalls?: ToolCall[];
}

/** The result of running one tool call, fed back to the model. */
export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  content: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

/** Token usage aggregation of a whole run. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  /** How many model round trips happened. */
  modelCalls: number;
  /**
   * Cache-read input tokens (prompt caching hit). Optional; only when the
   * provider reports it. Billed at a separate rate via `PriceTable`.
   */
  cachedInputTokens?: number;
  /**
   * Estimated USD cost so far. Optional; set by the engine when a `PriceTable`
   * is configured (M7-1), or by a host `costUsd` hook. `undefined` = not metered.
   */
  costUsd?: number;
}
