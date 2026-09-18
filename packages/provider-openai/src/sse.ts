/**
 * M8-4: 极简 SSE（Server-Sent Events）读取器。
 *
 * 只实现 OpenAI `/chat/completions` 流式响应真正用到的那部分：`data:` 行 +
 * `[DONE]` 哨兵。不实现重连、`event:` / `id:` 语义与 `retry:` —— 一次模型调用
 * 就是一次请求/响应，重连属于 SDK 层而不是协议层，做了也只是没人走的分支。
 *
 * 关键点是**跨 chunk 的行边界**：网络分片不会照顾行边界，一个 `data:` 行常
 * 被切成多次 `reader.read()`，所以必须保留残余 buffer 而不是按 chunk 解析。
 */

/** 一次 `data:` 行的载荷（已去掉前缀与首尾空白）。 */
export type SseData = string;

/**
 * 逐行产出 SSE 的 `data:` 载荷；`[DONE]` 也会作为一条产出（由调用方判定结束）。
 * 非 `data:` 行（`:` 注释、`event:`、`id:` 等）被忽略。
 */
export async function* sseDataLines(body: ReadableStream<Uint8Array>): AsyncGenerator<SseData> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const data = dataOf(line);
        if (data !== undefined) yield data;
        newline = buffer.indexOf("\n");
      }
    }
    // 末尾没有换行符的最后一行（部分网关不补 \n）也要吐出来。
    const tail = dataOf(buffer);
    if (tail !== undefined) yield tail;
  } finally {
    // 流被提前中断（break / 抛错）时把底层释放掉，避免挂着连接。
    try {
      reader.cancel().catch(() => {});
    } catch {
      /* 某些 ReadableStream 实现不允许 cancel，忽略 */
    }
  }
}

/** `"data: xxx"` → `"xxx"`；不是 data 行则返回 undefined。 */
function dataOf(rawLine: string): string | undefined {
  const line = rawLine.replace(/\r$/, "").trim();
  if (!line.startsWith("data:")) return undefined;
  const data = line.slice(5).trim();
  return data.length > 0 ? data : undefined;
}

/** OpenAI 流式结束哨兵。 */
export const SSE_DONE = "[DONE]";
