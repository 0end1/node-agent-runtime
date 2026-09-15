import type { SandboxMode, SandboxScope } from "@node-agent-runtime/sandbox";
import { validate, type JsonSchema } from "@node-agent-runtime/types";
import type { ToolKind } from "@node-agent-runtime/types";
import type {
  Decision,
  PermissionCall,
  PermissionContext,
  PermissionPolicy,
  Verdict,
} from "./permission.js";
import { PRODUCTION_MATRIX } from "./secure.js";
import type { DecisionMatrix } from "./permission.js";

/**
 * M7-3 声明式策略契约（纯契约，零第三方依赖）。
 *
 * 注：契约类型本应下沉 `types`（C1），但 `PermissionContext` / `PolicyRule.match.mode`
 * 依赖 `SandboxMode`（在 `sandbox` 包），而 `sandbox` 已依赖 `types`——若 `types` 反向
 * 引入 `sandbox` 会破坏 `types ← sandbox` 的依赖 DAG。故声明式契约随 `policy` 包落地，
 * 与既有 `PermissionPolicy` / `combinePolicies` 同一处，仍由 `policy:test` 门禁覆盖。
 */

export interface PolicyMatch {
  /** 精确工具名。 */
  tool?: string;
  /** 工具名 glob（`*` 任意字符、`?` 单字符，自实现，零依赖）。 */
  toolPattern?: string;
  /** 工具敏感度类别（见 `ToolKind`）。 */
  kind?: ToolKind;
  /** 运行沙箱模式（见 `SandboxMode`）。 */
  mode?: SandboxMode;
  /** 命中当且仅当某个字符串参数匹配该 glob（仅当工具传入路径类参数时可靠）。 */
  pathGlob?: string;
}

export interface PolicyRule {
  id: string;
  match: PolicyMatch;
  verdict: Verdict;
  reason?: string;
}

export interface PolicyDocument {
  version: 1;
  /** 继承内置预设（`PRESETS` 的键），其规则置于本档规则之前。 */
  extends?: string;
  rules: PolicyRule[];
  /** 内联测试用例：随文档一起被 `testPolicy` 运行（策略即规格）。 */
  tests?: PolicyTestCase[];
}

export interface PolicyTestCase {
  name: string;
  call: PermissionCall;
  ctx: PermissionContext;
  expect: Verdict;
}

export interface PolicyTestResult {
  name: string;
  passed: boolean;
  expected: Verdict;
  actual: Verdict;
  reason?: string;
}

// ------------------------------------------------------------------ 校验

const POLICY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["version", "rules"],
  properties: {
    version: { type: "integer", enum: [1] },
    extends: { type: "string" },
    rules: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "match", "verdict"],
        properties: {
          id: { type: "string" },
          match: {
            type: "object",
            additionalProperties: true,
            properties: {
              tool: { type: "string" },
              toolPattern: { type: "string" },
              kind: {
                type: "string",
                enum: ["harmless", "network-read", "write", "exec", "credential"],
              },
              mode: {
                type: "string",
                enum: ["read-only", "workspace-write", "full-access"],
              },
              pathGlob: { type: "string" },
            },
          },
          verdict: { type: "string", enum: ["allow", "ask", "deny"] },
          reason: { type: "string" },
        },
        additionalProperties: true,
      },
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "call", "ctx", "expect"],
        properties: {
          name: { type: "string" },
          call: { type: "object", additionalProperties: true },
          ctx: { type: "object", additionalProperties: true },
          expect: { type: "string", enum: ["allow", "ask", "deny"] },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};

/** 校验策略文档；非法时抛出含可读原因的 `Error`（沿用 P3.8 口径）。 */
export function validatePolicyDocument(doc: unknown): PolicyDocument {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("策略文档必须是对象");
  }
  const errors = validate(doc, POLICY_SCHEMA);
  if (errors.length) throw new Error(`策略文档校验失败：${errors.join("；")}`);
  return doc as PolicyDocument;
}

