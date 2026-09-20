import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  MessageDeltaEvent,
  ModelResponseEvent,
  RunEndEvent,
  RuntimeEvent,
  ToolEndEvent,
  ToolStartEvent,
  UsageUpdateEvent,
} from "@node-agent-runtime/core";
import { mapToolKind, toolTitle, translateEvent, usageUpdate } from "../src/update.js";

describe("update — tool kind mapping", () => {
  it("maps runtime sensitivity classes onto ACP kinds", () => {
    assert.equal(mapToolKind("read_file"), "read");
    assert.equal(mapToolKind("search_code"), "search");
    assert.equal(mapToolKind("write_file"), "edit");
    assert.equal(mapToolKind("delete_file"), "delete");
    assert.equal(mapToolKind("run_command"), "execute");
    assert.equal(mapToolKind("http_get"), "fetch");
    assert.equal(mapToolKind("do_something"), "other");
  });

  it("builds a human-readable title from path-like arguments", () => {
    assert.equal(toolTitle("read_file", { path: "/tmp/a.txt" }), "read_file /tmp/a.txt");
    assert.equal(toolTitle("now", {}), "now");
  });
});

describe("update — event translation", () => {
  it("turns assistant text into an agent message chunk", () => {
    const event: ModelResponseEvent = {
      type: "model:response",
      runId: "run_1",
      step: 2,
      message: { role: "assistant", content: "分析完成" },
    };
    const updates = translateEvent(event);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      sessionUpdate: "agent_message_chunk",
      messageId: "run_1:2",
      content: { type: "text", text: "分析完成" },
    });
  });

  it("turns a text delta into a token-level chunk of the same message (M8-4)", () => {
    const event: MessageDeltaEvent = {
      type: "message:delta",
      runId: "run_1",
      step: 2,
      delta: "分析",
      index: 0,
    };
    assert.deepEqual(translateEvent(event), [
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "run_1:2",
        content: { type: "text", text: "分析" },
      },
    ]);
  });

  it("skips assistant turns that only carry tool calls", () => {
    const event: ModelResponseEvent = {
      type: "model:response",
      runId: "run_1",
      step: 1,
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "/tmp/a" } }],
      },
    };
    assert.deepEqual(translateEvent(event), []);
  });

  it("reports tool calls as pending then completed", () => {
    const start: ToolStartEvent = {
      type: "tool:start",
      runId: "run_1",
      step: 1,
      toolCall: { id: "call_1", name: "write_file", arguments: { path: "/tmp/a.txt" } },
    };
    const [created] = translateEvent(start);
    assert.equal(created.sessionUpdate, "tool_call");
    assert.equal((created as { status?: string }).status, "pending");
    assert.equal((created as { kind?: string }).kind, "edit");

    const end: ToolEndEvent = {
      type: "tool:end",
      runId: "run_1",
      step: 1,
      toolCall: { id: "call_1", name: "write_file", arguments: { path: "/tmp/a.txt" } },
      result: "ok",
      durationMs: 3,
      ok: true,
    };
    const [updated] = translateEvent(end);
    assert.equal(updated.sessionUpdate, "tool_call_update");
    assert.deepEqual(updated, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "ok" } }],
    });
  });

  it("marks failed tool calls instead of throwing", () => {
    const end: ToolEndEvent = {
      type: "tool:end",
      runId: "run_1",
      step: 1,
      toolCall: { id: "call_2", name: "run_command", arguments: { command: "rm -rf /" } },
      result: "denied",
      durationMs: 1,
      ok: false,
    };
    const [updated] = translateEvent(end);
    assert.equal((updated as { status?: string }).status, "failed");
  });

  it("reports usage with both required token counts", () => {
    const event: UsageUpdateEvent = {
      type: "usage:update",
      runId: "run_1",
      step: 1,
      usage: { inputTokens: 800, outputTokens: 200, modelCalls: 1, costUsd: 0.0125 },
      contextUsed: 5_000,
      costUsd: 0.0125,
    };
    const [update] = translateEvent(event);
    assert.deepEqual(update, {
      sessionUpdate: "usage_update",
      used: 1_000,
      size: 5_000,
      cost: { amount: 0.0125, currency: "USD" },
    });
  });

  it("falls back to `used` when the context occupancy is unknown", () => {
    const update = usageUpdate({ inputTokens: 10, outputTokens: 5, modelCalls: 1 });
    assert.deepEqual(update, { sessionUpdate: "usage_update", used: 15, size: 15 });
  });

  it("emits a final usage update when the run ends", () => {
    const event: RunEndEvent = {
      type: "run:end",
      runId: "run_1",
      steps: 3,
      output: "done",
      usage: { inputTokens: 4, outputTokens: 6, modelCalls: 3 },
      stoppedByMaxSteps: false,
      endedAt: 1,
    };
    const [update] = translateEvent(event);
    assert.equal(update.sessionUpdate, "usage_update");
    assert.equal((update as { used: number }).used, 10);
  });

  it("ignores lifecycle events without an ACP counterpart", () => {
    const event = { type: "session:created", sessionId: "s1", agentId: "a", title: "t" } as RuntimeEvent;
    assert.deepEqual(translateEvent(event), []);
  });
});
