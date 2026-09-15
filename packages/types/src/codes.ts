/**
 * Stable, machine-readable error codes (P3.1). Threaded through logs, governance
 * events and HTTP responses so operators get a cause they can branch on — not
 * just a human message. New error subclasses should declare a `code` field set
 * to one of these; `errorInfo()` falls back to the class-name map below for
 * legacy classes that predate this scheme.
 */
export const ErrorCode = {
  UNKNOWN: "unknown",
  SANDBOX_VIOLATION: "sandbox_violation",
  SANDBOX_TIMEOUT: "sandbox_timeout",
  RUN_ABORTED: "run_aborted",
  MODEL_REQUEST: "model_request",
  MCP_ERROR: "mcp_error",
  PERMISSION_DENIED: "permission_denied",
  CHECKPOINT_MISMATCH: "checkpoint_mismatch",
  ARTIFACT: "artifact_error",
  SESSION: "session_error",
  CONFIG_INVALID: "config_invalid",
  TOOL_ERROR: "tool_error",
  /** M7-5: an agent recipe failed compile-time validation. */
  AGENT_INVALID: "agent_invalid",
  /** P3.4: a run/session budget or tool rate cap was hit. */
  LIMIT_EXCEEDED: "limit_exceeded",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
}

const ERROR_CODE_VALUES = new Set<string>(Object.values(ErrorCode));

const NAME_TO_CODE: Record<string, ErrorCode> = {
  SandboxViolationError: ErrorCode.SANDBOX_VIOLATION,
  SandboxTimeoutError: ErrorCode.SANDBOX_TIMEOUT,
  RunAbortedError: ErrorCode.RUN_ABORTED,
  ModelRequestError: ErrorCode.MODEL_REQUEST,
  McpError: ErrorCode.MCP_ERROR,
  McpTimeoutError: ErrorCode.MCP_ERROR,
  McpConnectionError: ErrorCode.MCP_ERROR,
  PermissionError: ErrorCode.PERMISSION_DENIED,
  CheckpointMismatchError: ErrorCode.CHECKPOINT_MISMATCH,
  ArtifactError: ErrorCode.ARTIFACT,
  SessionError: ErrorCode.SESSION,
  ConfigError: ErrorCode.CONFIG_INVALID,
  LimitExceededError: ErrorCode.LIMIT_EXCEEDED,
  AgentCompileError: ErrorCode.AGENT_INVALID,
};

/** Normalize any thrown value into a stable `{ code, message }` descriptor. */
export function errorInfo(err: unknown): ErrorInfo {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof e.code === "string" && ERROR_CODE_VALUES.has(e.code)) {
      return {
        code: e.code as ErrorCode,
        message: typeof e.message === "string" ? e.message : String(err),
      };
    }
    if (typeof e.name === "string" && NAME_TO_CODE[e.name]) {
      return {
        code: NAME_TO_CODE[e.name],
        message: typeof e.message === "string" ? e.message : String(err),
      };
    }
  }
  return { code: ErrorCode.UNKNOWN, message: err instanceof Error ? err.message : String(err) };
}
