import { redact, type RuntimeEvent } from "@node-agent-runtime/core";
import {
  DefaultPermissionPolicy,
  type Decision,
  type PermissionCall,
  type PermissionContext,
  type PermissionPolicy,
} from "@node-agent-runtime/policy";
import type { AcpConnection } from "./connection.js";
import { JsonRpcError, METHOD_NOT_FOUND } from "./jsonrpc.js";
import { mapToolKind, toolTitle } from "./update.js";
import type {
  PermissionOption,
  PermissionOptionKind,
  RequestPermissionParams,
  RequestPermissionResult,
  ToolCallUpdate_,
} from "./protocol.js";

/**
 * Bridge the runtime's approval flow onto ACP `session/request_permission`.
 *
 * The runtime has one governance seam: `PermissionManager.gate()` calls the
 * policy, and when the verdict is `ask` it parks a `PendingDecision` and waits
 * (60s by default) for somebody to answer it. This class is that "somebody" —
 * it turns each pending decision into a client-side request and feeds the
 * user's answer back through `approve()` / `deny()`.
 *
 * It wears two hats on purpose:
 *
 *   - as a `PermissionPolicy`, it *keeps* `ask` verdicts (M8-2's `NoAskPolicy`
 *     collapsed them to `deny` because there was no channel to ask through);
 *   - as an event subscriber, it answers the decisions it let through.
 *
 * Ordering this relies on (packages/core/src/runtime.ts): `tool:start` is
 * emitted *before* `gate()` runs, so the client has already seen the tool call
 * — with its real `toolCallId` and `status: "pending"` — when the permission
 * request arrives. That is exactly ACP's model:
 * "pending = hasn't started running yet because it is awaiting approval".
 */

type ToolStartEvent = Extract<RuntimeEvent, { type: "tool:start" }>;
type PermissionRequestEvent = Extract<RuntimeEvent, { type: "permission:request" }>;

/** The minimum this bridge needs from `SessionManager` (keeps it unit-testable). */
export interface ApprovalSink {
  approve(decisionId: string, options?: { always?: boolean }): boolean;
  deny(decisionId: string, reason?: string): boolean;
}

export interface AcpPermissionBridgeOptions {
  /** Resolved lazily: the connection exists only once `start()` has run. */
  connection: () => AcpConnection | undefined;
  /** Wrapped policy — its `ask` verdicts are what we relay. */
  inner?: PermissionPolicy;
  logger?: (line: string) => void;
  /** How long to wait for the user before the decision is denied. */
  timeoutMs?: number;
}

/**
 * The four buttons every client gets. `optionId` doubles as the `kind` name so
 * a client that only understands the standard kinds still behaves correctly.
 */
export const DEFAULT_PERMISSION_OPTIONS: readonly PermissionOption[] = [
  { optionId: "allow_once", name: "允许一次", kind: "allow_once" },
  { optionId: "allow_always", name: "总是允许", kind: "allow_always" },
  { optionId: "reject_once", name: "拒绝", kind: "reject_once" },
  { optionId: "reject_always", name: "拒绝并记住", kind: "reject_always" },
];

const OPTION_KINDS: ReadonlyMap<string, PermissionOptionKind> = new Map(
  DEFAULT_PERMISSION_OPTIONS.map((option) => [option.optionId, option.kind]),
);

export class AcpPermissionBridge implements PermissionPolicy {
  private readonly inner: PermissionPolicy;
  private readonly connection: () => AcpConnection | undefined;
  private readonly logger?: (line: string) => void;
  private readonly timeoutMs: number;
  private sink?: ApprovalSink;
  private lastToolCall?: { id: string; name: string };
  /**
   * "Reject always" memory. `PermissionManager` persists *approvals* as grants
   * but has no reject-list, so the bridge holds this one — session-scoped and
   * deliberately not persisted, so a restart re-asks rather than silently
   * carrying a refusal the user may have forgotten.
   */
  private readonly rejected = new Set<string>();
  /** Set when the client answers METHOD_NOT_FOUND — stop asking, deny instead. */
  private noChannel = false;

