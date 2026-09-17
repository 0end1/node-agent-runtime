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
import { JsonRpcError, METHOD_NOT_FOUND } from "../src/jsonrpc.js";
import type {
  PromptResult,
  RequestPermissionParams,
  RequestPermissionResult,
  SessionUpdateParams,
  ToolCallPatchUpdate,
} from "../src/protocol.js";
import { MemoryTransportPair } from "../src/transport.js";

const noop = (): void => {};

/**
 * A "write" tool: the runtime classifies the name as sensitivity class `write`,
 * which the default policy escalates to `ask` under `workspace-write`. It never
 * touches the disk — the tests are about who gets asked, not about IO.
 */
const writeFile = defineTool({
  name: "write_file",
  description: "Write a file (test double: never touches the disk).",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, apiKey: { type: "string" } },
    required: ["path"],
  },
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

/**
 * A client that answers `session/request_permission` with `respond`.
 *
 * `respond` may throw — that is how a client reports it does not implement the
 * method at all.
 */
async function harness(
  respond: (params: RequestPermissionParams) => RequestPermissionResult,
  toolCalls: { id: string; name: string; arguments: string }[] = [
    {
      id: "call_1",
      name: "write_file",
      arguments: JSON.stringify({ path: "/tmp/a.txt", apiKey: "sk-abcdefghij" }),
    },
  ],
): Promise<Harness> {
  const pair = new MemoryTransportPair();
  const updates: SessionUpdateParams[] = [];
  const requests: RequestPermissionParams[] = [];
  const client = new AcpConnection(pair.client, {
    notifications: {
      "session/update": (params) => updates.push(params as SessionUpdateParams),
    },
    methods: {
      "session/request_permission": (params) => {
        const request = params as RequestPermissionParams;
        requests.push(request);
        return respond(request);
      },
    },
  });
  const agent = new AcpAgent({
    provider: new ScriptedProvider([
      { content: "", toolCalls, finishReason: "tool_calls" },
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

async function newSession(client: AcpConnection): Promise<string> {
  const created = (await client.request("session/new", { cwd: "/tmp" })) as {
    sessionId: string;
  };
  return created.sessionId;
}

async function prompt(client: AcpConnection, sessionId: string): Promise<PromptResult> {
  return (await client.request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "write something" }],
  })) as PromptResult;
}

/** The final status the client saw for a tool call. */
function statusOf(updates: SessionUpdateParams[], toolCallId: string): string | undefined {
  const patches = updates
    .map((entry) => entry.update)
    .filter((update): update is ToolCallPatchUpdate => update.sessionUpdate === "tool_call_update")
    .filter((update) => update.toolCallId === toolCallId);
  return patches.at(-1)?.status;
}

const selected = (optionId: string): RequestPermissionResult => ({
  outcome: { outcome: "selected", optionId },
});

describe("session/request_permission bridge", () => {
  it("asks the client with the real toolCallId and redacted arguments", async () => {
    const { client, updates, requests } = await harness(() => selected("allow_once"));
    const sessionId = await newSession(client);

    await prompt(client, sessionId);

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.sessionId, sessionId);
    // Not the decision id: the client is already rendering this exact call.
    assert.equal(request.toolCall.toolCallId, "call_1");
    assert.equal(request.toolCall.status, "pending");
    assert.equal(request.toolCall.kind, "edit");
    // P3.2: secret-shaped values never reach the approval UI.
    assert.equal(
      (request.toolCall.rawInput as Record<string, unknown>).apiKey,
      "***REDACTED***",
    );
    assert.equal((request.toolCall.rawInput as Record<string, unknown>).path, "/tmp/a.txt");
    assert.deepEqual(
      request.options.map((option) => option.kind),
      ["allow_once", "allow_always", "reject_once", "reject_always"],
    );

    // Approved → the tool really ran.
    assert.equal(statusOf(updates, "call_1"), "completed");
  });

  it("runs the tool when the user allows once", async () => {
    const { client, updates } = await harness(() => selected("allow_once"));
    const sessionId = await newSession(client);
    await prompt(client, sessionId);
    assert.equal(statusOf(updates, "call_1"), "completed");
  });

  it("fails the tool when the user rejects", async () => {
    const { client, updates } = await harness(() => selected("reject_once"));
    const sessionId = await newSession(client);
    await prompt(client, sessionId);
    assert.equal(statusOf(updates, "call_1"), "failed");
  });

  it("fails the tool when the user cancels the dialog", async () => {
    const { client, updates } = await harness(() => ({ outcome: { outcome: "cancelled" } }));
    const sessionId = await newSession(client);
    await prompt(client, sessionId);
    assert.equal(statusOf(updates, "call_1"), "failed");
  });

  it("treats an unknown option id as a rejection", async () => {
    const { client, updates } = await harness(() => selected("yolo"));
    const sessionId = await newSession(client);
    await prompt(client, sessionId);
    assert.equal(statusOf(updates, "call_1"), "failed");
  });

  it("remembers `reject_always` and stops asking for that tool", async () => {
    const { client, updates, requests } = await harness(
      () => selected("reject_always"),
      [
        { id: "call_1", name: "write_file", arguments: JSON.stringify({ path: "/tmp/a.txt" }) },
        { id: "call_2", name: "write_file", arguments: JSON.stringify({ path: "/tmp/b.txt" }) },
      ],
    );
    const sessionId = await newSession(client);
    await prompt(client, sessionId);

    // One question, two refusals: the second call is denied from memory.
    assert.equal(requests.length, 1);
    assert.equal(statusOf(updates, "call_1"), "failed");
    assert.equal(statusOf(updates, "call_2"), "failed");
  });

  it("degrades to deny — and does not stall — when the client lacks the method", async () => {
    const { client, updates } = await harness(() => {
      throw new JsonRpcError(METHOD_NOT_FOUND, "Method not found: session/request_permission");
    });
    const sessionId = await newSession(client);

    // Without the METHOD_NOT_FOUND short-circuit this would hang for the
    // manager's 60s approval timeout instead of finishing the turn.
    const started = Date.now();
    const result = await prompt(client, sessionId);
    assert.ok(Date.now() - started < 5_000, "审批降级不应阻塞整轮");

    assert.equal(result.stopReason, "end_turn");
    assert.equal(statusOf(updates, "call_1"), "failed");
  });
});
