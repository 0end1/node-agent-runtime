import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  JsonRpcError,
  METHOD_NOT_FOUND,
  isRequest,
  isResponse,
  type JsonRpcMessage,
} from "./jsonrpc.js";
import type { AcpTransport } from "./transport.js";

export type MethodHandler = (params: unknown) => unknown | Promise<unknown>;
export type NotificationHandler = (params: unknown) => void;

export interface AcpConnectionOptions {
  /** Agent-side methods: `initialize`, `session/new`, `session/prompt`, … */
  methods?: Record<string, MethodHandler>;
  /** Client->agent notifications: `session/cancel`, … */
  notifications?: Record<string, NotificationHandler>;
  /** Diagnostics (stderr-bound in production: stdout is reserved). */
  logger?: (line: string) => void;
  /** How long `request()` waits for the peer before failing. */
  requestTimeoutMs?: number;
}

/**
 * The JSON-RPC server half of an ACP connection.
 *
 * Dispatches inbound requests to method handlers, serializes thrown values into
 * proper error objects, and keeps a pending-request table so the agent can also
 * *call* the client (`session/request_permission` in M8-3).
 */
export class AcpConnection {
  private readonly transport: AcpTransport;
  private readonly methods: Record<string, MethodHandler>;
  private readonly notifications: Record<string, NotificationHandler>;
  private readonly logger?: (line: string) => void;
  private readonly requestTimeoutMs: number;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(transport: AcpTransport, options: AcpConnectionOptions = {}) {
    this.transport = transport;
    this.methods = options.methods ?? {};
    this.notifications = options.notifications ?? {};
    this.logger = options.logger;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    transport.onMessage((message) => void this.handle(message));
    transport.onError((error) => this.logger?.(`[acp] ${error.message}`));
  }

  start(): void {
    this.transport.start();
  }

  close(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("ACP connection closed"));
    }
    this.pending.clear();
    this.transport.close();
  }

  notify(method: string, params?: unknown): void {
    this.transport.send({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
  }

  /** Call a client-side method (e.g. `session/request_permission`) and await its result. */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const timeout = timeoutMs ?? this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeout}ms`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      });
    });
  }

  /** Handle one inbound message. Public so tests can drive it directly. */
  async handle(message: JsonRpcMessage): Promise<void> {
    if (isResponse(message)) {
      const entry = this.pending.get(Number(message.id));
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(Number(message.id));
      if ("error" in message && message.error) {
        entry.reject(new JsonRpcError(message.error.code, message.error.message, message.error.data));
      } else {
        entry.resolve("result" in message ? message.result : null);
      }
      return;
    }

    if (isRequest(message)) {
      const handler = this.methods[message.method];
      if (!handler) {
        this.transport.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: METHOD_NOT_FOUND, message: `Method not found: ${message.method}` },
        });
        return;
      }
      try {
        const result = await handler(message.params);
        this.transport.send({ jsonrpc: "2.0", id: message.id, result: result ?? null });
      } catch (error) {
        this.transport.send({
          jsonrpc: "2.0",
          id: message.id,
          error: this.toErrorObject(error),
        });
      }
      return;
    }

    const listener = this.notifications[(message as { method: string }).method];
    if (listener) {
      try {
        listener((message as { params?: unknown }).params);
      } catch (error) {
        this.logger?.(`[acp] notification handler failed: ${String(error)}`);
      }
    }
  }

  private toErrorObject(error: unknown): { code: number; message: string; data?: unknown } {
    if (error instanceof JsonRpcError) return error.toObject();
    const message = error instanceof Error ? error.message : String(error);
    return { code: INTERNAL_ERROR, message };
  }

  /** Convenience for handlers that need to reject malformed params. */
  static invalidParams(message: string): JsonRpcError {
    return new JsonRpcError(INVALID_PARAMS, message);
  }
}
