import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";

import type { ApprovalRecord } from "@node-agent-runtime/types";
import { SCHEMA_VERSION, SQLiteStorage } from "@node-agent-runtime/store-sqlite";

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "node-agent-runtime-sqlite-"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function record(i: number, over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    decisionId: `d${i}`,
    runId: `r${i % 50}`,
    toolName: "sh",
    argumentsFingerprint: "fp",
    verdict: "approved",
    source: "host",
    decidedAt: 1_000 + i,
    ...over,
  };
}

/** Reach into the private handle only to assert DDL-level facts (indexes). */
function indexNames(store: SQLiteStorage): string[] {
  const db = (store as unknown as { db: DatabaseSync }).db;
  const rows = db.prepare("PRAGMA index_list('docs')").all() as { name: string }[];
  return rows.map((r) => r.name);
}

describe("SQLiteStorage 生产基线 (P5.5)", () => {
  it("迁移可重复并落定 user_version", () => {
    const first = new SQLiteStorage({ file: join(dir, "migrate.db") });
    assert.equal(first.schemaVersion, SCHEMA_VERSION);
    first.close();

    // 重开同一文件：迁移必须幂等，不能重复建表/报错
    const second = new SQLiteStorage({ file: join(dir, "migrate.db") });
    assert.equal(second.schemaVersion, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION >= 2, true);
    second.close();
  });

  it("建立 v2 表达式索引（session/task/run/审计排序）", () => {
    const store = new SQLiteStorage({ file: join(dir, "index.db") });
    const names = indexNames(store);
    for (const expected of [
      "idx_docs_session_id",
      "idx_docs_task_id",
      "idx_docs_run_id",
      "idx_docs_decided_at",
    ]) {
      assert.ok(names.includes(expected), `缺少索引 ${expected}`);
    }
    store.close();
  });

  it("listDocs 把索引字段下推到 SQL，结果与内存过滤一致", async () => {
    const store = new SQLiteStorage({ file: join(dir, "filter.db") });
    await store.saveDoc("approval", "a1", record(1, { sessionId: "s1", taskId: "t1" }));
    await store.saveDoc("approval", "a2", record(2, { sessionId: "s1", taskId: "t2" }));
    await store.saveDoc("approval", "a3", record(3, { sessionId: "s2", taskId: "t1" }));

    assert.equal((await store.listDocs<ApprovalRecord>("approval", { sessionId: "s1" })).length, 2);
    // 两个索引字段组合
    assert.equal(
      (await store.listDocs<ApprovalRecord>("approval", { sessionId: "s1", taskId: "t2" })).length,
      1,
    );
    // 索引字段 + 非索引字段（后者走内存过滤）
    assert.equal(
      (await store.listDocs<ApprovalRecord>("approval", { runId: "r1", toolName: "nope" })).length,
      0,
    );
    // 仅非索引字段：退化为全量扫描，结果仍正确
    assert.equal((await store.listDocs<ApprovalRecord>("approval", { toolName: "sh" })).length, 3);
    assert.equal((await store.listDocs<ApprovalRecord>("approval")).length, 3);
    // 其它 domain 不受影响
    assert.equal((await store.listDocs<ApprovalRecord>("session")).length, 0);
    store.close();
  });

  it("大会话量下按 run 查询仍走索引（耗时达标）", async () => {
    const store = new SQLiteStorage({ file: join(dir, "volume.db") });
    for (let i = 0; i < 1_000; i++) {
      await store.saveDoc("approval", `v${i}`, record(i));
    }

    const started = Date.now();
    for (let r = 0; r < 20; r++) {
      const rows = await store.listDocs<ApprovalRecord>("approval", { runId: `r${r}` });
      assert.equal(rows.length, 20, `run${r} 应命中 20 条`);
    }
    const elapsed = Date.now() - started;

    // 1k 条记录下 20 次主键式查询：走索引应远低于该阈值（CI 抖动留足余量）
    assert.ok(elapsed < 500, `按 run 查询 20 次耗时 ${elapsed}ms，疑似未走索引`);
    store.close();
  });

  it("backup() 产出可恢复快照且拒绝覆盖", async () => {
    const src = new SQLiteStorage({ file: join(dir, "src.db") });
    await src.saveDoc("session", "s1", { id: "s1", title: "会话" });

    const snapshot = join(dir, "snapshot.db");
    src.backup(snapshot);
    assert.ok(existsSync(snapshot));
    assert.throws(() => src.backup(snapshot), /拒绝覆盖/);
    src.close();

    const restored = new SQLiteStorage({ file: snapshot });
    const doc = await restored.loadDoc<{ id: string; title: string }>("session", "s1");
    assert.equal(doc?.title, "会话");
    assert.equal(restored.schemaVersion, SCHEMA_VERSION);
    restored.close();
  });
});
