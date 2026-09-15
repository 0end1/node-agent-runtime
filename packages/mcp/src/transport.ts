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
import type { ProcessEnv } from "@node-agent-runtime/types";

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

// ------------------------------------------------ SSRF / supply-chain guard (P3.6)

const SSRF_MESSAGE = "MCP 端点被拒绝（SSRF 防护）";

/** Redirect hops we are willing to follow; every hop is re-validated. */
const MAX_REDIRECTS = 3;

/**
 * Validate an MCP server URL before connecting (P3.6).
 *  - protocol must be http: or https: (no file:/ftp:/gopher:…)
 *  - if `allowlist` is non-empty, the URL origin must match one of its entries
 *    (domain or full origin). Empty allowlist ⇒ only the protocol is enforced.
 * Throws `McpConnectionError` on any violation.
 */
export function validateMcpServerUrl(url: string, allowlist?: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new McpConnectionError(`${SSRF_MESSAGE}：不是合法 URL（${url}）`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new McpConnectionError(`${SSRF_MESSAGE}：仅允许 http/https（收到 ${parsed.protocol}）`);
  }
  if (allowlist && allowlist.length > 0) {
    const origin = parsed.origin;
    const allowed = allowlist.some((entry) => {
      try {
        return new URL(entry).origin === origin;
      } catch {
        return entry === origin || origin.startsWith(entry);
      }
    });
    if (!allowed) {
      throw new McpConnectionError(`${SSRF_MESSAGE}：${origin} 不在白名单 ${allowlist.join(", ")}`);
    }
  }
  return parsed;
}

// ---------------------------------------------------------------- shared

/** Reject every outstanding request (transport died / closed under it). */
function settlePending(pending: Map<string | number, PendingRequest>, error: Error): void {
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
function writeLine(stream: NodeJS.WritableStream, payload: unknown): Promise<void> {
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

/**
 * Environment handed to a spawned MCP server when `inheritEnv` is off (P3.6).
 * Only what a process needs to locate binaries and its temp/home dirs — never
 * the host's credentials (`OPENAI_API_KEY`, cloud tokens, …). Hosts pass
 * secrets explicitly through `env` / `config.mcp.serverEnv` instead.
 */
const MINIMAL_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "USERPROFILE",
  "PATHEXT",
  "LANG",
  "LC_ALL",
];

function buildChildEnv(extra: ProcessEnv | undefined, inheritEnv: boolean): ProcessEnv {
  if (inheritEnv) return { ...process.env, ...(extra ?? {}) };
  const minimal: ProcessEnv = {};
  for (const key of MINIMAL_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) minimal[key] = value;
  }
  return { ...minimal, ...(extra ?? {}) };
}

