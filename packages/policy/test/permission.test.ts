import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EventBus, type RuntimeEvent } from "@node-agent-runtime/core";
import {
  DefaultPermissionPolicy,
  PermissionManager,
  StaticPolicy,
  combinePolicies,
  toolListPolicy,
  type PermissionContext,
} from "@node-agent-runtime/policy";
import type { ApprovalQuery, ApprovalRecord, ApprovalStore, ToolGrant } from "@node-agent-runtime/types";

// --------------------------------------------------------------- test double

function ctx(over: Partial<PermissionContext> = {}): PermissionContext {
  return {
    runId: "run1",
    conversationId: "conv1",
    tool: { name: "x", kind: "harmless" },
    sandboxMode: "workspace-write",
    scope: { workspace: "/ws", writablePaths: [], network: "deny" },
    ...over,
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timeout");
    await tick();
  }
}

function call(name: string, args: unknown = {}) {
  return { name, arguments: args };
}

function manager(policy = new DefaultPermissionPolicy(), askTimeoutMs = 60_000) {
  const events: RuntimeEvent[] = [];
  const bus = new EventBus<RuntimeEvent>();
  bus.subscribe((event) => events.push(event));
  const pm = new PermissionManager({ events: bus, policy, askTimeoutMs });
  return { pm, events };
}

// -------------------------------------------------------------------- tests

describe("DefaultPermissionPolicy — decision matrix (§6.0.1 × §6.1)", () => {
  const policy = new DefaultPermissionPolicy();

  it("harmless tools run in every mode", () => {
    for (const mode of ["read-only", "workspace-write", "full-access"] as const) {
      assert.deepEqual(
        policy.decide(
          ctx({ tool: { name: "calculator", kind: "harmless" }, sandboxMode: mode }),
          call("calculator"),
        ),
        { verdict: "allow" },
      );
    }
  });

  it("write/exec ask in write modes and are denied read-only", () => {
    for (const kind of ["write", "exec"] as const) {
      assert.equal(
        policy.decide(ctx({ tool: { name: kind, kind }, sandboxMode: "read-only" }), call(kind))
          .verdict,
        "deny",
      );
      assert.equal(
        policy.decide(
          ctx({ tool: { name: kind, kind }, sandboxMode: "workspace-write" }),
          call(kind),
        ).verdict,
        "ask",
      );
      assert.equal(
        policy.decide(ctx({ tool: { name: kind, kind }, sandboxMode: "full-access" }), call(kind))
          .verdict,
        "ask",
      );
    }
  });

  it("credentials are never allowed by default", () => {
    for (const mode of ["read-only", "workspace-write", "full-access"] as const) {
      assert.equal(
        policy.decide(
          ctx({ tool: { name: "get_secret", kind: "credential" }, sandboxMode: mode }),
          call("get_secret"),
        ).verdict,
        "deny",
      );
    }
  });

  it("explicit allow/deny lists override the matrix", () => {
    const p = new DefaultPermissionPolicy({ allow: ["write"], deny: ["calculator"] });
    assert.deepEqual(p.decide(ctx(), call("write", { a: 1 })), { verdict: "allow" });
    assert.equal(p.decide(ctx(), call("calculator")).verdict, "deny");
  });
});

