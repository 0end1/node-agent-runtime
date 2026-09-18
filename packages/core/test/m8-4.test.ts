import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AgentRuntime,
  defineAgent,
  type MessageDeltaEvent,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RuntimeEvent,
} from "@node-agent-runtime/core";

/**
 * M8-4: 引擎侧流式行为。
 *
 * 这里守的是两条不变量：
 *  1. **等价** —— `message:delta` 按序拼接 == 该步 `model:response` 的文本；
 *  2. **回退只发生在没吐出过任何块之前** —— 出过块再回退会重复计费、重复输出。
 */

interface ScriptedOptions {
  /** 分块文本。 */
  pieces: string[];
  /** 首块之前就失败（模拟后端不支持流式）。 */
  failBeforeFirst?: boolean;
  /** 吐出第 n 块之后失败（模拟流式中途断流）。 */
  failAfter?: number;
}

class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly label = "scripted";
  chatCalls = 0;
  streamCalls = 0;

  constructor(private readonly options: ScriptedOptions) {}

  async chat(_request: ModelRequest): Promise<ModelResponse> {
    this.chatCalls += 1;
    return response(this.options.pieces.join(""));
  }

  async chatStream(_request: ModelRequest, onDelta: (delta: string) => void): Promise<ModelResponse> {
    this.streamCalls += 1;
    if (this.options.failBeforeFirst) throw new Error("stream unsupported");
    for (const [index, piece] of this.options.pieces.entries()) {
      if (this.options.failAfter !== undefined && index >= this.options.failAfter) {
        throw new Error("stream broken mid-flight");
      }
      onDelta(piece);
    }
    return response(this.options.pieces.join(""));
  }
}

function response(content: string): ModelResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function agent() {
  return defineAgent({ name: "assistant", instructions: "be brief" });
}

async function collect(provider: ModelProvider, stream: boolean | undefined) {
  const runtime = new AgentRuntime({ provider });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  const result = await runtime.run({
    agent: agent(),
    input: "你好",
    ...(stream === undefined ? {} : { stream }),
  });
  return { result, events };
}

describe("M8-4 streaming — delta 与 model:response 等价", () => {
  it("拼接所有 delta 等于该步最终文本，且 index 连续", async () => {
    const provider = new ScriptedProvider({ pieces: ["你好", "，", "世界"] });
    const { result, events } = await collect(provider, true);

    const deltas = events.filter((e): e is MessageDeltaEvent => e.type === "message:delta");
    assert.deepEqual(
      deltas.map((d) => d.delta),
      ["你好", "，", "世界"],
    );
    assert.deepEqual(
      deltas.map((d) => d.index),
      [0, 1, 2],
    );
    assert.equal(deltas.map((d) => d.delta).join(""), result.output);
    assert.equal(deltas.length, 3);
  });

  it("默认关闭：不产生任何 message:delta（事件流与流式之前一致）", async () => {
    const provider = new ScriptedProvider({ pieces: ["你好", "世界"] });
    const { events } = await collect(provider, undefined);

    assert.equal(
      events.some((e) => e.type === "message:delta"),
      false,
    );
    assert.equal(provider.streamCalls, 0);
    assert.equal(provider.chatCalls, 1);
  });

  it("provider 没实现 chatStream 时静默降级（不是错误）", async () => {
    class PlainProvider implements ModelProvider {
      readonly id = "plain";
      readonly label = "plain";
      chatCalls = 0;
      async chat(): Promise<ModelResponse> {
        this.chatCalls += 1;
        return response("一次性返回");
      }
    }
    const provider = new PlainProvider();
    const { result, events } = await collect(provider, true);

    assert.equal(result.output, "一次性返回");
    assert.equal(provider.chatCalls, 1);
    assert.equal(
      events.some((e) => e.type === "message:delta"),
      false,
    );
  });
});

describe("M8-4 streaming — 回退时机", () => {
  it("首块之前失败 → 回退到 chat，run 照常完成", async () => {
    const provider = new ScriptedProvider({ pieces: ["你好"], failBeforeFirst: true });
    const { result, events } = await collect(provider, true);

    assert.equal(result.output, "你好");
    assert.equal(provider.streamCalls, 1);
    assert.equal(provider.chatCalls, 1); // 回退确实发生
    assert.equal(
      events.some((e) => e.type === "message:delta"),
      false,
    );
  });

  it("已经吐出块之后失败 → 不回退（错误冒泡，不重复调用）", async () => {
    const provider = new ScriptedProvider({ pieces: ["你好", "，", "世界"], failAfter: 1 });
    const runtime = new AgentRuntime({ provider });
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));

    await assert.rejects(
      () => runtime.run({ agent: agent(), input: "你好", stream: true }),
      /stream broken mid-flight/,
    );

    // 关键：只调用过一次流式，没有再跑一次非流式（否则重复计费 + 重复输出）。
    assert.equal(provider.streamCalls, 1);
    assert.equal(provider.chatCalls, 0);
    const deltas = events.filter((e): e is MessageDeltaEvent => e.type === "message:delta");
    assert.deepEqual(
      deltas.map((d) => d.delta),
      ["你好"],
    );
  });
});
