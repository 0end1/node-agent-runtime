import type { SandboxMode, SandboxScope } from "@node-agent-runtime/sandbox";
import type {
  ApprovalRecord,
  ApprovalStore,
  EventEmitter,
  RuntimeEvent,
  ToolGrant,
  ToolKind,
} from "@node-agent-runtime/types";
import { fingerprint, newId } from "@node-agent-runtime/types";

/**
 * Permission — authorization decisions (M3, docs/architecture.md §6.1).
 *
 *   policy.decide(ctx, call) → allow | deny | ask
 *                                        └→ emit permission:request → host decides
 *                                           (approve / deny / timeout=deny)
 *
 * Permission is orthogonal to the sandbox: the sandbox defines *what can be
 * reached*, the policy defines *what is allowed*. Denied calls are fed back to
 * the model as a tool error so it can self-correct.
 */

export type Verdict = "allow" | "deny" | "ask";

export type Decision =
  { verdict: "allow" | "deny"; reason?: string } | { verdict: "ask"; reason: string };

export interface PermissionCall {
  name: string;
  arguments: unknown;
}

export interface PermissionContext {
  runId: string;
  conversationId: string;
  sessionId?: string;
  taskId?: string;
  tool: { name: string; kind: ToolKind };
  /** Run-level boundary the policy may take into account. */
  sandboxMode: SandboxMode;
  scope: SandboxScope;
}

export interface PermissionPolicy {
  decide(ctx: PermissionContext, call: PermissionCall): Decision | Promise<Decision>;
}

export type GateVerdict = "allow" | "deny" | "ask-approved" | "ask-denied" | "timeout";

export interface GateResult {
  ok: boolean;
  verdict: GateVerdict;
  reason?: string;
  decisionId?: string;
}

export interface PendingDecision {
  decisionId: string;
  toolName: string;
  reason: string;
  runId: string;
  sessionId?: string;
  taskId?: string;
  createdAt: number;
  /** P3.3: fingerprint of the call arguments, carried into the audit record. */
  argumentsFingerprint: string;
}

export interface PermissionManagerOptions {
  /** Event bus the approval flow publishes to (host UIs subscribe here). */
  events?: EventEmitter<RuntimeEvent>;
  policy?: PermissionPolicy;
  /** How long an `ask` waits for the host before it counts as denied. */
  askTimeoutMs?: number;
  now?: () => number;
  /**
   * P3.3: persistence for the approval audit trail and "always allow" grants.
   * When set, every governance decision is appended and grants survive restarts.
   */
  store?: ApprovalStore;
}

