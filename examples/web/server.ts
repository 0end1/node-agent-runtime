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
import { createServer, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Agent,
  AgentRuntime,
  FileStorage,
  defineTool,
  type ModelProvider,
  type RuntimeEvent,
} from "@agent-runtime/core";
import { SessionManager, type Session } from "@agent-runtime/host";
import { MockProvider } from "@agent-runtime/mock";
import { builtinTools } from "@agent-runtime/tools-basic";
import { OpenAIClientProvider } from "@agent-runtime/provider-openai";
import { SQLiteStorage } from "@agent-runtime/store-sqlite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const argv = process.argv.slice(2);

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
  if (argv.includes("--provider=openai") || process.env.OPENAI_API_KEY) {
    return new OpenAIClientProvider();
  }
  return new MockProvider();
}

const provider = pickProvider();

// 延迟引用：demo 写文件工具需把落盘结果登记为 artifact，但会话上下文在
// 运行时（请求级）才确定，故用模块级变量记录当前活跃 session。
let activeSession = "default";
const runtime = new AgentRuntime({
  provider,
  logger: (line) => console.log(line),
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
const manager = new SessionManager({
  runtime,
  storage,
  agents: [agent],
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

      let runError: string | null = null;
      let outcome: Awaited<ReturnType<SessionManager["chat"]>> | undefined;

      try {
        const session = await getOrCreateSession(sessionId);
        outcome = await manager.chat(session.id, input);
      } catch (err) {
        runError = err instanceof Error ? err.message : String(err);
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
        sendSSE(res, {
          type: "run:error",
          payload: { type: "run:error", runId: "n/a", step: null, error: runError },
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
          error: runError,
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
      let body = "";
      for await (const chunk of req) body += chunk.toString("utf8");
      try {
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
      let body = "";
      for await (const chunk of req) body += chunk.toString("utf8");
      try {
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
      let body = "";
      for await (const chunk of req) body += chunk.toString("utf8");
      let parsed: { checkpointId?: string; continuation?: string };
      try {
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
        sendSSE(res, {
          type: "run:error",
          payload: { type: "run:error", runId: "n/a", step: null, error: runError },
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
          error: runError,
        },
      });
      res.end();
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Runtime console  ->  http://${HOST}:${PORT}`);
  console.log(`Provider                ->  ${provider.label}`);
  console.log(`Session storage         ->  ${DATA_DIR} (M1: sessions persist across restarts)`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
