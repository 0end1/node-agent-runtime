import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApprovalRecord, ApprovalStore } from "@node-agent-runtime/types";
import { serializeAudit, exportAudit } from "@node-agent-runtime/host";

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

const COLUMNS = [
  "decisionId",
  "runId",
  "sessionId",
  "taskId",
  "toolName",
  "argumentsFingerprint",
  "verdict",
  "source",
  "reason",
  "decidedAt",
];

describe("M7-2 serializeAudit", () => {
  it("csv 表头固定且含 argumentsFingerprint，行数 = 决策数", () => {
    const records = [
      record({ decisionId: "d1", verdict: "approved", source: "host" }),
      record({ decisionId: "d2", toolName: "read", verdict: "denied", source: "policy-deny" }),
      record({ decisionId: "d3", verdict: "timeout", source: "timeout" }),
    ];
    const csv = serializeAudit(records, { format: "csv" });
    const lines = csv.trimEnd().split("\n");
    assert.equal(lines[0], COLUMNS.join(","));
    assert.equal(lines.length, records.length + 1); // 表头 + 3 行
    // 不含工具参数原文：record 仅有指纹，无任何明文参数
    assert.ok(csv.includes("fp-1"));
  });

  it("注入 sk-xxxx 形态明文被 redact 屏蔽（不出现在导出物）", () => {
    const csv = serializeAudit(
      [record({ reason: "sk-abc123SECRETKEY" } as Partial<ApprovalRecord>)],
      { format: "csv" },
    );
    assert.ok(!csv.includes("abc123SECRETKEY"));
    assert.ok(csv.includes("***REDACTED***"));
  });

  it("reason 含逗号/引号/换行时 RFC 4180 转义正确", () => {
    const csv = serializeAudit([record({ reason: 'he said "yes", then left\nfor real' })], {
      format: "csv",
    });
    // 整字段被引号包裹、内层引号翻倍、换行保留在引号内（不按 \n 断开）
    assert.ok(csv.includes('"he said ""yes"", then left' + "\n" + 'for real"'));
  });

  it("decidedAt 渲染为 ISO-8601 UTC", () => {
    const csv = serializeAudit([record({ decidedAt: 0 })], { format: "csv" });
    const line = csv.trimEnd().split("\n")[1];
    const cells = line.split(",");
    assert.equal(cells[cells.length - 1], new Date(0).toISOString());
  });

  it("json 为稳定键序数组，且同样经过 redact", () => {
    const records = [
      record({ decisionId: "d1", verdict: "approved", source: "host" }),
      record({ decisionId: "d2", toolName: "read", verdict: "denied" }),
    ];
    const json = serializeAudit(records, { format: "json" });
    const parsed = JSON.parse(json) as Record<string, unknown>[];
    assert.equal(parsed.length, 2);
    assert.deepEqual(Object.keys(parsed[0]), [...COLUMNS]);
    assert.ok(
      !serializeAudit([record({ reason: "sk-xyzSECRET789" } as Partial<ApprovalRecord>)], {
        format: "json",
      }).includes("xyzSECRET789"),
    );
  });

  it("导出行数与实际决策数一致（approve/deny/timeout 全覆盖）", () => {
    const records = [
      record({ verdict: "approved", source: "host" }),
      record({ verdict: "denied", source: "policy-deny" }),
      record({ verdict: "timeout", source: "timeout" }),
    ];
    const csv = serializeAudit(records).trimEnd().split("\n");
    assert.equal(csv.length - 1, 3);
  });
});

describe("M7-2 exportAudit", () => {
  it("从 store 拉取并按 query 过滤后序列化", async () => {
    const store = {
      list: async (q?: { toolName?: string }) =>
        [
          record({ decisionId: "d1", toolName: "sh", runId: "r1" }),
          record({ decisionId: "d2", toolName: "read", runId: "r2" }),
        ].filter((r) => (q?.toolName ? r.toolName === q.toolName : true)),
    } as unknown as ApprovalStore;

    const all = await exportAudit(store);
    assert.equal(all.trimEnd().split("\n").length - 1, 2);

    const filtered = await exportAudit(store, { toolName: "read" });
    assert.equal(filtered.trimEnd().split("\n").length - 1, 1);
    assert.ok(filtered.includes("read"));
  });
});
