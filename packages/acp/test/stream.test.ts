import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  MemoryStorage,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@node-agent-runtime/core";
import { AcpAgent } from "../src/agent.js";
import { AcpConnection } from "../src/connection.js";
import type {
  AgentMessageChunkUpdate,
  NewSessionResult,
  SessionUpdate,
  SessionUpdateParams,
} from "../src/protocol.js";
import { MemoryTransportPair } from "../src/transport.js";

/**
 * M8-4: ACP 侧的 token 级 `agent_message_chunk`。
 *
 * 守的行为：① 增量逐块下发；② **同一条消息不会被发两遍**（增量一遍 +
 * `model:response` 整段一遍）—— 这是流式最容易被写出的 bug。
 */

const noop = (): void => {};

class StreamingProvider implements ModelProvider {
  readonly id = "streaming";
  readonly label = "Streaming";

  async chat(): Promise<ModelResponse> {
    return { content: "你好，世界", toolCalls: [], finishReason: "stop" };
  }

  async chatStream(_request: ModelRequest, onDelta: (delta: string) => void): Promise<ModelResponse> {
    for (const piece of ["你好", "，", "世界"]) onDelta(piece);
    return this.chat();
  }
}

async function harness(options: { provider?: ModelProvider; stream?: boolean } = {}) {
  const pair = new MemoryTransportPair();
  const updates: SessionUpdateParams[] = [];
  const client = new AcpConnection(pair.client, {
    notifications: {
      "session/update": (params) => {
        updates.push(params as SessionUpdateParams);
      },
    },
  });
  const agent = new AcpAgent({
    provider: options.provider ?? new StreamingProvider(),
    agents: [new Agent({ name: "assistant", tools: [] })],
    storage: new MemoryStorage(),
    defaultAgentId: "assistant",
    logger: noop,
    ...(options.stream === undefined ? {} : { stream: options.stream }),
  });
  await agent.start(pair.agent);
  const created = (await client.request("session/new", { cwd: "/tmp" })) as NewSessionResult;
  return { client, updates, sessionId: created.sessionId };
}

const chunks = (updates: SessionUpdateParams[]): AgentMessageChunkUpdate[] =>
  updates
    .map((u) => u.update)
    .filter((u): u is AgentMessageChunkUpdate => u.sessionUpdate === "agent_message_chunk");

describe("AcpAgent — streaming chunks (M8-4)", () => {
  it("默认把文本逐块推给客户端，且不重复补发整段", async () => {
    const { client, updates, sessionId } = await harness();
    await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "说点什么" }],
    });

    const parts = chunks(updates);
    assert.deepEqual(
      parts.map((p) => (p.content as { text: string }).text),
      ["你好", "，", "世界"],
    );
    // 全部属于同一条消息：客户端据此拼回一段完整文本。
    assert.equal(new Set(parts.map((p) => p.messageId)).size, 1);
  });

  it("关闭流式时仍是 M8-2 的一步一条完整 chunk", async () => {
    const { client, updates, sessionId } = await harness({ stream: false });
    await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "说点什么" }],
    });

    const parts = chunks(updates);
    assert.deepEqual(
      parts.map((p) => (p.content as { text: string }).text),
      ["你好，世界"],
    );
  });

  it("provider 不支持流式时自动降级为整段（客户端无感）", async () => {
    class PlainProvider implements ModelProvider {
      readonly id = "plain";
      readonly label = "Plain";
      async chat(): Promise<ModelResponse> {
        return { content: "一次性返回", toolCalls: [], finishReason: "stop" };
      }
    }
    const { client, updates, sessionId } = await harness({ provider: new PlainProvider() });
    await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "说点什么" }],
    });

    assert.deepEqual(
      chunks(updates).map((p) => (p.content as { text: string }).text),
      ["一次性返回"],
    );
  });
});
