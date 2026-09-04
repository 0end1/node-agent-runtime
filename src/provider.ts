import type { AnyTool } from "./tool.js";
import type { ChatMessage } from "./types.js";

/** A tool call exactly as the provider emitted it (arguments still as raw text). */
export interface RawToolCall {
  id: string;
  name: string;
  /** JSON-encoded argument string. */
  arguments: string;
}

export interface ModelRequest {
  /** Conversation messages WITHOUT the system prompt (it is passed separately). */
  messages: readonly ChatMessage[];
  /** Tools available this round. Undefined == no tool calling. */
  tools?: readonly AnyTool[];
  /** System prompt / instructions. */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type FinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "content_filter"
  | "error";

export interface ModelResponse {
  content: string | null;
  toolCalls: RawToolCall[];
  finishReason: FinishReason;
  usage?: { inputTokens: number; outputTokens: number };
}

/** A pluggable chat model backend. */
export interface ModelProvider {
  readonly id: string;
  readonly label: string;
  chat(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelRequestErrorOptions {
  providerId: string;
  message: string;
  status?: number;
  retryable?: boolean;
  cause?: unknown;
}

/** Raised when the model backend itself fails (network / auth / 5xx...). */
export class ModelRequestError extends Error {
  readonly providerId: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(opts: ModelRequestErrorOptions) {
    super(opts.message);
    this.name = "ModelRequestError";
    this.providerId = opts.providerId;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}
