import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ModelRequestError, defineTool } from "@agent-runtime/core";
import type { ModelRequest } from "@agent-runtime/core";
import { OpenAIClientProvider } from "@agent-runtime/provider-openai";

// ---- fetch stubbing helpers ------------------------------------------------

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>): {
  url: string;
  init: RequestInit;
} {
  const captured: { url: string; init: RequestInit } = { url: "", init: {} };
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init ?? {};
    return impl(String(url), init ?? {});
  }) as typeof fetch;
  return captured;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---- fixtures ---------------------------------------------------------------

const calcTool = defineTool({
  name: "calculator",
  description: "计算数学表达式",
  parameters: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
  async execute(args: { expression: string }) {
    return { formatted: String(eval(args.expression)) };
  },
});

const req: ModelRequest = {
  messages: [{ role: "user", content: "3.5 + 2 等于多少？" }],
  system: "你是计算助手",
  tools: [calcTool],
  temperature: 0.2,
};

describe("OpenAIClientProvider", () => {
  it("sends a serialized chat/completions request (model, messages, tools)", async () => {
    const captured = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "5.5" }, finish_reason: "stop" }] }),
    );
    const provider = new OpenAIClientProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1/",
      model: "gpt-test",
    });

    const res = await provider.chat(req);

    assert.equal(captured.url, "https://example.com/v1/chat/completions");
    assert.equal((captured.init.headers as Record<string, string>).authorization, "Bearer sk-test");
    const body = JSON.parse(String(captured.init.body)) as {
      model: string;
      stream: boolean;
      temperature: number;
      messages: unknown[];
      tools: unknown[];
    };
    assert.equal(body.model, "gpt-test");
    assert.equal(body.stream, false);
    assert.equal(body.temperature, 0.2);
    assert.equal(body.messages.length, 2); // system + user
    assert.equal((body.messages[0] as { role: string }).role, "system");
    assert.equal((body.tools as unknown[]).length, 1);
    assert.equal((body.tools[0] as { function: { name: string } }).function.name, "calculator");
    assert.equal(res.content, "5.5");
    assert.equal(res.finishReason, "stop");
  });

  it("parses tool_calls from the response into RawToolCall", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "calculator", arguments: '{"expression":"3.5+2"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    );
    const provider = new OpenAIClientProvider({
      apiKey: "sk-test",
      baseUrl: "http://localhost:1234/v1",
    });

    const res = await provider.chat({ messages: [{ role: "user", content: "hi" }] });

    assert.equal(res.finishReason, "tool_calls");
    assert.equal(res.toolCalls.length, 1);
    assert.deepEqual(res.toolCalls[0]?.arguments, '{"expression":"3.5+2"}');
    assert.equal(res.usage?.inputTokens, 12);
    assert.equal(res.usage?.outputTokens, 4);
  });

  it("round-trips assistant tool calls and tool results back to the wire", async () => {
    const captured = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    );
    const provider = new OpenAIClientProvider({ apiKey: "sk", baseUrl: "http://localhost:1/v1" });

    await provider.chat({
      messages: [
        { role: "user", content: "3.5+2" },
        {
          role: "assistant",
          content: "I'll calculate",
          toolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "3.5+2" } }],
        },
        { role: "tool", toolCallId: "call_1", content: '{"value":5.5}' },
      ],
    });

    const sent = JSON.parse(String(captured.init.body)) as {
      messages: Array<Record<string, unknown>>;
    };
    assert.equal((sent.messages[1] as { tool_calls: unknown[] }).tool_calls.length, 1);
    assert.deepEqual(
      (
        sent.messages[1] as {
          tool_calls: Array<{ function: { name: string; arguments: string } }>;
        }
      ).tool_calls[0]?.function,
      { name: "calculator", arguments: '{"expression":"3.5+2"}' },
    );
    assert.equal((sent.messages[2] as { tool_call_id: string }).tool_call_id, "call_1");
  });

  it("maps a non-2xx response to ModelRequestError with status", async () => {
    stubFetch(() =>
      jsonResponse({ error: { message: "rate limited", type: "rate_limit_error" } }, 429),
    );
    const provider = new OpenAIClientProvider({ apiKey: "sk", baseUrl: "http://localhost:1/v1" });

    await assert.rejects(
      () => provider.chat({ messages: [{ role: "user", content: "hi" }] }),
      (err: unknown) => {
        assert.ok(err instanceof ModelRequestError);
        assert.equal(err.status, 429);
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });

  it("throws a ModelRequestError when no api key is configured for a remote host", async () => {
    const provider = new OpenAIClientProvider({ baseUrl: "https://api.openai.com/v1" });
    await assert.rejects(
      () => provider.chat({ messages: [{ role: "user", content: "hi" }] }),
      /OPENAI_API_KEY/,
    );
  });

  it("allows local endpoints (localhost/ollama) without an api key", async () => {
    const captured = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }),
    );
    const provider = new OpenAIClientProvider({ baseUrl: "http://localhost:11434/v1" });
    const res = await provider.chat({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(res.content, "hi");
    assert.ok(!captured.init.headers || !("authorization" in captured.init.headers));
  });

  it("wraps network errors as retryable ModelRequestError", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const provider = new OpenAIClientProvider({ apiKey: "sk", baseUrl: "http://localhost:1/v1" });
    await assert.rejects(
      () => provider.chat({ messages: [{ role: "user", content: "hi" }] }),
      (err: unknown) => err instanceof ModelRequestError && err.retryable === true,
    );
  });

  it("respects a system prompt by prepending it to the message list", async () => {
    const captured = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    );
    const provider = new OpenAIClientProvider({ apiKey: "sk", baseUrl: "http://localhost:1/v1" });
    await provider.chat({ messages: [{ role: "user", content: "hello" }], system: "SYSTEM-X" });
    const body = JSON.parse(String(captured.init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.messages[0]?.content, "SYSTEM-X");
    assert.equal(body.messages[0]?.role, "system");
  });
});
