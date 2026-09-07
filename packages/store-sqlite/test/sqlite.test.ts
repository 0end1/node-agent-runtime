import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Storage } from "@agent-runtime/core";
import { SQLiteStorage } from "@agent-runtime/store-sqlite";

interface Doc {
  id: string;
  name: string;
  kind: string;
}

const sample: Doc = { id: "a1", name: "alpha", kind: "doc" };

/**
 * Exercise the full Storage contract against SQLiteStorage.
 * `make()` hands back an EMPTY store on each call (fresh db file / :memory:).
 */
function exerciseStore(name: string, make: () => Promise<Storage>, restart: boolean) {
  describe(`Storage contract — ${name}`, () => {
    it("save/load round-trips a document (deep copy: later mutation is invisible)", async () => {
      const store = await make();
      const doc = { ...sample, nested: { n: 1 } };
      await store.saveDoc("session", doc.id, doc);
      doc.name = "mutated-after-save";
      doc.nested.n = 999;
      const loaded = await store.loadDoc<typeof doc>("session", "a1");
      assert.equal(loaded?.name, "alpha");
      assert.equal(loaded?.nested.n, 1);
    });

    it("listDocs filters by partial match", async () => {
      const store = await make();
      await store.saveDoc("task", "t1", { id: "t1", sessionId: "s1", kind: "a" });
      await store.saveDoc("task", "t2", { id: "t2", sessionId: "s2", kind: "a" });
      await store.saveDoc("task", "t3", { id: "t3", sessionId: "s1", kind: "b" });
      const s1tasks = await store.listDocs<{ sessionId: string }>("task", { sessionId: "s1" });
      assert.equal(s1tasks.length, 2);
    });

    it("loadDoc returns undefined and listDocs [] for unknown keys", async () => {
      const store = await make();
      assert.equal(await store.loadDoc("session", "nope"), undefined);
      assert.deepEqual(await store.listDocs("session"), []);
    });

    it("deleteDoc removes the document", async () => {
      const store = await make();
      await store.saveDoc("session", "x", sample);
      await store.deleteDoc("session", "x");
      assert.equal(await store.loadDoc("session", "x"), undefined);
    });

    it("blob put/get/delete round-trips binary data", async () => {
      const store = await make();
      const bytes = new TextEncoder().encode("hello-artifact");
      await store.putBlob("art/1.png", bytes);
      const back = await store.getBlob("art/1.png");
      assert.ok(back);
      assert.equal(new TextDecoder().decode(back), "hello-artifact");
      await store.deleteBlob("art/1.png");
      assert.equal(await store.getBlob("art/1.png"), undefined);
    });

    it("message stream appends and reads lines in order", async () => {
      const store = await make();
      await store.appendStream("message", "s1", '{"role":"user","content":"hi"}');
      await store.appendStream("message", "s1", '{"role":"assistant","content":"yo"}');
      await store.appendStream("message", "s2", '{"role":"user","content":"other"}');
      const lines = await store.readStream("message", "s1");
      assert.equal(lines.length, 2);
      assert.ok(lines[0]!.includes("hi"));
      assert.ok(lines[1]!.includes("yo"));
      // deleting s1 leaves s2 intact
      await store.deleteStream("message", "s1");
      assert.deepEqual(await store.readStream("message", "s1"), []);
      assert.equal((await store.readStream("message", "s2")).length, 1);
    });

    it(
      "docs written by one store instance survive in a fresh instance (restart)",
      { skip: restart ? false : "in-memory stores cannot restart" },
      async () => {
        const store = await make();
        await store.saveDoc("session", "keep", sample);
        const reopened = await make(); // second instance, SAME backing store
        const doc = await reopened.loadDoc<Doc>("session", "keep");
        assert.equal(doc?.name, "alpha");
      }
    );
  });
}

// :memory: — every make() opens a brand-new empty database.
exerciseStore("sqlite :memory:", async () => new SQLiteStorage(), false);

// Real file — exerciseStore's fresh-dir contract, plus a true cross-instance
// restart test against a single stable path.
describe("SQLiteStorage (file)", () => {
  let dir: string;
  let dbFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-runtime-sqlite-"));
    dbFile = join(dir, "store.db");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  exerciseStore("sqlite file", async () => new SQLiteStorage({ file: join(dir, `db-${Math.random()}.db`) }), false);

  it("data survives reopening the same database file", async () => {
    const a = new SQLiteStorage({ file: dbFile });
    await a.saveDoc("session", "keep", sample);
    await a.appendStream("message", "s1", "line-one");
    await a.putBlob("b/1", new TextEncoder().encode("payload"));
    a.close();

    const b = new SQLiteStorage({ file: dbFile });
    const doc = await b.loadDoc<Doc>("session", "keep");
    assert.equal(doc?.name, "alpha");
    const lines = await b.readStream("message", "s1");
    assert.deepEqual(lines, ["line-one"]);
    const blob = await b.getBlob("b/1");
    assert.ok(blob);
    assert.equal(new TextDecoder().decode(blob), "payload");
    b.close();
  });

  it("saveDoc upserts the same key", async () => {
    const store = new SQLiteStorage({ file: dbFile });
    await store.saveDoc("session", "x", { id: "x", name: "first" });
    await store.saveDoc("session", "x", { id: "x", name: "second" });
    const doc = await store.loadDoc<{ name: string }>("session", "x");
    assert.equal(doc?.name, "second");
    const all = await store.listDocs("session");
    assert.equal(all.length, 1);
    store.close();
  });
});
