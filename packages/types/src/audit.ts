/**
 * Approval audit contracts (P3.3).
 *
 * Every governance decision — allow, deny, host approval, host rejection or
 * ask-timeout — is recorded so operators can answer "who let this tool run,
 * when, and on what arguments" after the fact.
 *
 * Records intentionally carry a **fingerprint** of the call arguments instead
 * of the raw payload: the audit trail must never become a second copy of
 * secrets (P3.2 redaction policy).
 */

export type ApprovalVerdict = "approved" | "denied" | "timeout";

/** What produced the verdict. */
export type ApprovalSource =
  /** A remembered "always allow" grant short-circuited the gate. */
  | "grant"
  /** The policy allowed it on its own (harmless tool, allowlist…). */
  | "policy-allow"
  /** The policy denied it on its own (denylist, credential tool…). */
  | "policy-deny"
  /** A human/UI answered an `ask`. */
  | "host"
  /** Nobody answered before the ask timeout. */
  | "timeout";

export interface ApprovalRecord {
  /** Empty for decisions that never entered the ask queue (policy-only). */
  decisionId: string;
  runId: string;
  sessionId?: string;
  taskId?: string;
  toolName: string;
  /** Stable fingerprint of the call arguments (never the raw payload). */
  argumentsFingerprint?: string;
  verdict: ApprovalVerdict;
  source: ApprovalSource;
  reason?: string;
  /** Epoch milliseconds. */
  decidedAt: number;
}

/** A persisted "always allow this tool" grant (survives process restarts). */
export interface ToolGrant {
  toolName: string;
  grantedAt: number;
  runId?: string;
  sessionId?: string;
}

export interface ApprovalQuery {
  runId?: string;
  sessionId?: string;
  taskId?: string;
  toolName?: string;
}

/**
 * Persistence seam for approvals. Declared here (C1) so the policy package can
 * depend on the contract without taking an IO dependency; the host supplies an
 * implementation backed by `Storage`.
 */
export interface ApprovalStore {
  append(record: ApprovalRecord): void | Promise<void>;
  list(query?: ApprovalQuery): ApprovalRecord[] | Promise<ApprovalRecord[]>;
  /** Tools remembered as "always allow". */
  grants(): ToolGrant[] | Promise<ToolGrant[]>;
  grantTool(grant: ToolGrant): void | Promise<void>;
  revokeTool(toolName: string): void | Promise<void>;
}
