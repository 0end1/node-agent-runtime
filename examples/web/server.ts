#!/usr/bin/env tsx
/**
 * Web console demo: serves a single-page Agent console and streams every
 * runtime lifecycle event to the browser over SSE.
 *
 *   npm run demo:web                     # mock provider (no API key)
 *   OPENAI_API_KEY=sk-xxx npm run demo:web
 *   PORT=8787 npm run demo:web
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Agent,
  AgentRuntime,
  FileStorage,
  defineTool,
  errorPayload,
  loadConfig,
  ConsoleLogger,
  type LogLevel,
  type ModelProvider,
  type RuntimeEvent,
} from "@node-agent-runtime/core";
import { SessionManager, type Session } from "@node-agent-runtime/host";
import { createProductionDefaults } from "@node-agent-runtime/policy";
import { MockProvider } from "@node-agent-runtime/mock";
import { builtinTools } from "@node-agent-runtime/tools-basic";
import { OpenAIClientProvider } from "@node-agent-runtime/provider-openai";
import { SQLiteStorage } from "@node-agent-runtime/store-sqlite";
import {
  decideAuth,
  decideCors,
  decideCsrf,
  decidePreflight,
  missingTokenWhenExposed,
} from "./security.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const argv = process.argv.slice(2);

// P3.8: 集中、分层的运行时配置（密钥只经配置/环境注入，无散落 magic env 读取）。
const config = loadConfig({
  env: process.env,
  overrides: argv.includes("--provider=openai") ? { provider: { kind: "openai" } } : {},
});

function nodeSupportsSqlite(): boolean {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && (min ?? 0) >= 13);
}
const wantsSqlite = argv.includes("--storage=sqlite");
if (wantsSqlite && !nodeSupportsSqlite()) {
  console.error(
    "⚠ --storage=sqlite 需要 Node >= 22.13（node:sqlite）。请升级 Node 或改用默认 FileStorage。",
  );
  process.exit(1);
}

// 静态控制台目录：默认模块同目录 public/（dev / demo）；
// Tauri 生产打包时由壳通过 AGENT_CONSOLE_PUBLIC_DIR 指定（frontendDist 被打入 app Resources）。
const PUBLIC_DIR = process.env.AGENT_CONSOLE_PUBLIC_DIR ?? join(__dirname, "public");
const HTML_PATH = join(PUBLIC_DIR, "index.html");

// ---- provider selection ----------------------------------------------------

function pickProvider(): ModelProvider {
  if (config.provider.kind === "openai") {
    return new OpenAIClientProvider({
      apiKey: config.provider.apiKey,
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
    });
  }
  return new MockProvider();
}

const provider = pickProvider();

// 延迟引用：demo 写文件工具需把落盘结果登记为 artifact，但会话上下文在
// 运行时（请求级）才确定，故用模块级变量记录当前活跃 session。
let activeSession = "default";
const logger = new ConsoleLogger({
  level: (process.env.AGENT_DEBUG ? "debug" : config.logLevel) as LogLevel,
});
const runtime = new AgentRuntime({
  provider,
  logger,
  // P3.4: 运行级预算（步数/时长/token/费用/工具速率）来自 config.limits。
  limits: config.limits,
});
/** Demo-only write tool (M3): mirrors examples/cli.ts — declares `kind: "write"`
 *  so the default policy gates it with an `ask`, and the sandbox keeps the write
 *  inside cwd. Lets the web console exercise the approval + sandbox-write surface. */
const demoWriteTool = defineTool({
  name: "demo_write_file",
  description:
    "把文本写入工作区内的一个文件（演示用：会触发人工授权，且沙箱写可见）。路径相对于当前工作目录，例如 .demo-out/note.txt。",
  meta: { kind: "write", pathArgs: ["path"] },
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的文件路径，如 .demo-out/note.txt" },
      content: { type: "string", description: "要写入的文本内容" },
    },
    required: ["path", "content"],
  },
  async execute(args: { path: string; content: string }) {
    const full = resolve(process.cwd(), args.path);
    await mkdir(dirname(full), { recursive: true });
    const text = String(args.content ?? "");
    await writeFile(full, text, "utf8");
    // M6 P2.4 加固：写文件落盘后登记为可引用 artifact（见 cli.ts 同款）。
    try {
      await manager.artifacts.save({
        sessionId: activeSession,
        kind: "file",
        name: args.path,
        content: text,
      });
    } catch {
      /* artifact 登记失败不应影响写文件主流程 */
    }
    return { ok: true, path: full, bytes: Buffer.byteLength(text) };
  },
});