interface Waiter {
  decision: PendingDecision;
  resolve: (result: { approved: boolean; reason?: string; timedOut?: boolean }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_ASK_TIMEOUT_MS = 60_000;

export class PermissionManager {
  private policy: PermissionPolicy;
  private readonly events?: EventEmitter<RuntimeEvent>;
  private readonly askTimeoutMs: number;
  private readonly now: () => number;
  private readonly waiters = new Map<string, Waiter>();
  /** Tool names the host approved "always" — in-memory mirror of the store's grants. */
  private readonly alwaysAllowed = new Set<string>();
  /** P3.3: audit + grant persistence. */
  private readonly store?: ApprovalStore;
  private hydrated = false;
  /** Serialized chain of in-flight audit/grant writes (flushed by `flush()`). */
  private pendingFlush: Promise<void> = Promise.resolve();

  constructor(options: PermissionManagerOptions = {}) {
    this.events = options.events;
    this.policy = options.policy ?? new DefaultPermissionPolicy();
    this.askTimeoutMs = options.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
    this.store = options.store;
  }

  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  /** Remember that a tool is approved for good (host said "always allow"). */
  allowTool(name: string): void {
    this.alwaysAllowed.add(name);
  }

  /** Remove a tool from the "always allow" set (in memory and in the store). */
  revokeTool(name: string): void {
    this.alwaysAllowed.delete(name);
    this.enqueue(() => this.store?.revokeTool(name));
  }

  /**
   * P3.3: pre-load persisted "always allow" grants. Called lazily on the first
   * `gate()`; hosts may call it eagerly to reflect grants before a run.
   */
  async hydrate(): Promise<void> {
    await this.ensureHydrated();
  }

  /** Wait for every audit/grant write to land (e.g. before exporting the trail). */
  async flush(): Promise<void> {
    await this.pendingFlush;
  }

  /** Persist an "always allow" grant with its origin context. */
  private persistGrant(grant: ToolGrant): void {
    this.enqueue(() => this.store?.grantTool(grant));
  }

  private enqueue(op: () => void | Promise<void>): void {
    if (!this.store) return;
    this.pendingFlush = this.pendingFlush.then(op).catch(() => undefined);
  }

  private async ensureHydrated(): Promise<void> {
    if (this.hydrated || !this.store) return;
    try {
      const grants = await this.store.grants();
      for (const grant of grants) this.alwaysAllowed.add(grant.toolName);
      this.hydrated = true;
    } catch {
      // A read failure degrades to no remembered grants; retry on next gate.
    }
  }

  /** Decisions waiting for the host (UI renders these as approval prompts). */
  pending(): PendingDecision[] {
    return [...this.waiters.values()].map((w) => w.decision);
  }

  /** The single gate the run loop calls before executing a tool. */
  async gate(call: PermissionCall, ctx: PermissionContext): Promise<GateResult> {
    await this.ensureHydrated();
    if (this.alwaysAllowed.has(call.name)) {
      this.audit({
        ...approvalBase(ctx, call),
        verdict: "approved",
        source: "grant",
        reason: "命中 always 白名单",
      });
      return { ok: true, verdict: "allow" };
    }

    const decision = await this.policy.decide(ctx, call);

    if (decision.verdict === "allow") {
      // P3.3: 放行也是一种治理决策——无害工具/白名单放行全部留痕。
      this.audit({
        ...approvalBase(ctx, call),
        verdict: "approved",
        source: "policy-allow",
        reason: decision.reason ?? "策略放行",
      });
      return { ok: true, verdict: "allow" };
    }

    if (decision.verdict === "deny") {
      this.audit({
        ...approvalBase(ctx, call),
        verdict: "denied",
        source: "policy-deny",
        reason: decision.reason ?? "策略拒绝",
      });
      this.emit({
        type: "permission:denied",
        decisionId: "",
        runId: ctx.runId,
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        toolName: call.name,
        reason: decision.reason ?? "策略拒绝",
      });
      return { ok: false, verdict: "deny", reason: decision.reason ?? "策略拒绝" };
    }

    return this.ask(call, ctx, decision.reason ?? "需要宿主确认");
  }

  /** Record one governance decision into the audit store (P3.3). */
  private audit(partial: Omit<ApprovalRecord, "decidedAt">): void {
    if (!this.store) return;
    const record: ApprovalRecord = { ...partial, decidedAt: this.now() };
    this.enqueue(() => this.store?.append(record));
  }

  /** Host approved a pending decision. `always` remembers the tool. */
  approve(decisionId: string, options: { always?: boolean } = {}): boolean {
    const waiter = this.waiters.get(decisionId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.waiters.delete(decisionId);
    if (options.always) {
      this.allowTool(waiter.decision.toolName);
      // P3.3: persist the grant so it survives a restart.
      this.persistGrant({
        toolName: waiter.decision.toolName,
        grantedAt: this.now(),
        ...(waiter.decision.runId ? { runId: waiter.decision.runId } : {}),
        ...(waiter.decision.sessionId ? { sessionId: waiter.decision.sessionId } : {}),
      });
    }
    this.audit({
      decisionId,
      runId: waiter.decision.runId,
      ...(waiter.decision.sessionId ? { sessionId: waiter.decision.sessionId } : {}),
      ...(waiter.decision.taskId ? { taskId: waiter.decision.taskId } : {}),
      toolName: waiter.decision.toolName,
      argumentsFingerprint: waiter.decision.argumentsFingerprint,
      verdict: "approved",
      source: "host",
      ...(options.always ? { reason: "宿主批准并加入 always 白名单" } : {}),
    });
    this.emit({
      type: "permission:approved",
      decisionId,
      runId: waiter.decision.runId,
      ...(waiter.decision.sessionId ? { sessionId: waiter.decision.sessionId } : {}),
      toolName: waiter.decision.toolName,
      ...(options.always ? { always: true } : {}),
    });
    waiter.resolve({ approved: true });
    return true;
  }

  /** Host rejected a pending decision. */
  deny(decisionId: string, reason = "宿主拒绝"): boolean {
    const waiter = this.waiters.get(decisionId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.waiters.delete(decisionId);
    this.audit({
      decisionId,
      runId: waiter.decision.runId,
      ...(waiter.decision.sessionId ? { sessionId: waiter.decision.sessionId } : {}),
      ...(waiter.decision.taskId ? { taskId: waiter.decision.taskId } : {}),
      toolName: waiter.decision.toolName,
      argumentsFingerprint: waiter.decision.argumentsFingerprint,
      verdict: "denied",
      source: "host",
      reason,
    });
    this.emit({
      type: "permission:denied",
      decisionId,
      runId: waiter.decision.runId,
      ...(waiter.decision.sessionId ? { sessionId: waiter.decision.sessionId } : {}),
      toolName: waiter.decision.toolName,
      reason,
    });
    waiter.resolve({ approved: false, reason });
    return true;
  }

  // ------------------------------------------------------------------ internals

  private ask(call: PermissionCall, ctx: PermissionContext, reason: string): Promise<GateResult> {
    const decisionId = newId("dec");
    const decision: PendingDecision = {
      decisionId,
      toolName: call.name,
      reason,
      runId: ctx.runId,
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      createdAt: this.now(),
      argumentsFingerprint: fingerprint(call.arguments),
    };

    // waiter 必须在 emit **之前** 登记：宿主最自然的写法就是在
    // `permission:request` 的监听器里同步 `approve()`（CLI 提示、示例、脚本
    // 自动批准都这么写）。若 emit 时 waiter 还没进表，approve 会静默失效 ——
    // 决策要等满 `askTimeoutMs` 才按超时拒绝，表现为「明明批准了，工具却卡
    // 到超时才失败」。故先建 promise 与 waiter，再发事件。
    let settle: (result: GateResult) => void = () => {};
    const promise = new Promise<GateResult>((resolve) => {
      settle = resolve;
    });

    const timer = setTimeout(() => {
      this.waiters.delete(decisionId);
      this.audit({
        decisionId,
        runId: ctx.runId,
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
        toolName: call.name,
        argumentsFingerprint: decision.argumentsFingerprint,
        verdict: "timeout",
        source: "timeout",
        reason: `审批超时（${this.askTimeoutMs}ms）`,
      });
      this.emit({
        type: "permission:denied",
        decisionId,
        runId: ctx.runId,
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        toolName: call.name,
        reason: `审批超时（${this.askTimeoutMs}ms），按拒绝处理`,
        timedOut: true,
      });
      settle({
        ok: false,
        verdict: "timeout",
        reason: `审批超时（${this.askTimeoutMs}ms），按拒绝处理`,
        decisionId,
      });
    }, this.askTimeoutMs);

    this.waiters.set(decisionId, {
      decision,
      timer,
      resolve: ({ approved, reason: denyReason }) =>
        settle(
          approved
            ? { ok: true, verdict: "ask-approved", decisionId }
            : { ok: false, verdict: "ask-denied", reason: denyReason, decisionId },
        ),
    });

    this.emit({
      type: "permission:request",
      decisionId,
      runId: ctx.runId,
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      toolName: call.name,
      arguments: call.arguments,
      reason,
    });

    return promise;
  }

  private emit(event: RuntimeEvent): void {
    this.events?.emit(event);
  }
}

/** Common fields of an audit record shared by every gate outcome (P3.3). */
function approvalBase(
  ctx: PermissionContext,
  call: PermissionCall,
  decisionId = "",
): Omit<ApprovalRecord, "verdict" | "source" | "reason" | "decidedAt"> {
  return {
    decisionId,
    runId: ctx.runId,
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
    toolName: call.name,
    argumentsFingerprint: fingerprint(call.arguments),
  };
}

// ------------------------------------------------------------------- policies

export type DecisionMatrix = Record<ToolKind, Record<SandboxMode, Verdict>>;

/** Dangerous tools ask (or are denied); harmless ones just run. */
export const DEFAULT_MATRIX: DecisionMatrix = {
  harmless: { "read-only": "allow", "workspace-write": "allow", "full-access": "allow" },
  "network-read": { "read-only": "allow", "workspace-write": "ask", "full-access": "allow" },
  write: { "read-only": "deny", "workspace-write": "ask", "full-access": "ask" },
  exec: { "read-only": "deny", "workspace-write": "ask", "full-access": "ask" },
  credential: { "read-only": "deny", "workspace-write": "deny", "full-access": "deny" },
};

export interface DefaultPermissionPolicyOptions {
  /** Per-kind / per-mode overrides on top of `DEFAULT_MATRIX`. */
  matrix?: Partial<Record<ToolKind, Partial<Record<SandboxMode, Verdict>>>>;
  /** Tool names that are always allowed. */
  allow?: readonly string[];
  /** Tool names that are always denied (checked first). */
  deny?: readonly string[];
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  private readonly matrix: DecisionMatrix;
  private readonly allow: Set<string>;
  private readonly deny: Set<string>;

  constructor(options: DefaultPermissionPolicyOptions = {}) {
    this.matrix = { ...DEFAULT_MATRIX };
    for (const [kind, modes] of Object.entries(options.matrix ?? {})) {
      this.matrix[kind as ToolKind] = { ...this.matrix[kind as ToolKind], ...modes };
    }
    this.allow = new Set(options.allow ?? []);
    this.deny = new Set(options.deny ?? []);
  }

  decide(ctx: PermissionContext, call: PermissionCall): Decision {
    if (this.deny.has(call.name)) {
      return { verdict: "deny", reason: `工具「${call.name}」在禁用名单内` };
    }
    if (this.allow.has(call.name)) return { verdict: "allow" };

    const verdict = this.matrix[ctx.tool.kind]?.[ctx.sandboxMode] ?? "ask";
    return verdict === "ask"
      ? { verdict: "ask", reason: `工具「${call.name}」属于 ${ctx.tool.kind} 类，需要宿主确认` }
      : { verdict };
  }
}

/** A fixed verdict for every call (tests, `--yolo`, locked-down hosts). */
export class StaticPolicy implements PermissionPolicy {
  constructor(private readonly decision: Decision) {}
  decide(): Decision {
    return this.decision;
  }
}

const SEVERITY: Record<Verdict, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * Combine policies and take the **strictest** verdict (Codex `execpolicy`
 * behaviour: when several rules match, the most restrictive wins).
 */
export function combinePolicies(...policies: PermissionPolicy[]): PermissionPolicy {
  return {
    async decide(ctx, call) {
      let strictest: Decision = { verdict: "allow" };
      for (const policy of policies) {
        const decision = await policy.decide(ctx, call);
        if (SEVERITY[decision.verdict] > SEVERITY[strictest.verdict]) strictest = decision;
      }
      return strictest;
    },
  };
}

/** Convenience: a policy that only ever allows/denies a named set of tools. */
export function toolListPolicy(options: {
  allow?: readonly string[];
  deny?: readonly string[];
}): PermissionPolicy {
  const allow = new Set(options.allow ?? []);
  const deny = new Set(options.deny ?? []);
  return {
    decide(_ctx, call) {
      if (deny.has(call.name)) return { verdict: "deny", reason: `工具「${call.name}」被禁用` };
      if (allow.has(call.name)) return { verdict: "allow" };
      return { verdict: "ask", reason: `工具「${call.name}」未在名单内` };
    },
  };
}
