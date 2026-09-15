import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryStorage, type ChatMessage } from "@node-agent-runtime/core";
import { SessionMemory } from "@node-agent-runtime/memory";

function user(text: string): ChatMessage {
  return { role: "user", content: text };
}

function makeMemory(sessionId = "session_1", storage = new MemoryStorage()) {
  return { storage, memory: new SessionMemory({ storage, sessionId }) };
}

describe("SessionMemory — transcript layer (§8.2)", () => {
  it("appends and reads the transcript back in order", async () => {
    const { memory } = makeMemory();
    await memory.append(user("第一句"));
    await memory.append({ role: "assistant", content: "收到" });

    const all = await memory.messages();
    assert.deepEqual(
      all.map((m) => m.content),
      ["第一句", "收到"],
    );
  });

  it("messages(limit) returns the newest N turns", async () => {
    const { memory } = makeMemory();
    for (const text of ["a", "b", "c", "d"]) await memory.append(user(text));

    assert.deepEqual(
      (await memory.messages(2)).map((m) => m.content),
      ["c", "d"],
    );
    assert.equal((await memory.messages()).length, 4);
  });

  it("survives a new instance over the same storage (restart transparency)", async () => {
    const { storage, memory } = makeMemory();
    await memory.append(user("跨实例仍可读"));

    const reloaded = new SessionMemory({ storage, sessionId: "session_1" });
    assert.deepEqual(
      (await reloaded.messages()).map((m) => m.content),
      ["跨实例仍可读"],
    );
  });

  it("skips corrupt lines instead of losing the whole session", async () => {
    const { storage, memory } = makeMemory();
    await memory.append(user("好的一行"));
    await storage.appendStream("message", "session_1", "{ 这不是 JSON");
    await memory.append(user("后面还有"));

    assert.deepEqual(
      (await memory.messages()).map((m) => m.content),
      ["好的一行", "后面还有"],
    );
  });

  it("keeps sessions isolated", async () => {
    const storage = new MemoryStorage();
    await new SessionMemory({ storage, sessionId: "s_a" }).append(user("A"));
    await new SessionMemory({ storage, sessionId: "s_b" }).append(user("B"));

    assert.deepEqual(
      (await new SessionMemory({ storage, sessionId: "s_a" }).messages()).map((m) => m.content),
      ["A"],
    );
  });
});

describe("SessionMemory — long-term fact layer (§8.2)", () => {
  it("remembers facts and recalls them by lexical match", async () => {
    const { memory } = makeMemory();
    await memory.remember("user.name", "王志勇");
    await memory.remember("project.stack", "TypeScript + Node 运行时");

    const hits = await memory.recall("运行时用的什么技术栈");
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]!.key, "project.stack");
    assert.equal(hits[0]!.value, "TypeScript + Node 运行时");
    assert.ok(hits[0]!.score > 0);
  });

  it("rejects an empty key and returns nothing for an empty query", async () => {
    const { memory } = makeMemory();
    await assert.rejects(() => memory.remember("  ", "x"), /key 不能为空/);
    await memory.remember("k", "v");
    assert.deepEqual(await memory.recall("   "), []);
  });

  it("facts are scoped to the session and overwrite by key", async () => {
    const storage = new MemoryStorage();
    const a = new SessionMemory({ storage, sessionId: "s_a" });
    const b = new SessionMemory({ storage, sessionId: "s_b" });

    await a.remember("city", "北京");
    await b.remember("city", "上海");
    assert.equal((await a.recall("city"))[0]!.value, "北京");
    assert.equal((await b.recall("city"))[0]!.value, "上海");

    await a.remember("city", "深圳");
    assert.equal((await a.recall("city"))[0]!.value, "深圳");
    assert.equal((await a.facts()).length, 1);
  });

  it("recall returns [] when nothing matches", async () => {
    const { memory } = makeMemory();
    await memory.remember("city", "北京");
    assert.deepEqual(await memory.recall("完全不相关的查询词"), []);
  });
});