const agent = new Agent({
  name: "assistant",
  tools: [...builtinTools, demoWriteTool],
});

// Sessions are persisted to disk (M1): the browser keeps a stable session id
// in localStorage, so refreshes — and even server restarts — resume the same
// conversation with full context.
const DATA_DIR = process.env.RUNTIME_DATA ?? join(process.cwd(), ".runtime-data");
const storage = wantsSqlite
  ? new SQLiteStorage({ file: process.env.SQLITE_FILE ?? join(DATA_DIR, "agent.db") })
  : new FileStorage(DATA_DIR);
// P3.7: 生产默认——最小权限策略 + 锁定沙箱域（禁网、仅工作区内可写）。
// P3.3: 审批审计与 always 白名单经 SessionManager 默认写入 approvalStore（本机持久化）。
const prod = createProductionDefaults(process.cwd());
const manager = new SessionManager({
  runtime,
  storage,
  agents: [agent],
  sandboxMode: prod.sandboxMode,
  scope: prod.scope,
  policy: prod.policy,
});

async function getOrCreateSession(sessionKey: string): Promise<Session> {
  const existing = await manager.getSession(sessionKey);
  if (existing) return existing;
  return manager.createSession({ id: sessionKey, agentId: agent.name, title: "web console" });
}

/** Events the classic console UI knows how to render (session/task events are
 *  new in M1 and ignored by the current front-end). */
const UI_EVENTS = new Set<RuntimeEvent["type"]>([
  "run:start",
  "message:user",
  "step:start",
  "model:response",
  "tool:start",
  "tool:end",
  "run:end",
  "run:error",
]);

// ---- helpers ---------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// P3.5: Web/本地 server 鉴权与防跨站（安全配置收口到 AGENT_API_TOKEN / AGENT_CORS_ALLOW_ORIGINS，
// 逻辑抽到 ./security.ts 以便自动化测试）。默认只允许 loopback 来源与显式白名单来源，
// 显式监听非 loopback 地址却未设令牌时直接拒绝启动，避免把无鉴权控制台暴露到网络上。
const API_TOKEN = (process.env.AGENT_API_TOKEN ?? "").trim();
const CORS_ALLOW = (process.env.AGENT_CORS_ALLOW_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// P3.5: 非 loopback 监听（对外暴露）而缺令牌 → 启动即拒，不进入 listen（默认拒绝）。
const refusal = missingTokenWhenExposed(HOST, API_TOKEN);
if (refusal) {
  console.error(`[security] ${refusal} 已拒绝启动。`);
  process.exit(1);
}

/** Reject cross-origin requests unless the Origin is loopback or explicitly allowed. */
function corsGuard(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === "OPTIONS") {
    // P3.5: preflight goes through the same origin guard, and an allowed
    // origin also gets the headers that make the actual request possible.
    const pre = decidePreflight(req.headers.origin, CORS_ALLOW);
    res.writeHead(pre.status, pre.headers);
    if (pre.body) res.end(pre.body);
    else res.end();
    return false;
  }
  const decision = decideCors(req.headers.origin, CORS_ALLOW);
  if (decision.allow) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    return true;
  }
  res.writeHead(decision.status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: decision.error }));
  return false;
}

/** P3.5: CSRF backstop for tokenless (loopback) deployments — modern browsers
 *  send `Sec-Fetch-Site`, so a cross-site write without an Origin is caught. */
function csrfGuard(req: IncomingMessage, res: ServerResponse): boolean {
  const decision = decideCsrf({
    method: req.method,
    origin: req.headers.origin,
    secFetchSite: req.headers["sec-fetch-site"],
    hasToken: Boolean(API_TOKEN),
  });
  if (decision.allow) return true;
  res.writeHead(decision.status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: decision.error }));
  return false;
}

/** Require `Authorization: Bearer <AGENT_API_TOKEN>` when a token is configured. */
function authGuard(req: IncomingMessage, res: ServerResponse): boolean {
  const decision = decideAuth(req.headers.authorization, API_TOKEN);
  if (decision.allow) return true;
  res.writeHead(decision.status, {
    "content-type": "application/json",
    "www-authenticate": "Bearer",
  });
  res.end(JSON.stringify({ error: decision.error }));
  return false;
}

