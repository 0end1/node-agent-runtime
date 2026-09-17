/**
 * Minimal JSON-RPC 2.0 message layer for the ACP stdio transport.
 *
 * ACP v1 frames messages as **newline-delimited JSON** over the agent's
 * stdin/stdout (docs/acp-spec-review.md §2). Two hard rules follow from that:
 *
 *   1. `stdout` carries nothing but ACP messages — logging goes to stderr.
 *   2. A single message must not contain a literal newline. `JSON.stringify`
 *      escapes them, so `encodeMessage` is safe by construction.
 *
 * Kept dependency-free so the protocol layer can be tested in isolation.
 */

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/** A failure that is reported back to the peer as a JSON-RPC error object. */
export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }

  toObject(): JsonRpcErrorObject {
    return { code: this.code, message: this.message, ...(this.data !== undefined ? { data: this.data } : {}) };
  }
}

/** Serialize one message into a wire frame (newline-terminated, no inner newlines). */
export function encodeMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Buffers a byte stream and yields complete lines. Trailing data without a
 * terminating newline is kept until the rest arrives.
 */
export class LineDecoder {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // The last element is whatever follows the final newline (possibly "").
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0);
  }
}

export function parseMessage(line: string): JsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new JsonRpcError(PARSE_ERROR, "Invalid JSON payload");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new JsonRpcError(INVALID_REQUEST, "Message must be a JSON object");
  }
  const message = parsed as Record<string, unknown>;
  if (message.jsonrpc !== "2.0") {
    throw new JsonRpcError(INVALID_REQUEST, 'Field "jsonrpc" must be "2.0"');
  }
  if (typeof message.method !== "string" && message.id === undefined) {
    throw new JsonRpcError(INVALID_REQUEST, 'Message must carry "method" or "id"');
  }
  return parsed as JsonRpcMessage;
}

export function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "method" in message && "id" in message && (message as JsonRpcRequest).id !== undefined;
}

export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && !("method" in message);
}
