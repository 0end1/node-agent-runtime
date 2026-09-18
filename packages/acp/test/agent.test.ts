import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  MemoryStorage,
  defineTool,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@node-agent-runtime/core";
import { MockProvider } from "@node-agent-runtime/mock";
import { AcpAgent } from "../src/agent.js";
import { AcpConnection } from "../src/connection.js";
import type {
  InitializeResult,
  NewSessionResult,
  PromptResult,
  SessionUpdateParams,
} from "../src/protocol.js";
import { MemoryTransportPair } from "../src/transport.js";

const noop = (): void => {};

const echo = defineTool({
  name: "echo",
  description: "Echo a string back.",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async execute(args: { text: string }) {
    return args.text;
  },
});

/** A provider that answers with a fixed script — deterministic tool-call turns. */
class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly label = "Scripted";
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async chat(): Promise<ModelResponse> {
    const next = this.responses[this.index++];
    return next ?? { content: "done", toolCalls: [], finishReason: "stop" };
  }
}

/** Hangs until the run is aborted, like a real SDK whose request was cancelled. */
class HangingProvider implements ModelProvider {
  readonly id = "hanging";
  readonly label = "Hanging";

  chat(request: ModelRequest): Promise<ModelResponse> {
    return new Promise((_resolve, reject) => {
      const fail = (): void => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (request.signal?.aborted) return fail();
      request.signal?.addEventListener("abort", fail, { once: true });
    });
  }
}

interface Harness {
  client: AcpConnection;
  updates: SessionUpdateParams[];
}

async function harness(options: {
  storage?: MemoryStorage;
  provider?: ModelProvider;
} = {}): Promise<Harness> {
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
    provider: options.provider ?? new MockProvider({ now: () => new Date() }),
    agents: [new Agent({ name: "assistant", tools: [echo] })],
    storage: options.storage ?? new MemoryStorage(),
    defaultAgentId: "assistant",
    logger: noop,
  });
  await agent.start(pair.agent);
  return { client, updates };
}

async function newSession(client: AcpConnection): Promise<string> {
  const created = (await client.request("session/new", { cwd: "/tmp" })) as NewSessionResult;
  return created.sessionId;
}

describe("AcpAgent — prompt turn", () => {
  it("negotiates capabilities, creates a session and completes a turn", async () => {
    const { client, updates } = await harness();

    const init = (await client.request("initialize", { protocolVersion: 1 })) as InitializeResult;
    assert.equal(init.protocolVersion, 1);
    assert.equal(init.agentCapabilities?.loadSession, true);
    assert.deepEqual(init.authMethods, []);

    const sessionId = await newSession(client);
    assert.ok(sessionId.startsWith("session_"));

    const prompt = (await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "hello" }],
    })) as PromptResult;
    assert.equal(prompt.stopReason, "end_turn");

    const kinds = updates.map((entry) => entry.update.sessionUpdate);
    assert.ok(kinds.includes("agent_message_chunk"), `期望消息块，实际：${kinds.join()}`);
    assert.ok(kinds.includes("usage_update"), `期望用量更新，实际：${kinds.join()}`);
    assert.ok(updates.every((entry) => entry.sessionId === sessionId));
  });

  it("renders tool calls as tool_call then tool_call_update", async () => {
    const { client, updates } = await harness({
      provider: new ScriptedProvider([
        {
          content: "",
          toolCalls: [{ id: "call_1", name: "echo", arguments: JSON.stringify({ text: "ping" }) }],
          finishReason: "tool_calls",
        },
        { content: "pong", toolCalls: [], finishReason: "stop" },
      ]),
    });
    const sessionId = await newSession(client);
    const prompt = (await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "echo ping" }],
    })) as PromptResult;
    assert.equal(prompt.stopReason, "end_turn");

    const calls = updates.filter((entry) => entry.update.sessionUpdate === "tool_call");
    const patches = updates.filter((entry) => entry.update.sessionUpdate === "tool_call_update");
    assert.equal(calls.length, 1);
    assert.equal(patches.length, 1);
    assert.deepEqual(calls[0].update, {
      sessionUpdate: "tool_call",
      toolCallId: "call_1",
      title: "echo",
      kind: "other",
      status: "pending",
      rawInput: { text: "ping" },
    });
    assert.deepEqual(patches[0].update, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ping" } }],
    });
  });

  it("answers session/cancel with the `cancelled` stop reason, not an error", async () => {
    const { client } = await harness({ provider: new HangingProvider() });
    const sessionId = await newSession(client);

    const pending = client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "take your time" }],
    });
    // Let the turn reach the provider before asking it to stop.
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.notify("session/cancel", { sessionId });

    const prompt = (await pending) as PromptResult;
    assert.equal(prompt.stopReason, "cancelled");
  });

  it("replays a persisted transcript on session/load", async () => {
    const storage = new MemoryStorage();
    const first = await harness({ storage });
    const sessionId = await newSession(first.client);
    await first.client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "hello again" }],
    });

    // A fresh agent process over the same store: the conversation comes back.
    const second = await harness({ storage });
    const loaded = await second.client.request("session/load", { sessionId, cwd: "/tmp" });
    assert.equal(loaded, null);
    const kinds = second.updates.map((entry) => entry.update.sessionUpdate);
    assert.ok(kinds.includes("user_message_chunk"), `期望用户消息回放，实际：${kinds.join()}`);
    assert.ok(kinds.includes("agent_message_chunk"), `期望助手消息回放，实际：${kinds.join()}`);
  });

  it("rejects prompts for unknown sessions instead of inventing one", async () => {
    const { client } = await harness();
    await assert.rejects(
      () => client.request("session/prompt", { sessionId: "ghost", prompt: [{ type: "text", text: "hi" }] }),
      /未知会话/,
    );
  });
});