/** Read a request body with an upper bound (default 256KB) to avoid memory abuse. */
async function readBody(req: IncomingMessage, maxBytes = 256_000): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += b.length;
    if (size > maxBytes) throw new Error("请求体过大");
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendSSE(res: ServerResponse, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/** Per-event pacing (ms) so progressive steps read naturally on screen. */
function pacing(type: RuntimeEvent["type"]): number {
  const fast = provider.id === "mock";
  switch (type) {
    case "step:start":
      return fast ? 320 : 220;
    case "tool:start":
      return fast ? 260 : 160;
    case "tool:end":
      return fast ? 300 : 200;
    case "model:response":
      return fast ? 300 : 160;
    case "run:end":
      return fast ? 420 : 260;
    default:
      return fast ? 120 : 80;
  }
}

// ---- HTTP server ------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // P5.6: 部署探活（容器 healthcheck / 负载均衡）。只回存活状态，不经鉴权，
  // 也不暴露任何运行时信息。
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // P3.5: 防跨站 + 鉴权（demo 默认开放，设 AGENT_API_TOKEN / AGENT_CORS_ALLOW_ORIGINS 即收紧）。
  if (!corsGuard(req, res)) return;
  if (!csrfGuard(req, res)) return;
  if (!authGuard(req, res)) return;

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(HTML_PATH, "utf8");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(html);
      return;
    }

    if (url.pathname === "/api/chat") {
      const input = (url.searchParams.get("input") ?? "").trim();
      const sessionId = (url.searchParams.get("session") ?? "default").trim();
      activeSession = sessionId;
      if (!input) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "input 不能为空" }));
        return;
      }
      if (input.length > 4000) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "input 过长（>4000）" }));
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`retry: 1000\n\n`);

      // Initial handshake so the UI can show "connecting".
      sendSSE(res, { type: "system", payload: { message: "connected", provider: provider.id } });
      await sleep(provider.id === "mock" ? 350 : 120);

      const buf: Array<{ type: string; payload: unknown }> = [];
      const unsubscribe = runtime.subscribe((e: RuntimeEvent) => {
        if (UI_EVENTS.has(e.type)) buf.push({ type: e.type, payload: e });
      });

      let runError: unknown = null;
      let outcome: Awaited<ReturnType<SessionManager["chat"]>> | undefined;

      try {
        const session = await getOrCreateSession(sessionId);
        outcome = await manager.chat(session.id, input);
      } catch (err) {
        runError = err;
      } finally {
        unsubscribe();
      }

      // Replay buffered events with light pacing.
      for (const entry of buf) {
        if (res.closed || res.destroyed) return;
        if (entry.type === "step:start") {
          sendSSE(res, { type: "clear", payload: {} });
        }
        sendSSE(res, entry);
        const pace = pacing(entry.type as RuntimeEvent["type"]);
        if (pace > 0) await sleep(pace);
      }

      if (runError) {
        const ep = errorPayload(runError).error;
        sendSSE(res, {
          type: "run:error",
          payload: { type: "run:error", runId: "n/a", step: null, error: ep.message, code: ep.code },
        });
        await sleep(300);
      }
      sendSSE(res, {
        type: "done",
        payload: {
          ok: !runError,
          sessionId: outcome?.session.id ?? "",
          taskId: outcome?.task.id,
          runId: outcome?.run.id,
          steps: outcome?.run.steps ?? 0,
          output: outcome?.run.output ?? "",
          usage: outcome?.run.usage,
          error: runError ? errorPayload(runError).error.message : null,
        },
      });
      res.end();
      return;
    }

    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`retry: 1000\n\n`);
      sendSSE(res, { type: "system", payload: { message: "events-ready", provider: provider.id } });
      // M3 governance events surfaced to the (long-lived) console UI.
      const GOV = new Set<RuntimeEvent["type"]>([
        "permission:request",
        "permission:approved",
        "permission:denied",
        "sandbox:write",
      ]);
      const unsub = runtime.subscribe((e: RuntimeEvent) => {
        if (GOV.has(e.type)) sendSSE(res, { type: e.type, payload: e });
      });
      req.on("close", () => unsub());
      return;
    }

    if (url.pathname === "/api/approve" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const { decisionId, always } = JSON.parse(body || "{}");
        const ok = manager.approve(String(decisionId ?? ""), { always: Boolean(always) });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      }
      return;
    }

    if (url.pathname === "/api/deny" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const { decisionId, reason } = JSON.parse(body || "{}");
        const ok = manager.deny(String(decisionId ?? ""), reason ? String(reason) : undefined);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      }
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const list = await manager.listSessions();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          list.map((s) => ({ id: s.id, title: s.title, status: s.status, updatedAt: s.updatedAt })),
        ),
      );
      return;
    }
    if (url.pathname === "/api/new" && req.method === "POST") {
      const s = await manager.createSession({ agentId: agent.name, title: "web console" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: s.id }));
      return;
    }
    if (url.pathname === "/api/artifacts" && req.method === "GET") {
      const session = url.searchParams.get("session");
      if (!session) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "session 必填" }));
        return;
      }
      const list = await manager.artifacts.list(session);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }
    const artMatch = url.pathname.match(/^\/api\/artifact\/([^/]+)$/);
    if (artMatch && req.method === "GET") {
      const a = await manager.artifacts.get(artMatch[1]!);
      if (!a) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no such artifact" }));
        return;
      }
      if (a.kind === "url") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ kind: "url", name: a.name, locator: a.locator, mime: a.mime }));
        return;
      }
      const text = await manager.artifacts.readText(a.id);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ kind: a.kind, name: a.name, mime: a.mime, text: text ?? "" }));
      return;
    }
    if (url.pathname === "/api/checkpoints" && req.method === "GET") {
      const task = url.searchParams.get("task");
      const list = task ? await manager.listCheckpoints(task) : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(list.map((c) => ({ id: c.id, step: c.step }))));
      return;
    }
    if (url.pathname === "/api/resume" && req.method === "POST") {
      let parsed: { checkpointId?: string; continuation?: string };
      try {
        const body = await readBody(req);
        parsed = JSON.parse(body || "{}");
      } catch {
        parsed = {};
      }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`retry: 1000\n\n`);
      sendSSE(res, { type: "system", payload: { message: "connected", provider: provider.id } });
      await sleep(provider.id === "mock" ? 350 : 120);
      const buf: Array<{ type: string; payload: unknown }> = [];
      const unsub = runtime.subscribe((e: RuntimeEvent) => {
        if (UI_EVENTS.has(e.type)) buf.push({ type: e.type, payload: e });
      });
      let runError: string | null = null;
      let outcome: Awaited<ReturnType<SessionManager["resume"]>> | undefined;
      try {
        outcome = await manager.resume(
          String(parsed.checkpointId ?? ""),
          parsed.continuation ? String(parsed.continuation) : undefined,
        );
      } catch (err) {
        runError = err instanceof Error ? err.message : String(err);
      } finally {
        unsub();
      }
      for (const entry of buf) {
        if (res.closed || res.destroyed) return;
        if (entry.type === "step:start") sendSSE(res, { type: "clear", payload: {} });
        sendSSE(res, entry);
        await sleep(pacing(entry.type as RuntimeEvent["type"]));
      }
      if (runError) {
        const ep = errorPayload(runError).error;
        sendSSE(res, {
          type: "run:error",
          payload: { type: "run:error", runId: "n/a", step: null, error: ep.message, code: ep.code },
        });
        await sleep(300);
      }
      sendSSE(res, {
        type: "done",
        payload: {
          ok: !runError,
          sessionId: outcome?.session.id ?? "",
          taskId: outcome?.task.id,
          runId: outcome?.run.id,
          steps: outcome?.run.steps ?? 0,
          output: outcome?.run.output ?? "",
          usage: outcome?.run.usage,
          error: runError ? errorPayload(runError).error.message : null,
        },
      });
      res.end();
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error(err instanceof Error ? err : String(err));
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify(errorPayload(err)));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Runtime console  ->  http://${HOST}:${PORT}`);
  console.log(`Provider                ->  ${provider.label}`);
  console.log(`Session storage         ->  ${DATA_DIR} (M1: sessions persist across restarts)`);
  console.log(
    `Security (P3.5)         ->  ${API_TOKEN ? `Bearer 鉴权（AGENT_API_TOKEN=${API_TOKEN.slice(0, 4)}…）` : "loopback-only · 无凭据放行（本机便利，可设 AGENT_API_TOKEN 收紧）"}`,
  );
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