describe("PermissionManager — gate (§6.1)", () => {
  it("allows when the policy says so, without events", async () => {
    const { pm, events } = manager();
    const out = await pm.gate(
      call("calculator"),
      ctx({ tool: { name: "calculator", kind: "harmless" } }),
    );
    assert.deepEqual(out, { ok: true, verdict: "allow" });
    assert.equal(events.length, 0);
  });

  it("denies and publishes permission:denied when the policy says so", async () => {
    const { pm, events } = manager();
    const out = await pm.gate(
      call("get_secret"),
      ctx({ tool: { name: "get_secret", kind: "credential" } }),
    );
    assert.equal(out.ok, false);
    assert.equal(out.verdict, "deny");
    assert.ok(out.reason);
    assert.ok(events.some((e) => e.type === "permission:denied"));
  });

  it("ask → host approve → gate resolves ok, with request+approved events", async () => {
    const { pm, events } = manager();
    const gating = pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    await waitFor(() => pm.pending().length === 1);

    const [pending] = pm.pending();
    assert.equal(pending.toolName, "sh");
    assert.ok(
      events.some((e) => e.type === "permission:request" && e.decisionId === pending.decisionId),
    );

    assert.equal(pm.approve(pending.decisionId), true);
    const out = await gating;
    assert.equal(out.ok, true);
    assert.equal(out.verdict, "ask-approved");
    assert.ok(
      events.some((e) => e.type === "permission:approved" && e.decisionId === pending.decisionId),
    );
  });

  it("ask → host deny → gate resolves not-ok", async () => {
    const { pm } = manager();
    const gating = pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    await waitFor(() => pm.pending().length === 1);
    assert.equal(pm.deny(pm.pending()[0]!.decisionId, "不批准"), true);
    const out = await gating;
    assert.equal(out.ok, false);
    assert.equal(out.verdict, "ask-denied");
    assert.equal(out.reason, "不批准");
  });

  it("an unanswered ask times out and counts as denied (§11 M3 验收)", async () => {
    const { pm, events } = manager(new DefaultPermissionPolicy(), 30);
    const out = await pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    assert.equal(out.ok, false);
    assert.equal(out.verdict, "timeout");
    assert.ok(out.reason?.includes("超时"));
    const denied = events.find((e) => e.type === "permission:denied");
    assert.ok(denied && denied.type === "permission:denied" && denied.timedOut);
  });

  it("approve({ always }) remembers the tool — no more ask", async () => {
    const { pm, events } = manager();
    const first = pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    await waitFor(() => pm.pending().length === 1);
    pm.approve(pm.pending()[0]!.decisionId, { always: true });
    assert.equal((await first).ok, true);

    // second call for the same tool goes straight through
    assert.deepEqual(await pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } })), {
      ok: true,
      verdict: "allow",
    });
    const requests = events.filter((e) => e.type === "permission:request");
    assert.equal(requests.length, 1);
  });

  it("a late approve after timeout is ignored", async () => {
    const { pm } = manager(new DefaultPermissionPolicy(), 20);
    const gating = pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    await waitFor(() => pm.pending().length === 1);
    const id = pm.pending()[0]!.decisionId;
    await gating; // times out
    assert.equal(pm.pending().length, 0);
    assert.equal(pm.approve(id), false);
  });
});

describe("combinePolicies — strictest verdict wins (§6.1)", () => {
  const ctxAny = ctx({ tool: { name: "sh", kind: "exec" } });
  const allowAll = new StaticPolicy({ verdict: "allow" });
  const askAll = new StaticPolicy({ verdict: "ask", reason: "?" });
  const denyAll = new StaticPolicy({ verdict: "deny", reason: "!" });

  it("allow + ask → ask; allow + ask + deny → deny", async () => {
    assert.equal(
      (await combinePolicies(allowAll, askAll).decide(ctxAny, call("sh"))).verdict,
      "ask",
    );
    assert.equal(
      (await combinePolicies(allowAll, askAll, denyAll).decide(ctxAny, call("sh"))).verdict,
      "deny",
    );
  });

  it("toolListPolicy keeps unknown tools pending", async () => {
    const p = toolListPolicy({ allow: ["calculator"], deny: ["sh"] });
    assert.equal((await p.decide(ctxAny, call("calculator"))).verdict, "allow");
    assert.equal((await p.decide(ctxAny, call("sh"))).verdict, "deny");
    assert.equal((await p.decide(ctxAny, call("weather"))).verdict, "ask");
  });
});

// ------------------------------------------------------- P3.3 audit + grants

class MemoryApprovalStore implements ApprovalStore {
  rows: ApprovalRecord[] = [];
  grantRows: ToolGrant[] = [];
  async append(r: ApprovalRecord): Promise<void> {
    this.rows.push(r);
  }
  async list(query?: ApprovalQuery): Promise<ApprovalRecord[]> {
    let out = this.rows;
    if (query) {
      for (const key of ["runId", "sessionId", "taskId", "toolName"] as const) {
        const want = query[key];
        if (want !== undefined) out = out.filter((r) => r[key] === want);
      }
    }
    return [...out].sort((a, b) => a.decidedAt - b.decidedAt);
  }
  async grants(): Promise<ToolGrant[]> {
    return [...this.grantRows];
  }
  async grantTool(g: ToolGrant): Promise<void> {
    this.grantRows = this.grantRows.filter((x) => x.toolName !== g.toolName);
    this.grantRows.push(g);
  }
  async revokeTool(toolName: string): Promise<void> {
    this.grantRows = this.grantRows.filter((x) => x.toolName !== toolName);
  }
}

