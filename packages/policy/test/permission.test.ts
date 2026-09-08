import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EventBus, type RuntimeEvent } from "@agent-runtime/core";
import {
  DefaultPermissionPolicy,
  PermissionManager,
  StaticPolicy,
  combinePolicies,
  toolListPolicy,
  type PermissionContext,
} from "@agent-runtime/policy";

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
