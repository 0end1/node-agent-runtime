import type { AnyTool } from "./tool.js";
import { ErrorCode } from "@node-agent-runtime/types";
import type { ChatMessage } from "@node-agent-runtime/types";

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

export type FinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "error";

export interface ModelResponse {
  content: string | null;
  toolCalls: RawToolCall[];
  finishReason: FinishReason;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
}

/** A pluggable chat model backend. */
export interface ModelProvider {
  readonly id: string;
  readonly label: string;
  chat(request: ModelRequest): Promise<ModelResponse>;
  /**
   * M8-4: 可选的流式生成。实现者契约：
   *
   * - **返回的 `ModelResponse` 必须与同请求下 `chat()` 等价** —— 拼接后的
   *   `content` 与 `toolCalls` 一致。否则 checkpoint 续跑、ACP 回放与审计
   *   看到的文本会与一次性生成不同（这正是 `message:delta` 的等价关系）。
   * - `onDelta` 只在产生非空文本增量时调用；结束前不得调用。
   * - 抛错即失败。是否回退由调用方按「是否已经吐出过块」决定（见
   *   `AgentRuntime#callModel`）—— 出过块再回退会重复计费并重复输出。
   */
  chatStream?(request: ModelRequest, onDelta: (delta: string) => void): Promise<ModelResponse>;
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
  readonly code = ErrorCode.MODEL_REQUEST;
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
