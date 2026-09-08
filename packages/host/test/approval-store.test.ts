import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryStorage } from "@agent-runtime/core";
import type { ApprovalRecord } from "@agent-runtime/types";
import { StorageApprovalStore } from "@agent-runtime/host";

function record(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    decisionId: "d1",
    runId: "r1",
    toolName: "sh",
    argumentsFingerprint: "fp-1",
    verdict: "approved",
    source: "host",
    decidedAt: 1_000,
    ...over,
  };
}

describe("StorageApprovalStore (P3.3 audit + grants)", () => {
  it("appends audit records and lists them ordered by decidedAt", async () => {
    const store = new StorageApprovalStore(new MemoryStorage());
    await store.append(record({ decisionId: "d1", decidedAt: 2_000 }));
    await store.append(
      record({ decisionId: "d2", runId: "r2", toolName: "read", decidedAt: 1_000 }),
    );

    const all = await store.list();
    assert.equal(all.length, 2);
    // 审计按时间升序，便于导出与追溯
    assert.deepEqual(
      all.map((r) => r.decidedAt),
      [1_000, 2_000],
    );
    // 记录只留参数指纹，绝不复制原文
    assert.ok(all.every((r) => typeof r.argumentsFingerprint === "string"));
  });

  it("filters by run/session/task/tool", async () => {
    const store = new StorageApprovalStore(new MemoryStorage());
    await store.append(record({ decisionId: "d1", sessionId: "s1", taskId: "t1" }));
    await store.append(record({ decisionId: "d2", runId: "r2", toolName: "read" }));

    assert.equal((await store.list({ runId: "r2" })).length, 1);
    assert.equal((await store.list({ sessionId: "s1" })).length, 1);
    assert.equal((await store.list({ taskId: "t1" })).length, 1);
    assert.equal((await store.list({ toolName: "sh" })).length, 1);
    assert.equal((await store.list({ toolName: "nope" })).length, 0);
    assert.equal((await store.list()).length, 2);
  });

  it("persists always-allow grants, overwrites and revokes idempotently", async () => {
    const store = new StorageApprovalStore(new MemoryStorage());
    await store.grantTool({ toolName: "sh", grantedAt: 1 });
    // 工具名含特殊字符：doc id 必须编码
    await store.grantTool({ toolName: "read file", grantedAt: 2 });
    assert.equal((await store.grants()).length, 2);

    // 重复授权同一工具是覆盖，不是新增
    await store.grantTool({ toolName: "sh", grantedAt: 3 });
    const grants = await store.grants();
    assert.equal(grants.length, 2);
    assert.equal(grants.find((g) => g.toolName === "sh")?.grantedAt, 3);

    await store.revokeTool("sh");
    assert.deepEqual(
      (await store.grants()).map((g) => g.toolName),
      ["read file"],
    );
    // 撤销不存在的工具是幂等的
    await store.revokeTool("never-granted");
    assert.equal((await store.grants()).length, 1);
  });
});
