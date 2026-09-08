/**
 * Minimal JSON-RPC 2.0 message shapes + errors for the MCP client.
 * Dependency-free on purpose; both transports and the client share this.
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObj {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponseOk {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface JsonRpcResponseErr {
  jsonrpc: "2.0";
  id: string | number;
  error: JsonRpcErrorObj;
}

export type JsonRpcResponse = JsonRpcResponseOk | JsonRpcResponseErr;

/** Whether an inbound wire message carries a request id (i.e. is a response). */
export function hasId(msg: unknown): msg is { id: string | number } {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "id" in msg &&
    (msg as { id: unknown }).id !== undefined
  );
}

/** Standard JSON-RPC error codes. */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  serverErrorStart: -32000,
} as const;

/**
 * A JSON-RPC / MCP level failure surfaced to the caller. `remote` is true
 * when the server itself answered with an `error` frame.
 */
export class McpError extends Error {
  readonly code: number;
  readonly remote: boolean;
  readonly data?: unknown;

  constructor(message: string, options: { code?: number; remote?: boolean; data?: unknown } = {}) {
    super(message);
    this.name = "McpError";
    this.code = options.code ?? JSON_RPC_ERRORS.internalError;
    this.remote = options.remote ?? false;
    this.data = options.data;
  }
}

/** Thrown when a request outlives its deadline (locally enforced). */
export class McpTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`MCP 请求超时：${method} 超过 ${timeoutMs}ms 未得到响应`);
    this.name = "McpTimeoutError";
  }
}

/** Thrown when the transport/process dies while a request is outstanding. */
export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConnectionError";
  }
}

let seq = 0;
/** Monotonic numeric ids for JSON-RPC requests. */
export function nextRequestId(): number {
  seq += 1;
  return seq;
}

export function makeRequest(id: string | number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

export function makeNotification(method: string, params?: unknown): JsonRpcNotification {
  return { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
}

/** Parse one wire frame; throws McpError on malformed input. */
export function parseFrame(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new McpError("收到的 JSON-RPC 帧不是合法 JSON", {
      code: JSON_RPC_ERRORS.parseError,
      remote: true,
    });
  }
}

/** Turn a non-ok JSON-RPC response into an McpError. */
export function responseError(res: JsonRpcResponseErr): McpError {
  return new McpError(`远端错误 ${res.error.code}：${res.error.message}`, {
    code: res.error.code,
    remote: true,
    data: res.error.data,
  });
}
