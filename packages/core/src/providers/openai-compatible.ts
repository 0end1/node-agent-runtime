import {
  ModelRequestError,
  type FinishReason,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RawToolCall,
} from "../provider.js";
import type { AnyTool } from "../tool.js";
import type { ChatMessage } from "@agent-runtime/types";

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
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface OpenAIResponseBody {
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
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

  constructor(options: OpenAIClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    const base = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.baseUrl = base.replace(/\/+$/, "");
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.fetchOptions = options.fetchOptions;
    this.label = `OpenAI-compatible(${this.model} @ ${this.baseUrl})`;
  }

  async chat(request: ModelRequest): Promise<ModelResponse> {
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

    const messages = request.system
      ? [{ role: "system" as const, content: request.system }, ...request.messages.map(serializeMessage)]
      : request.messages.map(serializeMessage);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? this.temperature ?? 0.7,
      stream: false,
      ...(request.maxTokens ?? this.maxTokens ? { max_tokens: request.maxTokens ?? this.maxTokens } : {}),
      ...(request.tools && request.tools.length > 0
        ? { tools: serializeTools(request.tools), tool_choice: "auto" as const }
        : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: request.signal,
        ...this.fetchOptions,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw err;
      }
      throw new ModelRequestError({
        providerId: this.id,
        message: `无法连接模型服务（${this.baseUrl}）：${(err as Error).message}`,
        retryable: true,
        cause: err,
      });
    }

    let data: OpenAIResponseBody = {};
    try {
      data = (await res.json()) as OpenAIResponseBody;
    } catch {
      const text = await res.text().catch(() => "");
      data = { error: { message: text.slice(0, 300) || "响应不是合法 JSON" } };
    }

    if (!res.ok) {
      throw new ModelRequestError({
        providerId: this.id,
        message: `模型服务返回 ${res.status}: ${data.error?.message ?? data.error?.type ?? res.statusText}`,
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
      });
    }

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
            }
          : undefined,
    };
  }
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