  constructor(options: AcpPermissionBridgeOptions) {
    this.connection = options.connection;
    this.inner = options.inner ?? new DefaultPermissionPolicy();
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /**
   * Bind the decision sink. Necessary because the manager needs the policy to
   * be constructed, while the bridge needs the manager to answer decisions.
   */
  attach(sink: ApprovalSink): void {
    this.sink = sink;
  }

  /** Remember the tool call in flight so its id can go into the request. */
  noteToolStart(event: ToolStartEvent): void {
    this.lastToolCall = { id: event.toolCall.id, name: event.toolCall.name };
  }

  async decide(ctx: PermissionContext, call: PermissionCall): Promise<Decision> {
    if (this.rejected.has(call.name)) {
      return { verdict: "deny", reason: `工具「${call.name}」已被用户永久拒绝（本次会话不再询问）` };
    }
    const decision = await this.inner.decide(ctx, call);
    if (decision.verdict !== "ask") return decision;
    // Asking with nobody listening would stall the turn until the manager's
    // own timeout fires. Once we know the client cannot answer, say so in the
    // denial reason so the model can pick another route.
    if (this.noChannel) {
      return { verdict: "deny", reason: "客户端未实现 session/request_permission，无法审批" };
    }
    return decision;
  }

  /**
   * Answer one pending decision by asking the client. Fire-and-forget by
   * design: the run loop is already blocked inside `gate()`.
   */
  async handle(event: PermissionRequestEvent): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    if (!event.sessionId) {
      sink.deny(event.decisionId, "缺少 sessionId，无法向客户端发起审批");
      return;
    }
    const connection = this.connection();
    if (!connection) {
      sink.deny(event.decisionId, "ACP 连接不可用，无法发起审批");
      return;
    }

    const params: RequestPermissionParams = {
      sessionId: event.sessionId,
      toolCall: this.toolCallFor(event),
      options: [...DEFAULT_PERMISSION_OPTIONS],
    };

    try {
      const result = (await connection.request(
        "session/request_permission",
        params,
        this.timeoutMs,
      )) as RequestPermissionResult | null;
      this.applyOutcome(sink, event, result?.outcome);
    } catch (error) {
      if (error instanceof JsonRpcError && error.code === METHOD_NOT_FOUND) {
        this.noChannel = true;
      }
      const reason = error instanceof Error ? error.message : String(error);
      this.logger?.(`[acp] session/request_permission 失败：${reason}`);
      // Denying is the only safe answer: an unreviewed dangerous tool must
      // never run just because the approval channel broke.
      sink.deny(event.decisionId, `审批通道不可用：${reason}`);
    }
  }

  private toolCallFor(event: PermissionRequestEvent): ToolCallUpdate_ {
    const match = this.lastToolCall?.name === event.toolName ? this.lastToolCall : undefined;
    const args = asRecord(event.arguments);
    return {
      sessionUpdate: "tool_call",
      // The pending tool call the client is already showing; falls back to the
      // decision id if the names ever drift apart (it stays a stable id for
      // this decision either way).
      toolCallId: match?.id ?? event.decisionId,
      title: toolTitle(event.toolName, args),
      kind: mapToolKind(event.toolName),
      status: "pending",
      // Same redaction the runtime applies to events: the user is approving
      // an action, not donating the arguments' secrets to the UI.
      rawInput: (redact(event.arguments) ?? {}) as Record<string, unknown>,
    };
  }

  private applyOutcome(
    sink: ApprovalSink,
    event: PermissionRequestEvent,
    outcome: RequestPermissionResult["outcome"] | undefined,
  ): void {
    if (!outcome || outcome.outcome === "cancelled") {
      sink.deny(event.decisionId, "用户在客户端取消了审批");
      return;
    }
    switch (OPTION_KINDS.get(outcome.optionId)) {
      case "allow_once":
        sink.approve(event.decisionId);
        return;
      case "allow_always":
        sink.approve(event.decisionId, { always: true });
        return;
      case "reject_once":
        sink.deny(event.decisionId, "用户拒绝了本次工具调用");
        return;
      case "reject_always":
        this.rejected.add(event.toolName);
        sink.deny(event.decisionId, `用户拒绝并禁止了工具「${event.toolName}」`);
        return;
      default:
        // An option we did not send (or a client-defined one) is not a yes.
        sink.deny(event.decisionId, `未知的审批选项：${outcome.optionId}`);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
