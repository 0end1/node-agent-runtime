import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileStorage, MemoryStorage, type Storage } from "@node-agent-runtime/core";

interface Doc {
  id: string;
  name: string;
  kind: string;
}

const sample: Doc = { id: "a1", name: "alpha", kind: "doc" };

/**
 * Exercise the full Storage contract against an implementation.
 *
 * `make()` must hand back an EMPTY store on each call, except inside the
 * "restart" test where the second instance must point at the SAME backing
 * data as the first (possible only for disk-backed stores).
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
      },
    );
  });
}

exerciseStore("MemoryStorage", async () => new MemoryStorage(), false);

// Each FileStorage test starts from a fresh temp dir; a `make()` call inside
// one test always targets that test's own dir.
describe("FileStorage", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "node-agent-runtime-store-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  exerciseStore("disk", async () => new FileStorage(root), true);
});
