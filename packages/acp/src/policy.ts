import type {
  Decision,
  PermissionCall,
  PermissionContext,
  PermissionPolicy,
} from "@node-agent-runtime/policy";

/**
 * M8-2 stopgap: turn every `ask` verdict into an explicit `deny`.
 *
 * The default policy escalates risky tools to `ask`, and a pending decision
 * waits for a host UI (`PermissionManager.askTimeoutMs`, 60s by default). With
 * no approval channel wired to the client yet, that would stall the turn for a
 * minute and then fail the tool call opaquely. Denying up front is honest and
 * lets the model self-correct immediately.
 *
 * M8-3 replaces this with a real `session/request_permission` bridge, which
 * keeps `ask` intact and lets the ACP client render the approval dialog.
 */
export class NoAskPolicy implements PermissionPolicy {
  private readonly inner: PermissionPolicy;
  private readonly note: string;

  constructor(inner: PermissionPolicy, note = "当前连接没有审批通道") {
    this.inner = inner;
    this.note = note;
  }

  async decide(ctx: PermissionContext, call: PermissionCall): Promise<Decision> {
    const decision = await this.inner.decide(ctx, call);
    if (decision.verdict !== "ask") return decision;
    return { verdict: "deny", reason: `${this.note}（${decision.reason}）` };
  }
}
