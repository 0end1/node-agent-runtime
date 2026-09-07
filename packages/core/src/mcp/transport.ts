/**
 * MCP transports (docs/architecture.md §5.3, M4).
 *
 * A transport is responsible for carrying JSON-RPC frames to/from one MCP
 * server. Two implementations ship with the core:
 *
 *  - `StdioTransport`          — spawn a server subprocess; newline-delimited
 *                                JSON-RPC over stdin/stdout (spec stdio).
 *  - `StreamableHttpTransport` — POST JSON-RPC to an HTTP(S) endpoint, reading
 *                                either a plain JSON reply or a `text/event-stream`
 *                                (spec "Streamable HTTP", 2025-03-26).
 *
 * Both are dependency-free: `child_process` + global `fetch` only.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import {
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  McpConnectionError,
  McpError,
  McpTimeoutError,
  hasId,
  parseFrame,
  responseError,
} from "./jsonrpc.js";
import { MCP_PROTOCOL_VERSION } from "./types.js";

/** Common lifecycle both transports implement. */
export interface McpTransport {
  /** Bring the underlying connection up (spawn / ready check). Idempotent. */
  start(): Promise<void>;
  /** Send a request and await its matching response frame. */
  post(req: JsonRpcRequest): Promise<JsonRpcResponse>;
  /** Fire a notification (no response expected). */
  notify(msg: JsonRpcNotification): Promise<void>;
  /** Tear the connection down. Idempotent. */
  close(): Promise<void>;
}

export interface McpTransportOptions {
  /** Optional trace logger. */
  logger?: (line: string) => void;
  /** Deadline per request, ms (default 10_000). */
  requestTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------- shared

/** Reject every outstanding request (transport died / closed under it). */
function settlePending(
  pending: Map<string | number, PendingRequest>,
  error: Error
): void {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(error);
  }
  pending.clear();
}

interface PendingRequest {
  resolve: (res: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Write a full frame to a stream with backpressure-aware async flush. */
function writeLine(
  stream: NodeJS.WritableStream,
  payload: unknown
): Promise<void> {
  const line = JSON.stringify(payload) + "\n";
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      stream.off("drain", onDrain);
      reject(new McpConnectionError(`传输写入失败：${err.message}`));
    };
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    stream.once("error", onError);
    if (stream.write(line)) {
      stream.off("error", onError);
      resolve();
    } else {
      stream.once("drain", onDrain);
    }
  });
}

// ------------------------------------------------------------------ stdio

export interface StdioTransportOptions extends McpTransportOptions {
  /** Executable to spawn (defaults to the running Node executable). */
  command?: string;
  /** Script/module path + flags for the MCP server. */
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called for inbound server→client notifications. */
  onNotification?: (msg: JsonRpcNotification) => void;
}

/**
 * Spawn an MCP server as a child process and speak newline-delimited
 * JSON-RPC 2.0 over its stdin/stdout. Server stderr is forwarded to the
 * optional logger (MCP servers commonly log there).
 */
export class StdioTransport implements McpTransport {
  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number;
  private readonly logger?: (line: string) => void;
  private readonly onNotification?: (msg: JsonRpcNotification) => void;
  private readonly cwd?: string;
  private readonly env?: NodeJS.ProcessEnv;

  private child?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private pending = new Map<string | number, PendingRequest>();
  private closed = false;

  constructor(options: StdioTransportOptions = {}) {
    this.command = options.command ?? process.execPath;
    this.args = options.args ?? [];
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger;
    this.onNotification = options.onNotification;
    this.cwd = options.cwd;
    this.env = options.env;
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(this.cwd ? { cwd: this.cwd } : {}),
      ...(this.env ? { env: { ...process.env, ...this.env } } : {}),
    });
    this.child = child;

    // Surface spawn failures (bad path / ENOENT) as a connection error.
    child.once("error", (err) => {
      const wrapped = new McpConnectionError(`MCP 子进程启动失败：${err.message}`);
      settlePending(this.pending, wrapped);
    });
    child.once("exit", (code) => {
      if (this.closed) return;
      const wrapped = new McpConnectionError(
        `MCP 子进程意外退出（code=${code}）`
      );
      settlePending(this.pending, wrapped);
    });

    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    // Server-side logs are free text on stderr — never protocol bytes.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const text = chunk.trimEnd();
      if (text) this.logger?.(`[mcp-stderr] ${text}`);
    });
  }

  post(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.child) {
      return Promise.reject(new McpConnectionError("transport 尚未 start()"));
    }
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        reject(new McpTimeoutError(req.method, this.timeoutMs));
      }, this.timeoutMs);
      this.pending.set(req.id, { resolve, reject, timer });
      writeLine(this.child!.stdin, req).catch((err: Error) => {
        clearTimeout(timer);
        this.pending.delete(req.id);
        reject(err);
      });
    });
  }

  async notify(msg: JsonRpcNotification): Promise<void> {
    if (!this.child) throw new McpConnectionError("transport 尚未 start()");
    await writeLine(this.child.stdin, msg);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    settlePending(
      this.pending,
      new McpConnectionError("transport 已关闭")
    );
    this.lines?.close();
    const child = this.child;
    this.child = undefined;
    if (child) {
      child.stdin.end();
      // Give the server a moment to exit on its own, then SIGTERM.
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let frame: unknown;
    try {
      frame = parseFrame(line);
    } catch (err) {
      this.logger?.(`[mcp] 忽略无法解析的行: ${String(err)}`);
      return;
    }
    if (hasId(frame)) {
      // Whatever the payload shape (result or error envelope), hand it to the
      // matching pending request — interpretation happens in the client.
      const pending = this.pending.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        pending.resolve(frame as JsonRpcResponse);
      }
      return;
    }
    // No id -> a server-initiated notification (logging, progress…).
    const notification = frame as JsonRpcNotification;
    this.onNotification?.(notification);
    this.logger?.(`[mcp-notify] ${notification.method}`);
  }
}