describe("P3.3 — approval audit trail + persisted grants", () => {
  function auditedManager(store: ApprovalStore, askTimeoutMs = 60_000) {
    const bus = new EventBus<RuntimeEvent>();
    return new PermissionManager({ events: bus, store, askTimeoutMs });
  }

  it("policy-allow decisions are audited (approved / policy-allow, fingerprinted args)", async () => {
    const s = new MemoryApprovalStore();
    const pm = auditedManager(s);
    const out = await pm.gate(
      call("calculator", { a: 1, b: 2 }),
      ctx({ tool: { name: "calculator", kind: "harmless" } }),
    );
    assert.equal(out.verdict, "allow");
    await pm.flush();
    const rows = await s.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].verdict, "approved");
    assert.equal(rows[0].source, "policy-allow");
    assert.equal(rows[0].toolName, "calculator");
    // 审计不存原始参数，只留指纹
    assert.ok(rows[0].argumentsFingerprint);
    assert.ok(!JSON.stringify(rows[0]).includes('"a":1'));
  });

  it("policy-deny decisions are audited (denied / policy-deny)", async () => {
    const s = new MemoryApprovalStore();
    const pm = auditedManager(s);
    const out = await pm.gate(
      call("get_secret"),
      ctx({ tool: { name: "get_secret", kind: "credential" } }),
    );
    assert.equal(out.verdict, "deny");
    await pm.flush();
    const row = (await s.list())[0];
    assert.equal(row.verdict, "denied");
    assert.equal(row.source, "policy-deny");
    assert.ok(row.reason);
  });

  it("host approve({always}) persists the grant; a fresh manager rehydrates it (survives restart)", async () => {
    const s = new MemoryApprovalStore();
    const pm = auditedManager(s);
    const gating = pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    await waitFor(() => pm.pending().length === 1);
    const id = pm.pending()[0]!.decisionId;
    assert.equal(pm.approve(id, { always: true }), true);
    assert.equal((await gating).ok, true);
    await pm.flush();

    const grants = await s.grants();
    assert.equal(grants.length, 1);
    assert.equal(grants[0]!.toolName, "sh");

    const audit = await s.list();
    const hostRec = audit.find((r) => r.decisionId === id);
    assert.ok(hostRec && hostRec.verdict === "approved" && hostRec.source === "host");

    // 新实例（模拟重启）共享同一 store → 白名单恢复，grant 命中同样留痕
    const pm2 = auditedManager(s);
    assert.deepEqual(await pm2.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } })), {
      ok: true,
      verdict: "allow",
    });
    await pm2.flush();
    assert.ok((await s.list()).some((r) => r.source === "grant"));

    // revoke 清理内存 + store，重启后不再放行
    pm2.revokeTool("sh");
    await pm2.flush();
    assert.equal((await s.grants()).length, 0);
    const pm3 = auditedManager(s);
    const gating3 = pm3.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    await waitFor(() => pm3.pending().length === 1);
    assert.equal(pm3.pending()[0]!.toolName, "sh");
    // 撤销后重新回到「需宿主审批」状态（不再命中 always 白名单）；deny 释放等待避免挂起
    pm3.deny(pm3.pending()[0]!.decisionId);
    await gating3;
  });

  it("host deny and ask-timeout are audited too", async () => {
    const s = new MemoryApprovalStore();
    const pm = auditedManager(s);
    const gating = pm.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    await waitFor(() => pm.pending().length === 1);
    const id = pm.pending()[0]!.decisionId;
    assert.equal(pm.deny(id, "host 拒绝"), true);
    assert.equal((await gating).ok, false);
    await pm.flush();
    const rec = (await s.list()).find((r) => r.decisionId === id);
    assert.ok(rec && rec.verdict === "denied" && rec.source === "host" && rec.reason === "host 拒绝");

    const s2 = new MemoryApprovalStore();
    const pm2 = auditedManager(s2, 15);
    const timed = await pm2.gate(call("sh"), ctx({ tool: { name: "sh", kind: "exec" } }));
    assert.equal(timed.verdict, "timeout");
    await pm2.flush();
    const t = (await s2.list()).find((r) => r.verdict === "timeout");
    assert.ok(t && t.source === "timeout" && t.argumentsFingerprint);
  });
});
