import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  MemoryStorage,
  defineTool,
  type ModelProvider,
  type ModelResponse,
} from "@node-agent-runtime/core";
import { AcpAgent } from "../src/agent.js";
import { AcpConnection } from "../src/connection.js";
import type {
  NewSessionResult,
  RequestPermissionParams,
  RequestPermissionResult,
  SessionUpdateParams,
  SetConfigOptionResult,
  ToolCallPatchUpdate,
} from "../src/protocol.js";
import { MemoryTransportPair } from "../src/transport.js";

const noop = (): void => {};

/** Classified as a `write` tool: `ask` under workspace-write, `deny` read-only. */
const writeFile = defineTool({
  name: "write_file",
  description: "Write a file (test double: never touches the disk).",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  async execute(args: { path: string }) {
    return `written ${args.path}`;
  },
});

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

interface Harness {
  client: AcpConnection;
  updates: SessionUpdateParams[];
  requests: RequestPermissionParams[];
}

async function harness(): Promise<Harness> {
  const pair = new MemoryTransportPair();
  const updates: SessionUpdateParams[] = [];
  const requests: RequestPermissionParams[] = [];
  const client = new AcpConnection(pair.client, {
    notifications: {
      "session/update": (params) => updates.push(params as SessionUpdateParams),
    },
    methods: {
      "session/request_permission": (params) => {
        requests.push(params as RequestPermissionParams);
        const result: RequestPermissionResult = {
          outcome: { outcome: "selected", optionId: "allow_once" },
        };
        return result;
      },
    },
  });
  const agent = new AcpAgent({
    provider: new ScriptedProvider([
      {
        content: "",
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: JSON.stringify({ path: "/tmp/a.txt" }) },
        ],
        finishReason: "tool_calls",
      },
      { content: "done", toolCalls: [], finishReason: "stop" },
    ]),
    agents: [new Agent({ name: "assistant", tools: [writeFile] })],
    storage: new MemoryStorage(),
    defaultAgentId: "assistant",
    logger: noop,
  });
  await agent.start(pair.agent);
  return { client, updates, requests };
}

async function newSession(client: AcpConnection): Promise<NewSessionResult> {
  return (await client.request("session/new", { cwd: "/tmp" })) as NewSessionResult;
}

async function prompt(client: AcpConnection, sessionId: string): Promise<void> {
  await client.request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "write something" }],
  });
}

function statusOf(updates: SessionUpdateParams[], toolCallId: string): string | undefined {
  const patches = updates
    .map((entry) => entry.update)
    .filter((update): update is ToolCallPatchUpdate => update.sessionUpdate === "tool_call_update")
    .filter((update) => update.toolCallId === toolCallId);
  return patches.at(-1)?.status;
}

describe("session modes & config options", () => {
  it("publishes both selector surfaces on session/new", async () => {
    const { client } = await harness();
    const created = await newSession(client);

    assert.equal(created.modes?.currentModeId, "workspace-write");
    assert.deepEqual(
      created.modes?.availableModes.map((mode) => mode.id),
      ["read-only", "workspace-write", "full-access"],
    );
    assert.equal(created.configOptions?.length, 1);
    const option = created.configOptions?.[0];
    assert.equal(option?.id, "mode");
    assert.equal(option?.category, "mode");
    assert.equal(option?.type, "select");
    assert.equal(option?.currentValue, "workspace-write");
    // Both surfaces must agree — clients pick one and never see a stale mode.
    assert.equal(option?.currentValue, created.modes?.currentModeId);
  });

  it("makes the next turn stricter after session/set_mode", async () => {
    const { client, updates, requests } = await harness();
    const { sessionId } = await newSession(client);

    await client.request("session/set_mode", { sessionId, modeId: "read-only" });
    await prompt(client, sessionId);

    // Under read-only the policy denies writes outright: no dialog, no run.
    assert.deepEqual(requests, []);
    assert.equal(statusOf(updates, "call_1"), "failed");

    // Clients on the legacy surface are told the mode actually changed.
    const modes = updates
      .map((entry) => entry.update)
      .filter((update) => update.sessionUpdate === "current_mode_update");
    assert.deepEqual(modes, [{ sessionUpdate: "current_mode_update", modeId: "read-only" }]);
  });

  it("applies session/set_config_option and answers with the full state", async () => {
    const { client, updates, requests } = await harness();
    const { sessionId } = await newSession(client);

    const result = (await client.request("session/set_config_option", {
      sessionId,
      configId: "mode",
      value: "read-only",
    })) as SetConfigOptionResult;

    assert.equal(result.configOptions[0].currentValue, "read-only");
    assert.equal(result.configOptions[0].id, "mode");

    await prompt(client, sessionId);
    assert.deepEqual(requests, []);
    assert.equal(statusOf(updates, "call_1"), "failed");
  });

  it("loosens again when switching back to workspace-write", async () => {
    const { client, updates, requests } = await harness();
    const { sessionId } = await newSession(client);

    await client.request("session/set_mode", { sessionId, modeId: "read-only" });
    await client.request("session/set_mode", { sessionId, modeId: "workspace-write" });
    await prompt(client, sessionId);

    // Back to `ask`: the client is consulted, and its approval lets it run.
    assert.equal(requests.length, 1);
    assert.equal(statusOf(updates, "call_1"), "completed");
  });

  it("rejects an unknown mode instead of switching to something invented", async () => {
    const { client } = await harness();
    const { sessionId } = await newSession(client);

    await assert.rejects(
      () => client.request("session/set_mode", { sessionId, modeId: "yolo" }),
      /未知执行模式/,
    );
    await assert.rejects(
      () =>
        client.request("session/set_config_option", {
          sessionId,
          configId: "mode",
          value: "yolo",
        }),
      /未知执行模式/,
    );
    await assert.rejects(
      () =>
        client.request("session/set_config_option", {
          sessionId,
          configId: "temperature",
          value: "0.2",
        }),
      /未知配置项/,
    );
  });
});