// ------------------------------------------------------------------ 匹配

const SEVERITY: Record<Verdict, number> = { allow: 0, ask: 1, deny: 2 };

function toDecision(verdict: Verdict, reason?: string): Decision {
  if (verdict === "allow") return reason ? { verdict: "allow", reason } : { verdict: "allow" };
  if (verdict === "ask") return { verdict: "ask", reason: reason ?? "策略要求宿主确认" };
  return { verdict: "deny", reason: reason ?? "策略拒绝" };
}

function globToRegExp(glob: string): RegExp {
  let re = "^";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${re}$`);
}

function globMatch(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value);
}

function stringArgs(args: unknown): string[] {
  if (typeof args === "string") return [args];
  if (args && typeof args === "object") {
    return Object.values(args as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string",
    );
  }
  return [];
}

function ruleMatches(rule: PolicyRule, ctx: PermissionContext, call: PermissionCall): boolean {
  const m = rule.match;
  if (m.tool !== undefined && m.tool !== call.name) return false;
  if (m.toolPattern !== undefined && !globMatch(m.toolPattern, call.name)) return false;
  if (m.kind !== undefined && m.kind !== ctx.tool.kind) return false;
  if (m.mode !== undefined && m.mode !== ctx.sandboxMode) return false;
  if (m.pathGlob !== undefined && !stringArgs(call.arguments).some((s) => globMatch(m.pathGlob!, s))) {
    return false;
  }
  return true;
}

// ------------------------------------------------------------------ 编译

function rulesFromMatrix(matrix: DecisionMatrix): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const kind of Object.keys(matrix) as ToolKind[]) {
    for (const mode of Object.keys(matrix[kind]) as SandboxMode[]) {
      rules.push({
        id: `matrix:${kind}:${mode}`,
        match: { kind, mode },
        verdict: matrix[kind][mode],
        reason: `预设矩阵：${kind} / ${mode}`,
      });
    }
  }
  return rules;
}

/**
 * 将声明式文档编译为 `PermissionPolicy`。命中多条规则时按 `combinePolicies` 的**最严语义**
 * 求交（allow < ask < deny），不新造语义。无效文档在编译前即被 `validatePolicyDocument` 拒绝。
 */
export function compilePolicy(doc: PolicyDocument): PermissionPolicy {
  validatePolicyDocument(doc);
  const rules = resolveRules(doc);
  return {
    decide(ctx, call) {
      let strictest: Decision = { verdict: "allow" };
      for (const rule of rules) {
        if (!ruleMatches(rule, ctx, call)) continue;
        const decision = toDecision(rule.verdict, rule.reason);
        if (SEVERITY[decision.verdict] > SEVERITY[strictest.verdict]) strictest = decision;
      }
      return strictest;
    },
  };
}

function resolveRules(doc: PolicyDocument): PolicyRule[] {
  const base = doc.extends ? PRESETS[doc.extends]?.rules : undefined;
  if (doc.extends && !base) {
    throw new Error(`策略文档继承未知预设：${doc.extends}（可用：${Object.keys(PRESETS).join(", ")}）`);
  }
  return [...(base ?? []), ...doc.rules];
}

// ------------------------------------------------------------------ 内联测试

/**
 * 运行策略文档的内联测试（或显式传入的用例），返回逐条结果。
 * 可在 CI 内跑策略测试——故意写错期望会产出差异条目而非静默通过。
 */
export async function testPolicy(
  doc: PolicyDocument,
  cases?: PolicyTestCase[],
): Promise<PolicyTestResult[]> {
  const runCases = cases ?? doc.tests ?? [];
  const policy = compilePolicy(doc);
  const results: PolicyTestResult[] = [];
  for (const tc of runCases) {
    const decision = await policy.decide(tc.ctx, tc.call);
    const passed = decision.verdict === tc.expect;
    results.push({
      name: tc.name,
      passed,
      expected: tc.expect,
      actual: decision.verdict,
      ...(passed ? {} : { reason: decision.reason }),
    });
  }
  return results;
}

// ------------------------------------------------------------------ 预设

const READONLY_AUDIT_MATRIX: DecisionMatrix = {
  harmless: { "read-only": "allow", "workspace-write": "allow", "full-access": "allow" },
  "network-read": { "read-only": "allow", "workspace-write": "ask", "full-access": "ask" },
  write: { "read-only": "deny", "workspace-write": "ask", "full-access": "ask" },
  exec: { "read-only": "deny", "workspace-write": "ask", "full-access": "ask" },
  credential: { "read-only": "deny", "workspace-write": "deny", "full-access": "deny" },
};

function ctxFor(kind: ToolKind, mode: SandboxMode): PermissionContext {
  const scope: SandboxScope = { workspace: "/", writablePaths: [], network: "deny" };
  return {
    runId: "policy-test",
    conversationId: "policy-test",
    tool: { name: "tool", kind },
    sandboxMode: mode,
    scope,
  };
}

/** ≥3 套组织预设，以 `PolicyDocument` 形式提供，每套自带内联测试。 */
export const PRESETS: Record<string, PolicyDocument> = {
  "prod-strict": {
    version: 1,
    rules: rulesFromMatrix(PRODUCTION_MATRIX),
    tests: [
      { name: "credential / read-only → deny", call: { name: "db.login", arguments: {} }, ctx: ctxFor("credential", "read-only"), expect: "deny" },
      { name: "credential / workspace-write → deny", call: { name: "db.login", arguments: {} }, ctx: ctxFor("credential", "workspace-write"), expect: "deny" },
      { name: "credential / full-access → deny", call: { name: "db.login", arguments: {} }, ctx: ctxFor("credential", "full-access"), expect: "deny" },
      { name: "harmless / read-only → allow", call: { name: "ping", arguments: {} }, ctx: ctxFor("harmless", "read-only"), expect: "allow" },
      { name: "network-read / workspace-write → deny", call: { name: "fetch", arguments: {} }, ctx: ctxFor("network-read", "workspace-write"), expect: "deny" },
      { name: "write / workspace-write → ask", call: { name: "fs.write", arguments: {} }, ctx: ctxFor("write", "workspace-write"), expect: "ask" },
    ],
  },
  "dev-open": {
    version: 1,
    rules: [{ id: "allow-all", match: {}, verdict: "allow", reason: "开发环境全放开" }],
    tests: [
      { name: "credential / read-only → allow（dev）", call: { name: "db.login", arguments: {} }, ctx: ctxFor("credential", "read-only"), expect: "allow" },
      { name: "exec / full-access → allow（dev）", call: { name: "sh", arguments: {} }, ctx: ctxFor("exec", "full-access"), expect: "allow" },
    ],
  },
  "readonly-audit": {
    version: 1,
    rules: rulesFromMatrix(READONLY_AUDIT_MATRIX),
    tests: [
      { name: "harmless / full-access → allow", call: { name: "ping", arguments: {} }, ctx: ctxFor("harmless", "full-access"), expect: "allow" },
      { name: "network-read / read-only → allow", call: { name: "fetch", arguments: {} }, ctx: ctxFor("network-read", "read-only"), expect: "allow" },
      { name: "network-read / workspace-write → ask", call: { name: "fetch", arguments: {} }, ctx: ctxFor("network-read", "workspace-write"), expect: "ask" },
      { name: "write / read-only → deny", call: { name: "fs.write", arguments: {} }, ctx: ctxFor("write", "read-only"), expect: "deny" },
      { name: "credential / full-access → deny", call: { name: "db.login", arguments: {} }, ctx: ctxFor("credential", "full-access"), expect: "deny" },
    ],
  },
};
