import {
  ModelRequestError,
  type AnyTool,
  type FinishReason,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RawToolCall,
} from "@node-agent-runtime/core";
import type { ChatMessage } from "@node-agent-runtime/types";
import { SSE_DONE, sseDataLines } from "./sse.js";

/**
 * OpenAI-compatible chat provider implemented on top of the built-in fetch.
 * Works against OpenAI, DeepSeek, Qwen/DashScope, Moonshot, Ollama etc.
 *
 * Configuration (constructor overrides env vars):
 *   - OPENAI_API_KEY          (auth)
 *   - OPENAI_BASE_URL         default https://api.openai.com/v1
 *   - OPENAI_MODEL            default gpt-4o-mini
 */
export interface OpenAIClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** fetch-compatible abort / agent options. */
  fetchOptions?: RequestInit;
  /**
   * M8-4: 流式时一并请求 `stream_options: { include_usage: true }`，让服务端在
   * 最后一个块里带上用量（否则流式拿不到 token 计数，成本计量会缺一块）。
   *
   * 默认 **false**：该字段不属于 OpenAI 兼容协议的最小集，对未知字段严格的
   * 网关会直接 400。确认后端支持（OpenAI 官方支持）再显式打开。
   */
  includeUsage?: boolean;
}

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { cached_tokens?: number };
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason?: string | null;
}

interface OpenAIResponseBody {
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage;
  error?: { message?: string; type?: string };
}

/** 流式块：增量在 `choices[].delta`，`message` 不出现。 */
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAIUsage;
  error?: { message?: string; type?: string };
}

function serializeMessage(message: ChatMessage) {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return {
        role: "assistant" as const,
        content: message.content || null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      };
    case "tool":
      return {
        role: "tool" as const,
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}

function serializeTools(tools: readonly AnyTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: (t.parameters ?? { type: "object" }) as Record<string, unknown>,
    },
  }));
}

export class OpenAIClientProvider implements ModelProvider {
  readonly id = "openai-compatible";
  label: string;

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly fetchOptions?: RequestInit;
  private readonly includeUsage: boolean;

  constructor(options: OpenAIClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    const base = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.baseUrl = base.replace(/\/+$/, "");
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.fetchOptions = options.fetchOptions;
    this.includeUsage = options.includeUsage ?? false;
    this.label = `OpenAI-compatible(${this.model} @ ${this.baseUrl})`;
  }

  async chat(request: ModelRequest): Promise<ModelResponse> {
    this.assertUsable();
    const res = await this.post(this.buildBody(request, false), request.signal);
    const data = await readBody(res);
    if (!res.ok) throw this.httpError(res, data);
    return toModelResponse(data);
  }

  /**
   * M8-4: 流式生成。逐块把文本增量交给 `onDelta`，结束时返回与非流式
   * `chat()` 等价的 `ModelResponse` —— 这是 `message:delta` 的等价关系要求的
   * （拼接后的 content / toolCalls 必须与一次性生成一致）。
   *
   * 不支持流式的后端（返回非流、或中途 `error`）会抛 `ModelRequestError`：
   * 引擎只在**一个增量都没吐出**时才回退到 `chat()`，因此这里失败不会造成
   * 重复计费或重复输出。
   */
  async chatStream(request: ModelRequest, onDelta: (delta: string) => void): Promise<ModelResponse> {
    this.assertUsable();
    const res = await this.post(this.buildBody(request, true), request.signal);
    if (!res.ok) {
      // 错误响应不是 SSE，按普通响应体解析，保证错误信息可读。
      throw this.httpError(res, await readBody(res));
    }
    if (!res.body) {
      throw new ModelRequestError({
        providerId: this.id,
        message: `模型服务未返回可读流（${this.baseUrl}）：当前运行时不支持流式响应体，请关闭流式或升级运行时`,
        retryable: true,
      });
    }

    let content = "";
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason: string | null | undefined;
    let usage: OpenAIUsage | undefined;

    for await (const data of sseDataLines(res.body)) {
      if (data === SSE_DONE) break;
      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data) as OpenAIStreamChunk;
      } catch {
        // 网关的保活注释、心跳与偶发坏行都落在这里。内容行一定是合法 JSON，
        // 静默跳过比让整个 run 因一行噪声失败更符合可用性；若真丢了内容，
        // 错误会在下游暴露为「拼接结果与 model:response 不一致」。
        continue;
      }
      if (chunk.error) {
        throw new ModelRequestError({
          providerId: this.id,
          message: `模型服务流式返回错误：${chunk.error.message ?? chunk.error.type ?? "未知错误"}`,
          retryable: true,
        });
      }
      if (chunk.usage) usage = chunk.usage;

      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (typeof delta?.content === "string" && delta.content.length > 0) {
        content += delta.content;
        onDelta(delta.content);
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const acc = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
        if (call.id) acc.id = call.id;
        if (call.function?.name) acc.name += call.function.name;
        if (call.function?.arguments) acc.arguments += call.function.arguments;
        toolCalls.set(index, acc);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }

