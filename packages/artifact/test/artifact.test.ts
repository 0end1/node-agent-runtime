import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  AgentRuntime,
  MemoryStorage,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from "@agent-runtime/core";
import { SessionManager } from "@agent-runtime/host";
import { ArtifactError, ArtifactManager } from "@agent-runtime/artifact";

class NeverProvider implements ModelProvider {
  readonly id = "never";
  readonly label = "not called";
  async chat(_request: ModelRequest): Promise<ModelResponse> {
    return {
      content: "",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

describe("ArtifactManager over MemoryStorage (§8.1)", () => {
  it("saves text artifacts and reads them back by session", async () => {
    const store = new MemoryStorage();
    const am = new ArtifactManager({ storage: store, now: () => 1000 });
    const saved = await am.save({
      sessionId: "s1",
      runId: "r1",
      kind: "text",
      name: "摘要.md",
      content: "hello artifact",
    });
    assert.match(saved.id, /^artifact_/);
    assert.equal(saved.mime, "text/plain");
    assert.equal(saved.locator, "blob:artifact:" + saved.id);
    assert.equal(saved.createdAt, 1000);

    const fetched = await am.get(saved.id);
    assert.equal(fetched?.name, "摘要.md");
    assert.equal(await am.readText(saved.id), "hello artifact");

    const listed = await am.list("s1");
    assert.equal(listed.length, 1);
    assert.equal((await am.list("other")).length, 0);
  });

  it("round-trips binary payloads (file/chart kinds)", async () => {
    const store = new MemoryStorage();
    const am = new ArtifactManager({ storage: store });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const saved = await am.save({
      sessionId: "s2",
      kind: "file",
      name: "logo.png",
      content: bytes,
    });
    assert.equal(saved.mime, "application/octet-stream");
    const read = await am.readBytes(saved.id);
    assert.deepEqual(Array.from(read ?? []), [0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  });

  it("url artifacts carry the URL in the locator and have no payload", async () => {
    const store = new MemoryStorage();
    const am = new ArtifactManager({ storage: store });
    const saved = await am.save({
      sessionId: "s3",
      kind: "url",
      name: "官网",
      url: "https://example.com/",
    });
    assert.equal(saved.locator, "https://example.com/");
    assert.equal(saved.mime, "text/html");
    assert.equal(await am.readBytes(saved.id), undefined);
    assert.equal(await am.readText(saved.id), undefined);
  });

  it("honours explicit mime overrides and custom ids (upsert replaces)", async () => {
    const store = new MemoryStorage();
    const am = new ArtifactManager({ storage: store, now: () => 2000 });
    const a = await am.save({
      id: "fixed-id",
      sessionId: "s4",
      kind: "chart",
      name: "flow",
      content: "<svg/>",
      mime: "image/svg+xml; charset=utf-8",
    });
    assert.equal(a.id, "fixed-id");
    assert.equal(a.mime, "image/svg+xml; charset=utf-8");
    assert.equal(await am.readText("fixed-id"), "<svg/>");

    // upsert with the same id replaces payload + bumps timestamp
    const b = await am.save({
      id: "fixed-id",
      sessionId: "s4",
      kind: "text",
      name: "flow-v2",
      content: "second",
    });
    assert.equal(b.id, "fixed-id");
    assert.equal(await am.readText("fixed-id"), "second");
    assert.equal((await am.list("s4")).length, 1);
  });

  it("lists newest-first and can filter by run", async () => {
    const store = new MemoryStorage();
    let clock = 0;
    const am = new ArtifactManager({ storage: store, now: () => ++clock * 100 });
    await am.save({ sessionId: "s5", runId: "r1", kind: "text", name: "一", content: "1" });
    await am.save({ sessionId: "s5", runId: "r1", kind: "text", name: "二", content: "2" });
    await am.save({ sessionId: "s5", runId: "r2", kind: "text", name: "三", content: "3" });
    const all = await am.list("s5");
    assert.deepEqual(all.map((a) => a.name), ["三", "二", "一"]);
    const r1 = await am.list("s5", "r1");
    assert.deepEqual(r1.map((a) => a.name), ["二", "一"]);
  });

  it("remove deletes payload + metadata and is idempotent", async () => {
    const store = new MemoryStorage();
    const am = new ArtifactManager({ storage: store });
    await am.save({ sessionId: "s6", kind: "text", name: "tmp", content: "x" });
    const id = (await am.list("s6"))[0]!.id;
    await am.remove(id);
    assert.equal(await am.get(id), undefined);
    assert.equal(await am.readText(id), undefined);
    await am.remove(id); // no throw
  });

  it("validates required inputs", async () => {
    const am = new ArtifactManager({ storage: new MemoryStorage() });
    await assert.rejects(
      () => am.save({ sessionId: "", kind: "text", name: "n", content: "c" }),
      ArtifactError
    );
    await assert.rejects(
      () => am.save({ sessionId: "s", kind: "text", name: " ", content: "c" }),
      ArtifactError
    );
    await assert.rejects(
      () => am.save({ sessionId: "s", kind: "url", name: "u" }),
      ArtifactError
    );
  });
});

describe("SessionManager owns an ArtifactManager (§8.1, M4 integration)", () => {
  it("deleteSession frees the session's artifacts and their payloads", async () => {
    const runtime = new AgentRuntime({ provider: new NeverProvider() });
    const storage = new MemoryStorage();
    const agent = new Agent({ name: "shell" });
    const manager = new SessionManager({ runtime, storage, agents: [agent] });
    const session = await manager.createSession({ agentId: "shell" });

    const chart = await manager.artifacts.save({
      sessionId: session.id,
      runId: "r9",
      kind: "chart",
      name: "mermaid",
      content: "graph TD; A-->B",
    });
    const url = await manager.artifacts.save({
      sessionId: session.id,
      kind: "url",
      name: "ref",
      url: "https://example.com/x",
    });
    assert.equal((await manager.artifacts.list(session.id)).length, 2);

    await manager.deleteSession(session.id);

    assert.deepEqual(await manager.artifacts.list(session.id), []);
    assert.equal(await manager.artifacts.get(chart.id), undefined);
    assert.equal(await manager.artifacts.readText(chart.id), undefined);
    assert.equal(await manager.artifacts.get(url.id), undefined);
  });
});
