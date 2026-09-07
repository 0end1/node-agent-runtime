#!/usr/bin/env tsx
/**
 * Web console demo: serves a single-page Agent console and streams every
 * runtime lifecycle event to the browser over SSE.
 *
 *   npm run demo:web                     # mock provider (no API key)
 *   OPENAI_API_KEY=sk-xxx npm run demo:web
 *   PORT=8787 npm run demo:web
 */
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Agent,
  AgentRuntime,
  FileStorage,
  MockProvider,
  SessionManager,
  builtinTools,
  type ModelProvider,
  type RuntimeEvent,
  type Session,
} from "@agent-runtime/core";
import { OpenAIClientProvider } from "@agent-runtime/provider-openai";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const argv = process.argv.slice(2);

const HTML_PATH = join(__dirname, "public", "index.html");

// ---- provider selection ----------------------------------------------------

function pickProvider(): ModelProvider {
  if (argv.includes("--provider=openai") || process.env.OPENAI_API_KEY) {
    return new OpenAIClientProvider();
  }
  return new MockProvider();
}

const provider = pickProvider();
const runtime = new AgentRuntime({
  provider,
  logger: (line) => console.log(line),
});
const agent = new Agent({
  name: "assistant",
  tools: builtinTools,
});

// Sessions are persisted to disk (M1): the browser keeps a stable session id
// in localStorage, so refreshes — and even server restarts — resume the same
// conversation with full context.
const DATA_DIR = process.env.RUNTIME_DATA ?? join(process.cwd(), ".runtime-data");
const manager = new SessionManager({
  runtime,
  storage: new FileStorage(DATA_DIR),
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
          sessionId: outcome?.session.id ?? sessionId,
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