    const calls: RawToolCall[] = [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, acc]) => acc.name.length > 0)
      .map(([, acc]) => ({
        id: acc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: acc.name,
        arguments: acc.arguments || "{}",
      }));

    return {
      content: content.length > 0 ? content : null,
      toolCalls: calls,
      finishReason: mapFinishReason(finishReason, calls.length > 0),
      usage: usage ? toUsage(usage) : undefined,
    };
  }

  // ------------------------------------------------------------------ internals

  private assertUsable(): void {
    if (typeof fetch !== "function") {
      throw new ModelRequestError({
        providerId: this.id,
        message: "当前 Node.js 运行时没有全局 fetch，请升级到 Node 18+",
      });
    }
    if (!this.apiKey && !/ollama|localhost|127\.0\.0\.1/.test(this.baseUrl)) {
      throw new ModelRequestError({
        providerId: this.id,
        message:
          "缺少 API Key：请设置环境变量 OPENAI_API_KEY，或在构造时传入 apiKey（本地 OpenAI 兼容服务可忽略）",
      });
    }
  }

  private buildBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const messages = request.system
      ? [{ role: "system" as const, content: request.system }, ...request.messages.map(serializeMessage)]
      : request.messages.map(serializeMessage);

    return {
      model: this.model,
      messages,
      temperature: request.temperature ?? this.temperature ?? 0.7,
      stream,
      ...(stream && this.includeUsage ? { stream_options: { include_usage: true } } : {}),
      ...((request.maxTokens ?? this.maxTokens)
        ? { max_tokens: request.maxTokens ?? this.maxTokens }
        : {}),
      ...(request.tools && request.tools.length > 0
        ? { tools: serializeTools(request.tools), tool_choice: "auto" as const }
        : {}),
    };
  }

  private async post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(body.stream ? { accept: "text/event-stream" } : {}),
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
        ...this.fetchOptions,
      });
    } catch (err) {
      // 取消必须原样抛出：引擎靠它把「用户中断」和「后端故障」区分开。
      if (err instanceof Error && err.name === "AbortError") throw err;
      throw new ModelRequestError({
        providerId: this.id,
        message: `无法连接模型服务（${this.baseUrl}）：${(err as Error).message}`,
        retryable: true,
        cause: err,
      });
    }
  }

  private httpError(res: Response, data: OpenAIResponseBody): ModelRequestError {
    return new ModelRequestError({
      providerId: this.id,
      message: `模型服务返回 ${res.status}: ${data.error?.message ?? data.error?.type ?? res.statusText}`,
      status: res.status,
      retryable: res.status >= 500 || res.status === 429,
    });
  }
}

async function readBody(res: Response): Promise<OpenAIResponseBody> {
  try {
    return (await res.json()) as OpenAIResponseBody;
  } catch {
    const text = await res.text().catch(() => "");
    return { error: { message: text.slice(0, 300) || "响应不是合法 JSON" } };
  }
}

function toUsage(usage: OpenAIUsage): ModelResponse["usage"] {
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...(usage.prompt_tokens_details?.cached_tokens !== undefined
      ? { cachedInputTokens: usage.prompt_tokens_details.cached_tokens }
      : {}),
  };
}

function toModelResponse(data: OpenAIResponseBody): ModelResponse {
  const choice = data.choices?.[0];
  const toolCalls: RawToolCall[] = (choice?.message?.tool_calls ?? [])
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
      name: tc.function!.name!,
      arguments: tc.function?.arguments ?? "{}",
    }));

  return {
    content: choice?.message?.content ?? null,
    toolCalls,
    finishReason: mapFinishReason(choice?.finish_reason, toolCalls.length > 0),
    usage:
      data.usage?.prompt_tokens !== undefined
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens ?? 0,
            ...(data.usage.prompt_tokens_details?.cached_tokens !== undefined
              ? { cachedInputTokens: data.usage.prompt_tokens_details.cached_tokens }
              : {}),
          }
        : undefined,
  };
}

function mapFinishReason(reason: string | null | undefined, hasToolCalls: boolean): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    default:
      return hasToolCalls ? "tool_calls" : "stop";
  }
}