// ------------------------------------------------------- streamable HTTP

export interface StreamableHttpTransportOptions extends McpTransportOptions {
  /** Base URL of the server's MCP endpoint, e.g. http://127.0.0.1:8080/mcp. */
  url: string;
  /** Extra request headers (auth tokens etc.). */
  headers?: Record<string, string>;
  /** Injectable fetch (tests / custom agents). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Streamable HTTP transport (MCP spec 2025-03-26).
 *
 * Every request is a POST of one JSON-RPC frame to the endpoint. Servers may
 * answer with a plain JSON envelope or a `text/event-stream`; both are
 * understood. Client→server notifications are POSTed fire-and-forget
 * (server replies 202 Accepted).
 */
export class StreamableHttpTransport implements McpTransport {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly logger?: (line: string) => void;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StreamableHttpTransportOptions) {
    if (!options.url) throw new Error("StreamableHttpTransport 需要 url");
    this.url = options.url;
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger;
    this.headers = { ...(options.headers ?? {}) };
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async start(): Promise<void> {
    // Stateless endpoint: nothing to bring up eagerly. A failed server only
    // surfaces on the first request.
  }

  async post(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          ...this.headers,
        },
        body: JSON.stringify(req),
        signal: ac.signal,
      });
      if (res.status === 202) {
        // Accepted but the reply would arrive over an SSE stream we do not
        // keep open — surface it loudly instead of hanging.
        throw new McpError(
          "服务端返回 202 Accepted（要求持续 SSE 流）；当前客户端不维持服务端→客户端流",
          { code: -32001 }
        );
      }
      if (!res.ok) {
        throw new McpError(
          `MCP HTTP 端点返回 ${res.status} ${res.statusText}`,
          { code: -32001 }
        );
      }
      const raw = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      const payload = this.decodeResponse(raw, contentType);
      if (
        typeof payload !== "object" ||
        payload === null ||
        (payload as { jsonrpc?: unknown }).jsonrpc !== "2.0" ||
        !hasId(payload)
      ) {
        throw new McpError("HTTP 响应不是合法的 JSON-RPC 响应", { remote: true });
      }
      const envelope = payload as JsonRpcResponse;
      if ("error" in envelope && envelope.error) {
        throw responseError(envelope);
      }
      return envelope;
    } catch (err) {
      if (err instanceof McpError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new McpTimeoutError(req.method, this.timeoutMs);
      }
      throw new McpConnectionError(
        `HTTP 请求失败：${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async notify(msg: JsonRpcNotification): Promise<void> {
    // Fire-and-forget: spec servers answer notifications with 202 + no body.
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          ...this.headers,
        },
        body: JSON.stringify(msg),
      });
      // Drain so the socket can be reused.
      await res.text();
    } catch (err) {
      this.logger?.(`[mcp] notification 发送失败: ${String(err)}`);
    }
  }

  async close(): Promise<void> {
    // Stateless endpoint: nothing to tear down.
  }

  /** Decode a response body into the JSON-RPC envelope. */
  private decodeResponse(raw: string, contentType: string): unknown {
    if (contentType.includes("text/event-stream")) {
      const parsed = parseSse(raw);
      if (parsed === undefined) {
        throw new McpError("text/event-stream 中没有找到 JSON-RPC 响应", {
          remote: true,
        });
      }
      return parsed;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new McpError("HTTP 响应不是合法 JSON", { remote: true });
    }
  }
}

/**
 * Minimal SSE parser: splits `data:` payloads of the stream and returns the
 * first payload that looks like a JSON-RPC envelope. Robust against
 * interleaved ping events and CRLF line endings.
 */
export function parseSse(body: string): unknown {
  const dataBlocks: string[] = [];
  let dataLines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line === "") {
      if (dataLines.length > 0) {
        dataBlocks.push(dataLines.join("\n"));
        dataLines = [];
      }
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    } else if (!line.startsWith(":")) {
      // ignore comments and event/id/retry fields, keep payload lines only
    }
  }
  if (dataLines.length > 0) dataBlocks.push(dataLines.join("\n"));
  for (const block of dataBlocks) {
    try {
      const parsed = JSON.parse(block) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { jsonrpc?: unknown }).jsonrpc === "2.0"
      ) {
        return parsed;
      }
    } catch {
      // non-JSON data chunk (e.g. ping `{}`) — keep scanning
    }
  }
  return undefined;
}
