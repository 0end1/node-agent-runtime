import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SandboxMode } from "@node-agent-runtime/sandbox";
import type { ToolKind } from "@node-agent-runtime/types";
import {
  compilePolicy,
  createProductionPolicy,
  DefaultPermissionPolicy,
  PRESETS,
  PRODUCTION_MATRIX,
  testPolicy,
  validatePolicyDocument,
  type PermissionContext,
  type PermissionCall,
  type PermissionPolicy,
  type PolicyDocument,
  type Verdict,
} from "@node-agent-runtime/policy";

function ctx(kind: ToolKind, mode: SandboxMode): PermissionContext {
  return {
    runId: "r",
    conversationId: "c",
    tool: { name: "t", kind },
    sandboxMode: mode,
    scope: { workspace: "/", writablePaths: [], network: "deny" },
  };
}

const CALL: PermissionCall = { name: "tool", arguments: {} };

/** 以接口契约方式取 verdict（decide 可能返回 Promise，必须 await）。 */
async function verdict(p: PermissionPolicy, c: PermissionContext, call: PermissionCall): Promise<Verdict> {
  return (await p.decide(c, call)).verdict;
}

describe("validatePolicyDocument（M7-3）", () => {
  it("未知 verdict 被拒", () => {
    assert.throws(() =>
      validatePolicyDocument({ version: 1, rules: [{ id: "r", match: {}, verdict: "maybe" }] }),
    );
  });
  it("缺 id 被拒", () => {
    assert.throws(() => validatePolicyDocument({ version: 1, rules: [{ match: {}, verdict: "allow" }] }));
  });
  it("version 非 1 被拒", () => {
    assert.throws(() => validatePolicyDocument({ version: 2, rules: [] }));
  });
  it("非法 kind 被拒", () => {
    assert.throws(() =>
      validatePolicyDocument({ version: 1, rules: [{ id: "r", match: { kind: "weird" }, verdict: "allow" }] }),
    );
  });
  it("非法 mode 被拒", () => {
    assert.throws(() =>
      validatePolicyDocument({ version: 1, rules: [{ id: "r", match: { mode: "fast" }, verdict: "allow" }] }),
    );
  });
  it("合法文档通过", () => {
    const doc = validatePolicyDocument({
      version: 1,
      rules: [{ id: "r", match: { kind: "write" }, verdict: "deny" }],
    });
    assert.equal(doc.rules[0].id, "r");
  });
});

describe("compilePolicy 最严语义（M7-3）", () => {
  it("allow + deny → deny", async () => {
    const p = compilePolicy({
      version: 1,
      rules: [
        { id: "a", match: { kind: "write" }, verdict: "allow" },
        { id: "b", match: { kind: "write" }, verdict: "deny" },
      ],
    });
    assert.equal(await verdict(p, ctx("write", "read-only"), CALL), "deny");
    // 无规则命中 → 默认 allow
    assert.equal(await verdict(p, ctx("harmless", "read-only"), CALL), "allow");
  });
  it("ask + allow → ask", async () => {
    const p = compilePolicy({
      version: 1,
      rules: [
        { id: "a", match: { tool: "x" }, verdict: "allow" },
        { id: "b", match: { tool: "x" }, verdict: "ask" },
      ],
    });
    assert.equal(await verdict(p, ctx("harmless", "read-only"), { name: "x", arguments: {} }), "ask");
  });
});

describe("compilePolicy 与 DefaultPermissionPolicy 逐格等价（M7-3）", () => {
  const kinds: ToolKind[] = ["harmless", "network-read", "write", "exec", "credential"];
  const modes: SandboxMode[] = ["read-only", "workspace-write", "full-access"];
  const compiled = compilePolicy(PRESETS["prod-strict"]);
  const ref = createProductionPolicy();

  for (const k of kinds) {
    for (const m of modes) {
      it(`${k} / ${m} 与 createProductionPolicy 一致`, async () =>
        assert.equal(await verdict(compiled, ctx(k, m), CALL), await verdict(ref, ctx(k, m), CALL)));
    }
  }

  it("对照新建 DefaultPermissionPolicy（同 PRODUCTION_MATRIX）同样等价", async () => {
    const alt = new DefaultPermissionPolicy({ matrix: PRODUCTION_MATRIX });
    for (const k of kinds) {
      for (const m of modes) {
        assert.equal(await verdict(compiled, ctx(k, m), CALL), await verdict(alt, ctx(k, m), CALL));
      }
    }
  });
});

describe("testPolicy（M7-3）", () => {
  it("三套内置预设全部通过", async () => {
    for (const [name, doc] of Object.entries(PRESETS)) {
      const failures = (await testPolicy(doc)).filter((r) => !r.passed);
      assert.equal(failures.length, 0, `${name} 失败：${failures.map((f) => f.name).join(", ")}`);
    }
  });
  it("故意写错期望时输出差异条目而非静默通过", async () => {
    const res = await testPolicy(PRESETS["prod-strict"], [
      { name: "wrong", call: { name: "db.login", arguments: {} }, ctx: ctx("credential", "read-only"), expect: "allow" },
    ]);
    assert.equal(res[0].passed, false);
    assert.equal(res[0].actual, "deny");
    assert.equal(res[0].expected, "allow");
  });
});

describe("glob 匹配（M7-3）", () => {
  it("toolPattern 命中 fs.*", async () => {
    const p = compilePolicy({
      version: 1,
      rules: [{ id: "r", match: { toolPattern: "fs.*" }, verdict: "deny" }],
    });
    assert.equal(await verdict(p, ctx("write", "read-only"), { name: "fs.write", arguments: {} }), "deny");
    assert.equal(await verdict(p, ctx("write", "read-only"), { name: "db.write", arguments: {} }), "allow");
  });
  it("pathGlob 命中路径参数", async () => {
    const p = compilePolicy({
      version: 1,
      rules: [{ id: "r", match: { pathGlob: "/secret/**" }, verdict: "deny" }],
    });
    assert.equal(await verdict(p, ctx("write", "read-only"), { name: "any", arguments: { path: "/secret/key" } }), "deny");
    assert.equal(await verdict(p, ctx("write", "read-only"), { name: "any", arguments: { path: "/pub/x" } }), "allow");
  });
});

describe("prod-strict 凭证全档拒绝（M7-3）", () => {
  const p = compilePolicy(PRESETS["prod-strict"]);
  for (const mode of ["read-only", "workspace-write", "full-access"] as SandboxMode[]) {
    it(`credential / ${mode} → deny`, async () =>
      assert.equal(await verdict(p, ctx("credential", mode), { name: "db.login", arguments: {} }), "deny"));
  }
});

describe("extends 合并（M7-3）", () => {
  it("继承 prod-strict 后仍保留其规则，并叠加本档规则", async () => {
    const doc: PolicyDocument = {
      version: 1,
      extends: "prod-strict",
      rules: [{ id: "allow-ping", match: { tool: "ping" }, verdict: "allow" }],
    };
    const p = compilePolicy(doc);
    // 继承：credential 仍 deny
    assert.equal(await verdict(p, ctx("credential", "read-only"), { name: "db.login", arguments: {} }), "deny");
    // 本档：harmless/ping → allow（与基类 harmless 一致）
    assert.equal(await verdict(p, ctx("harmless", "read-only"), { name: "ping", arguments: {} }), "allow");
  });
  it("继承未知预设报错", () => {
    assert.throws(() => compilePolicy({ version: 1, extends: "nope", rules: [] }));
  });
});
