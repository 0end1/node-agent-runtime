import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  AgentRuntime,
  CheckpointMismatchError,
  CheckpointStore,
  MemoryStorage,
  SessionError,
  SessionManager,
  builtinTools,
  computeToolsHash,
  defineTool,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RuntimeEvent,
} from "@agent-runtime/core";

// --------------------------------------------------------------- test double

let callSeq = 0;

function toolCallResp(name: string, args: Record<string, unknown>): ModelResponse {
  callSeq += 1;
  return {
    content: `调用 ${name}`,
    toolCalls: [{ id: `call_${callSeq}`, name, arguments: JSON.stringify(args) }],
    finishReason: "tool_calls",
    usage: { inputTokens: 2, outputTokens: 2 },
  };
}

function finalResp(text: string): ModelResponse {
  return {
    content: text,
    toolCalls: [],
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

/** A provider that replays a fixed script, one response per model round-trip. */
class ScriptedProvider implements ModelProvider {
  readonly id = "script";
  readonly label = "scripted test model";
  calls = 0;

  constructor(private readonly script: Array<() => ModelResponse>) {}

  async chat(_request: ModelRequest): Promise<ModelResponse> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls += 1;
    return step();
  }
}

function makeEnv(script: Array<() => ModelResponse>, agents: readonly Agent[], storage = new MemoryStorage()) {
  const provider = new ScriptedProvider(script);
  const runtime = new AgentRuntime({ provider });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  const manager = new SessionManager({ runtime, storage, agents });
  return { storage, provider, runtime, manager, events };
}

function savedCheckpoints(events: RuntimeEvent[]): string[] {
  return events.flatMap((e) => (e.type === "checkpoint:saved" ? [e.checkpointId] : []));
}

const assistant = new Agent({ name: "assistant", tools: builtinTools });

// -------------------------------------------------------------------- tests

describe("checkpoint — tool fingerprint (§9)", () => {
  it("is stable for one tool surface and independent of tool order", () => {
    const t1 = defineTool({
      name: "t1",
      description: "one",
      parameters: { type: "object", properties: { a: { type: "string" } } },
      execute: () => "1",
    });
    const t2 = defineTool({ name: "t2", description: "two", execute: () => "2" });

    assert.equal(computeToolsHash(new Agent({ name: "x", tools: [t1, t2] })), computeToolsHash(new Agent({ name: "x", tools: [t2, t1] })));
  });

  it("changes when a tool is added or its schema changes", () => {
    const t1 = defineTool({ name: "t1", description: "one", execute: () => "1" });
    const t2 = defineTool({ name: "t2", description: "two", execute: () => "2" });
    const base = computeToolsHash(new Agent({ name: "x", tools: [t1] }));

    assert.notEqual(base, computeToolsHash(new Agent({ name: "x", tools: [t1, t2] })));
    const t1b = defineTool({
      name: "t1",
      description: "one",
      parameters: { type: "object", properties: { a: { type: "number" } } },
      execute: () => "1",
    });
    assert.notEqual(base, computeToolsHash(new Agent({ name: "x", tools: [t1b] })));
  });
});

describe("CheckpointStore", () => {
  it("saves, loads and lists checkpoints by run and task", async () => {
    const store = new CheckpointStore({ storage: new MemoryStorage() });
    const a = await store.save({
      runId: "run_1", sessionId: "s", taskId: "t", step: 1, input: "q",
      messages: [{ role: "user", content: "q" }],
      usage: { inputTokens: 1, outputTokens: 1, modelCalls: 1 },
      agentSnapshot: { agentId: "assistant", toolsHash: "abc" },
    });
    const b = await store.save({
      runId: "run_1", sessionId: "s", taskId: "t", step: 2, input: "q",
      messages: [], usage: { inputTokens: 2, outputTokens: 2, modelCalls: 2 },
      agentSnapshot: { agentId: "assistant", toolsHash: "abc" },
    });

    assert.equal((await store.load(a.id))?.step, 1);
    assert.deepEqual((await store.listByRun("run_1")).map((c) => c.step), [1, 2]);
    assert.equal((await store.latest("run_1"))?.id, b.id);
    assert.equal((await store.listByTask("t")).length, 2);
    assert.equal(await store.load("nope"), undefined);
  });
});

describe("SessionManager — step-granular checkpointing (M2)", () => {
  it("writes one checkpoint per completed step and records it on the run", async () => {
    const { manager, events, storage } = makeEnv(
      [() => toolCallResp("calculator", { expression: "2+2" }), () => finalResp("答案是 4")],
      [assistant]
    );
    const session = await manager.createSession({ agentId: "assistant", title: "ckpt" });
    const out = await manager.chat(session.id, "2+2 等于几");

    const saved = savedCheckpoints(events);
    assert.equal(saved.length, 2); // step 1 (tool round) + step 2 (final answer)
    assert.equal(out.run.checkpointId, saved.at(-1));

    const listed = await manager.listCheckpoints(out.task.id);
    assert.deepEqual(listed.map((c) => c.step), [1, 2]);
    assert.equal(listed[0]!.sessionId, session.id);
    assert.equal(listed[0]!.agentSnapshot.agentId, "assistant");
    assert.equal(listed[0]!.agentSnapshot.toolsHash, computeToolsHash(assistant));
    assert.ok(listed[0]!.messages.length >= 3);

    // the transcript is streamed to storage as steps complete
    assert.equal((await storage.listDocs("checkpoint", { sessionId: session.id })).length, 2);
  });

  it("resuming an interrupted run is equivalent to an uninterrupted one (§11 M2 验收)", async () => {
    // A — one uninterrupted run.
    const a = makeEnv(
      [() => toolCallResp("calculator", { expression: "2+2" }), () => finalResp("答案是 4")],
      [assistant]
    );
    const sessionA = await a.manager.createSession({ agentId: "assistant", title: "A" });
    const outA = await a.manager.chat(sessionA.id, "2+2 等于几");

    // B — aborted right after step 1, then resumed from its checkpoint.
    const controller = new AbortController();
    const b = makeEnv(
      [
        () => toolCallResp("calculator", { expression: "2+2" }),
        () => {
          controller.abort();
          return finalResp("这一句不会被使用");
        },
        () => finalResp("答案是 4"),
      ],
      [assistant]
    );
    const sessionB = await b.manager.createSession({ agentId: "assistant", title: "B" });
    await assert.rejects(
      () => b.manager.chat(sessionB.id, "2+2 等于几", { signal: controller.signal }),
      /run aborted/
    );

    const taskB = (await b.manager.listTasks(sessionB.id))[0]!;
    assert.equal(taskB.status, "cancelled");
    const checkpoints = await b.manager.listCheckpoints(taskB.id);
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0]!.step, 1);

    const resumed = await b.manager.resume(checkpoints[0]!.id);

    assert.equal(resumed.run.output, outA.run.output);
    assert.equal(resumed.run.parentCheckpointId, checkpoints[0]!.id);
    assert.equal(resumed.task.status, "done");
    // identical transcript: no duplicated user turn, no lost turn
    assert.deepEqual(
      (await b.manager.messages(sessionB.id)).map((m) => m.role),
      (await a.manager.messages(sessionA.id)).map((m) => m.role)
    );
    assert.deepEqual(
      (await b.manager.messages(sessionB.id)).map((m) => m.content),
      (await a.manager.messages(sessionA.id)).map((m) => m.content)
    );
    assert.ok(b.events.some((e) => e.type === "checkpoint:restored"));
  });

  it("a fresh manager over the same storage can resume (process restart)", async () => {
    const storage = new MemoryStorage();
    const controller = new AbortController();
    const first = makeEnv(
      [
        () => toolCallResp("calculator", { expression: "2+2" }),
        () => {
          controller.abort();
          return finalResp("unreachable");
        },
      ],
      [assistant],
      storage
    );
    const session = await first.manager.createSession({ agentId: "assistant", title: "restart" });
    await assert.rejects(
      () => first.manager.chat(session.id, "2+2 等于几", { signal: controller.signal }),
      /run aborted/
    );
    const task = (await first.manager.listTasks(session.id))[0]!;
    const [checkpoint] = await first.manager.listCheckpoints(task.id);

    // New process: new runtime/provider, same storage.
    const restarted = makeEnv([() => finalResp("恢复后的答案是 4")], [assistant], storage);
    const out = await restarted.manager.resume(checkpoint!.id);
    assert.equal(out.run.output, "恢复后的答案是 4");
    assert.equal(out.task.status, "done");
  });

  it("resume(ckpt, continuation) appends the new instruction as a user turn", async () => {
    const controller = new AbortController();
    const env = makeEnv(
      [
        () => toolCallResp("calculator", { expression: "2+2" }),
        () => {
          controller.abort();
          return finalResp("unreachable");
        },
        () => finalResp("继续后的答案"),
      ],
      [assistant]
    );
    const session = await env.manager.createSession({ agentId: "assistant", title: "cont" });
    await assert.rejects(
      () => env.manager.chat(session.id, "2+2 等于几", { signal: controller.signal }),
      /run aborted/
    );
    const task = (await env.manager.listTasks(session.id))[0]!;
    const [checkpoint] = await env.manager.listCheckpoints(task.id);

    const out = await env.manager.resume(checkpoint!.id, "继续");
    assert.equal(out.run.output, "继续后的答案");
    const contents = (await env.manager.messages(session.id)).map((m) => m.content);
    assert.ok(contents.includes("继续"));
    assert.equal(contents.at(-1), "继续后的答案");
  });

  it("refuses to resume when the tool surface changed", async () => {
    const env = makeEnv(
      [() => toolCallResp("calculator", { expression: "2+2" }), () => finalResp("答案是 4")],
      [assistant]
    );
    const session = await env.manager.createSession({ agentId: "assistant", title: "drift" });
    const out = await env.manager.chat(session.id, "2+2 等于几");
    const [checkpoint] = await env.manager.listCheckpoints(out.task.id);

    const drifted = new Agent({
      name: "assistant",
      tools: [defineTool({ name: "other", description: "另一个工具", execute: () => "x" })],
    });
    const other = makeEnv([() => finalResp("nope")], [drifted], env.storage);
    await assert.rejects(() => other.manager.resume(checkpoint!.id), CheckpointMismatchError);
  });

  it("rejects an unknown checkpoint id", async () => {
    const env = makeEnv([() => finalResp("hi")], [assistant]);
    await assert.rejects(() => env.manager.resume("ckpt_missing"), SessionError);
    await assert.rejects(() => env.manager.resume("ckpt_missing"), /未知 checkpoint/);
  });

  it("deleteSession also drops checkpoints and remembered facts", async () => {
    const env = makeEnv(
      [() => toolCallResp("calculator", { expression: "2+2" }), () => finalResp("答案是 4")],
      [assistant]
    );
    const session = await env.manager.createSession({ agentId: "assistant", title: "gc" });
    const out = await env.manager.chat(session.id, "2+2 等于几");
    await env.manager.memory(session.id).remember("city", "北京");

    assert.equal((await env.manager.listCheckpoints(out.task.id)).length, 2);
    await env.manager.deleteSession(session.id);

    assert.deepEqual(
      await env.storage.listDocs("checkpoint", { sessionId: session.id }),
      []
    );
    assert.equal(await env.storage.loadDoc("memory", session.id), undefined);
  });
});
