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
}