export interface StdioTransportOptions extends McpTransportOptions {
  /** Executable to spawn (defaults to the running Node executable). */
  command?: string;
  /** Script/module path + flags for the MCP server. */
  args?: string[];
  cwd?: string;
  env?: ProcessEnv;
  /** P3.6: hand the **full** host environment to the server. Off by default so
   *  a compromised/stolen MCP server cannot read the host's other secrets;
   *  opt in only for servers you fully trust. */
  inheritEnv?: boolean;
  /** Called for inbound server→client notifications. */
  onNotification?: (msg: JsonRpcNotification) => void;
  /** P3.6: abort startup if the server emits no JSON-RPC on stdout within this
   *  many ms (a broken/hung binary must not hang the run loop forever). */
  startTimeoutMs?: number;
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
  private readonly env?: ProcessEnv;
  private readonly inheritEnv: boolean;
  private readonly startTimeoutMs?: number;

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
    this.inheritEnv = options.inheritEnv ?? false;
    this.startTimeoutMs = options.startTimeoutMs;
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(this.cwd ? { cwd: this.cwd } : {}),
      // P3.6: minimal env by default — explicit `env` (serverEnv) is merged on
      // top, `inheritEnv: true` is required to expose the whole host env.
      env: buildChildEnv(this.env, this.inheritEnv),
    });
    this.child = child;

    // Runtime failure handlers (persist for the connection's whole life).
    child.once("error", (err) => {
      const wrapped = new McpConnectionError(`MCP 子进程启动失败：${err.message}`);
      settlePending(this.pending, wrapped);
    });
    child.once("exit", (code) => {
      if (this.closed) return;
      const wrapped = new McpConnectionError(`MCP 子进程意外退出（code=${code}）`);
      settlePending(this.pending, wrapped);
    });

    // P3.6: startup readiness/timeout guard. A healthy MCP server prints a
    // JSON-RPC frame to stdout; if nothing arrives within `startTimeoutMs` we
    // kill it and reject so a broken binary can't hang the run loop.
    if (this.startTimeoutMs && this.startTimeoutMs > 0) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) {
            // A broken/runaway server must not keep the run loop alive: kill it
            // and reject so the caller's `await t.start()` unblocks (P3.6).
            child.kill("SIGKILL");
            reject(err);
          } else {
            resolve();
          }
        };
        const timer = setTimeout(
          () => done(new McpConnectionError(`stdio 启动超时（${this.startTimeoutMs}ms 内未就绪）`)),
          this.startTimeoutMs,
        );
        child.stdout.once("data", () => done());
        child.once("error", () => done(new McpConnectionError("MCP 子进程启动失败")));
        child.once("exit", (code) =>
          done(this.closed ? undefined : new McpConnectionError(`MCP 子进程意外退出（code=${code}）`)),
        );
      });
    }

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
    settlePending(this.pending, new McpConnectionError("transport 已关闭"));
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
  /** SSRF allowlist (P3.6): permitted URL origins; empty ⇒ only scheme-checked. */
  urlAllowlist?: readonly string[];
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
  private readonly urlAllowlist?: readonly string[];

  constructor(options: StreamableHttpTransportOptions) {
    if (!options.url) throw new Error("StreamableHttpTransport 需要 url");
    // P3.6: 拒绝不在白名单/非 http(s) 的端点（防 SSRF）。
    validateMcpServerUrl(options.url, options.urlAllowlist);
    this.url = options.url;
    this.timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger;
    this.headers = { ...(options.headers ?? {}) };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.urlAllowlist = options.urlAllowlist;
  }

  async start(): Promise<void> {
    // Stateless endpoint: nothing to bring up eagerly. A failed server only
    // surfaces on the first request.
  }

  async post(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.requestWithGuardedRedirects(JSON.stringify(req), ac.signal);
      if (res.status === 202) {
        // Accepted but the reply would arrive over an SSE stream we do not
        // keep open — surface it loudly instead of hanging.
        throw new McpError(
          "服务端返回 202 Accepted（要求持续 SSE 流）；当前客户端不维持服务端→客户端流",
          { code: -32001 },
        );
      }
      if (!res.ok) {
        throw new McpError(`MCP HTTP 端点返回 ${res.status} ${res.statusText}`, { code: -32001 });
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
        `HTTP 请求失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** One POST with redirects disabled — see `requestWithGuardedRedirects`. */
  private async requestOnce(
    url: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        ...this.headers,
      },
      body,
      signal,
      // P3.6: never auto-follow. A whitelisted endpoint must not be able to
      // bounce us into the private network (cloud metadata, internal services).
      redirect: "manual",
    });
  }

  /**
   * POST with manual redirect handling (P3.6 SSRF guard): every hop is
   * re-checked against the scheme + origin allowlist, so a 30x cannot smuggle
   * the request past `validateMcpServerUrl`.
   */
  private async requestWithGuardedRedirects(
    body: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    let target = this.url;
    for (let hop = 0; ; hop++) {
      const res = await this.requestOnce(target, body, signal);
      if (res.status < 300 || res.status >= 400) return res;

      const location = res.headers.get("location");
      if (!location) return res;
      if (hop >= MAX_REDIRECTS) {
        throw new McpConnectionError(`${SSRF_MESSAGE}：重定向次数超过上限（${MAX_REDIRECTS}）`);
      }
      let next: string;
      try {
        next = new URL(location, target).toString();
      } catch {
        throw new McpConnectionError(`${SSRF_MESSAGE}：非法重定向目标（${location}）`);
      }
      validateMcpServerUrl(next, this.urlAllowlist);
      target = next;
    }
  }

  async notify(msg: JsonRpcNotification): Promise<void> {
    // Fire-and-forget: spec servers answer notifications with 202 + no body.
    try {
      const res = await this.requestOnce(this.url, JSON.stringify(msg), undefined);
      if (res.status >= 300 && res.status < 400) {
        throw new Error(`${SSRF_MESSAGE}：端点返回重定向（${res.status}），已拒绝跟随`);
      }
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
