import type { SandboxMode, SandboxScope } from "@agent-runtime/sandbox";
import type { EventEmitter, RuntimeEvent, ToolKind } from "@agent-runtime/types";
import { newId } from "@agent-runtime/types";

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
  | { verdict: "allow" | "deny"; reason?: string }
  | { verdict: "ask"; reason: string };

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
}

export interface PermissionManagerOptions {
  /** Event bus the approval flow publishes to (host UIs subscribe here). */
  events?: EventEmitter<RuntimeEvent>;
  policy?: PermissionPolicy;
  /** How long an `ask` waits for the host before it counts as denied. */
  askTimeoutMs?: number;
  now?: () => number;
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
  /** Tool names the host approved "always" — the decision is remembered. */
  private readonly alwaysAllowed = new Set<string>();

  constructor(options: PermissionManagerOptions = {}) {
    this.events = options.events;
    this.policy = options.policy ?? new DefaultPermissionPolicy();
    this.askTimeoutMs = options.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  /** Remember that a tool is approved for good (host said "always allow"). */
  allowTool(name: string): void {
    this.alwaysAllowed.add(name);
  }

  /** Decisions waiting for the host (UI renders these as approval prompts). */
  pending(): PendingDecision[] {
    return [...this.waiters.values()].map((w) => w.decision);
  }

  /** The single gate the run loop calls before executing a tool. */
  async gate(call: PermissionCall, ctx: PermissionContext): Promise<GateResult> {
    if (this.alwaysAllowed.has(call.name)) return { ok: true, verdict: "allow" };

    const decision = await this.policy.decide(ctx, call);

    if (decision.verdict === "allow") return { ok: true, verdict: "allow" };

    if (decision.verdict === "deny") {
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

  /** Host approved a pending decision. `always` remembers the tool. */
  approve(decisionId: string, options: { always?: boolean } = {}): boolean {
    const waiter = this.waiters.get(decisionId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.waiters.delete(decisionId);
    if (options.always) this.allowTool(waiter.decision.toolName);
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
    };

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

    return new Promise<GateResult>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(decisionId);
        this.emit({
          type: "permission:denied",
          decisionId,
          runId: ctx.runId,
          ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          toolName: call.name,
          reason: `审批超时（${this.askTimeoutMs}ms），按拒绝处理`,
          timedOut: true,
        });
        resolve({
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
          resolve(
            approved
              ? { ok: true, verdict: "ask-approved", decisionId }
              : { ok: false, verdict: "ask-denied", reason: denyReason, decisionId }
          ),
      });
    });
  }

  private emit(event: RuntimeEvent): void {
    this.events?.emit(event);
  }
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
