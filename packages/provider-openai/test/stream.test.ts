import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ModelRequestError, type ModelRequest } from "@node-agent-runtime/core";
import { OpenAIClientProvider } from "@node-agent-runtime/provider-openai";
import { sseDataLines } from "../src/sse.js";

/**
 * M8-4: OpenAI 兼容后端的 SSE 解析。
 *
 * 重点覆盖两处真实风险：① 网络分片不保证行边界（`data:` 行常被切成两半）；
 * ② 工具调用的参数是**分块到达的字符串**，必须按 index 累积再整体解析。
 */

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const captured: { url: string; init: RequestInit } = { url: "", init: {} };
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init ?? {};
    return impl(String(url), init ?? {});
  }) as typeof fetch;
  return captured;
}

/** 每个元素是一次网络分片 —— 刻意让分片边界与行边界错开。 */
function sseResponse(chunks: readonly string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
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

const req: ModelRequest = { messages: [{ role: "user", content: "你好" }] };
const provider = () => new OpenAIClientProvider({ apiKey: "sk-test", baseUrl: "https://example.com/v1" });

describe("sse — 行解析", () => {
  it("跨 chunk 的行边界也能拼回完整 data 行", async () => {
    const chunks = [
      'data: {"a":',
      '1}\n\ndata: {"b":2}\n\n',
      ": keep-alive\n\n",
      "data: [DONE]\n\n",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    const seen: string[] = [];
    for await (const data of sseDataLines(stream)) seen.push(data);
    assert.deepEqual(seen, ['{"a":1}', '{"b":2}', "[DONE]"]);
  });

  it("兼容 \\r\\n 与末尾没有换行的最后一行", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: first\r\n\r\ndata: last'));
        controller.close();
      },
    });
    const seen: string[] = [];
    for await (const data of sseDataLines(stream)) seen.push(data);
    assert.deepEqual(seen, ["first", "last"]);
  });
});

describe("OpenAIClientProvider.chatStream", () => {
  it("请求体带 stream=true，并按块回吐文本", async () => {
    const captured = stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const deltas: string[] = [];
    const res = await provider().chatStream(req, (delta) => deltas.push(delta));

    assert.equal(JSON.parse(String(captured.init.body)).stream, true);
    assert.equal((captured.init.headers as Record<string, string>).accept, "text/event-stream");
    assert.deepEqual(deltas, ["你好", "，世界"]);
    assert.equal(res.content, "你好，世界");
    assert.equal(res.finishReason, "stop");
    assert.deepEqual(res.toolCalls, []);
  });

  it("分片边界错开时仍能正确拼接（真实网络就是这样）", async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"cont',
        'ent":"你好"}}]}\n\ndata: {"choices":[{"delta":',
        '{"content":"，世界"}}]}\n\ndata: [DONE]\n\n',
      ]),
    );

    const deltas: string[] = [];
    const res = await provider().chatStream(req, (delta) => deltas.push(delta));
    assert.deepEqual(deltas, ["你好", "，世界"]);
    assert.equal(res.content, "你好，世界");
  });

  it("按 index 累积工具调用的参数分片", async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"calculator","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"ex"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"pression\\":\\"1+1\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const deltas: string[] = [];
    const res = await provider().chatStream(req, (delta) => deltas.push(delta));

    // 文本增量为 null/空时不回调，故这里没有 delta。
    assert.deepEqual(deltas, []);
    assert.equal(res.finishReason, "tool_calls");
    assert.equal(res.toolCalls.length, 1);
    assert.deepEqual(res.toolCalls[0], {
      id: "call_1",
      name: "calculator",
      arguments: '{"expression":"1+1"}',
    });
  });

  it("末块 usage 被收进 ModelResponse；stream_options 仅在 includeUsage 时发送", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":4}}}\n\n',
      "data: [DONE]\n\n",
    ];

    const offCapture = stubFetch(() => sseResponse(sse));
    const off = await provider().chatStream(req, () => {});
    assert.deepEqual(off.usage, { inputTokens: 11, outputTokens: 2, cachedInputTokens: 4 });
    // 默认不发未知字段：对严格网关来说 `stream_options` 可能直接 400。
    assert.equal(JSON.parse(String(offCapture.init.body)).stream_options, undefined);

    const onCapture = stubFetch(() => sseResponse(sse));
    const on = new OpenAIClientProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      includeUsage: true,
    });
    const res = await on.chatStream(req, () => {});
    assert.deepEqual(res.usage, { inputTokens: 11, outputTokens: 2, cachedInputTokens: 4 });
    assert.deepEqual(JSON.parse(String(onCapture.init.body)).stream_options, {
      include_usage: true,
    });
  });

  it("[DONE] 之后的内容不再处理；坏行与心跳被跳过", async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"前"}}]}\n\n',
        "data: [DONE]\n\n",
        'data: {"choices":[{"delta":{"content":"不该出现"}}]}\n\n',
        "data: 这不是 JSON\n\n",
        ": ping\n\n",
      ]),
    );

    const deltas: string[] = [];
    const res = await provider().chatStream(req, (delta) => deltas.push(delta));
    assert.deepEqual(deltas, ["前"]);
    assert.equal(res.content, "前");
  });

  it("流里的 error 字段抛 ModelRequestError（可被引擎回退）", async () => {
    stubFetch(() =>
      sseResponse(['data: {"error":{"message":"rate limited","type":"rate_limit"}}\n\n']),
    );

    await assert.rejects(
      () => provider().chatStream(req, () => {}),
      (err: unknown) =>
        err instanceof ModelRequestError && /rate limited/.test(err.message) && err.retryable,
    );
  });

  it("非 2xx 响应按普通错误体解析（不是 SSE）", async () => {
    stubFetch(() => jsonResponse({ error: { message: "bad key" } }, 401));

    await assert.rejects(
      () => provider().chatStream(req, () => {}),
      (err: unknown) => err instanceof ModelRequestError && err.status === 401 && /bad key/.test(err.message),
    );
  });
});
