import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  AgentRuntime,
  MemoryStorage,
  MockProvider,
  SessionManager,
  builtinTools,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type Session,
} from "@agent-runtime/core";

function makeManager(storage = new MemoryStorage()) {
  const runtime = new AgentRuntime({
    provider: new MockProvider({ now: () => new Date("2026-09-04T10:30:00+08:00") }),
  });
  const agent = new Agent({ name: "assistant", tools: builtinTools });
  const manager = new SessionManager({ runtime, storage, agents: [agent] });
  return { runtime, manager, agent, storage };
}

async function newSession(manager: SessionManager, title = "demo"): Promise<Session> {
  return manager.createSession({ agentId: "assistant", title });
}

describe("SessionManager — session lifecycle", () => {
  it("creates, lists and closes sessions", async () => {
    const { manager } = makeManager();
    const s1 = await newSession(manager, "first");
    const s2 = await newSession(manager, "second");
    assert.ok(s1.id.startsWith("session_"));
    assert.equal(s1.status, "idle");
    assert.equal(s1.agentId, "assistant");

    const all = await manager.listSessions();
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((s) => s.title), ["first", "second"]); // createdAt order

    const closed = await manager.closeSession(s1.id);
    assert.equal(closed.status, "closed");
    assert.equal((await manager.getSession(s1.id))!.status, "closed");
    await assert.rejects(() => manager.chat(s1.id, "hi"), /已关闭/);
    // closing is idempotent and does not touch other sessions
    await manager.closeSession(s1.id);
    assert.equal((await manager.getSession(s2.id))!.status, "idle");
  });

  it("rejects unknown agent recipes at create time", async () => {
    const { manager } = makeManager();
    await assert.rejects(
      () => manager.createSession({ agentId: "ghost", title: "x" }),
      /未知 Agent/
    );
  });

  it("deleteSession removes the session, its tasks, runs and message stream", async () => {
    const { manager, storage } = makeManager();
    const keep = await newSession(manager, "keep-me");
    const doomed = await newSession(manager, "delete-me");

    await manager.chat(keep.id, "2 + 2 = ?");
    await manager.chat(doomed.id, "3 + 3 = ?");
    assert.ok((await manager.messages(doomed.id)).length > 0);
    assert.equal((await manager.listTasks(doomed.id)).length, 1);
    assert.equal(
      (await storage.listDocs("run", { sessionId: doomed.id })).length,
      1
    );

    await manager.deleteSession(doomed.id);
    assert.equal(await manager.getSession(doomed.id), undefined);
    assert.equal((await manager.listTasks(doomed.id)).length, 0);
    assert.equal((await storage.listDocs("run", { sessionId: doomed.id })).length, 0);
    assert.deepEqual(await manager.messages(doomed.id), []);
    // sibling session survives intact
    const kept = await manager.getSession(keep.id);
    assert.equal(kept?.status, "idle");
    assert.ok((await manager.messages(keep.id)).length > 0);
  });
});

describe("SessionManager — task & run", () => {
  it("chat executes a multi-step run, marks task done and persists transcript", async () => {
    const { manager } = makeManager();
    const s = await newSession(manager);
    const out = await manager.chat(s.id, "2 + 3 * 4 = ?");

    assert.equal(out.task.status, "done");
    assert.equal(out.run.status, "succeeded");
    assert.ok(out.run.output.includes("= 14"), `got: ${out.run.output}`);
    assert.ok(out.run.usage.modelCalls >= 2);
    assert.equal(out.task.runIds.length, 1);

    // persisted message stream contains exactly this one user turn + assistant tail
    const messages = await manager.messages(s.id);
    assert.equal(messages.filter((m) => m.role === "user").length, 1);
    assert.equal(messages.at(-1)?.role, "assistant");

    const tasks = await manager.listTasks(s.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.status, "done");
  });

  it("keeps conversation context after a simulated process restart", async () => {
    const storage = new MemoryStorage();
    const first = makeManager(storage);
    const s = await newSession(first.manager);
    await first.manager.chat(s.id, "2 + 2 = ?");

    // "restart": a brand-new manager over the same store
    const second = makeManager(storage);
    const reloaded = await second.manager.getSession(s.id);
    assert.ok(reloaded, "session survives restart");

    const out2 = await second.manager.chat(reloaded!.id, "那 4 + 5 呢？");
    assert.ok(out2.run.output.includes("= 9"), `got: ${out2.run.output}`);

    // both user turns are now persisted in one transcript
    const messages = await second.manager.messages(reloaded!.id);
    assert.equal(messages.filter((m) => m.role === "user").length, 2);
  });

  it("auto-titles the session from the first user message", async () => {
    const { manager } = makeManager();
    const s = await manager.createSession({ agentId: "assistant" });
    assert.equal(s.title, "");
    await manager.chat(s.id, "今天天气如何？请查一下");
    const updated = (await manager.getSession(s.id))!;
    assert.ok(updated.title.includes("今天天气如何"), `got title: "${updated.title}"`);
  });

  it("emits session & task lifecycle events in order", async () => {
    const { manager, runtime } = makeManager();
    const types: string[] = [];
    const off = runtime.subscribe((e) => types.push(e.type));
    const s = await newSession(manager, "events");
    await manager.chat(s.id, "现在几点了？");
    off();

    assert.ok(types.includes("session:created"));
    assert.ok(types.includes("task:created"));
    const statuses = types.filter((t) => t === "task:status");
    assert.ok(statuses.length >= 2); // running -> done
    assert.ok(types.includes("session:updated"));
    // run-level events are on the same bus
    assert.ok(types.includes("run:start"));
    assert.ok(types.includes("run:end"));
  });

  it("guards against two concurrent chats on the same session", async () => {
    let release: ((res: ModelResponse) => void) | null = null;
    const gatedProvider: ModelProvider = {
      id: "gate",
      label: "gated",
      chat(_req: ModelRequest): Promise<ModelResponse> {
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };
    const runtime = new AgentRuntime({ provider: gatedProvider });
    const manager = new SessionManager({
      runtime,
      storage: new MemoryStorage(),
      agents: [new Agent({ name: "assistant", tools: builtinTools })],
    });
    const s = await manager.createSession({ agentId: "assistant", title: "gate" });

    const first = manager.chat(s.id, "hi"); // blocks on the gated provider
    await new Promise((r) => setTimeout(r, 20)); // let the busy lock engage
    await assert.rejects(() => manager.chat(s.id, "hi again"), /正在运行/);

    release!({
      content: "ok",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const out = await first;
    assert.equal(out.task.status, "done");
    assert.equal((await manager.getSession(s.id))!.status, "idle");
  });
});
