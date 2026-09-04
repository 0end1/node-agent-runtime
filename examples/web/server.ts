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
  MockProvider,
  OpenAIClientProvider,
  builtinTools,
  type ChatMessage,
  type ModelProvider,
  type RuntimeEvent,
} from "../../src/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const argv = process.argv.slice(2);

const HTML_PATH = join(__dirname, "public", "index.html");
const sessions = new Map<string, ChatMessage[]>();

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
      const unsubscribe = runtime.subscribe((e: RuntimeEvent) =>
        buf.push({ type: e.type, payload: e })
      );

      let history = sessions.get(sessionId) ?? [];
      let runError: string | null = null;
      let result:
        | Awaited<ReturnType<AgentRuntime["run"]>>
        | undefined;

      try {
        result = await runtime.run({
          agent,
          input,
          history,
          conversationId: sessionId,
        });
        // persist full transcript for multi-turn continuity
        sessions.set(sessionId, result.messages);
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
          steps: result?.steps ?? 0,
          output: result?.output ?? "",
          usage: result?.usage,
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
  console.log(`Sessions in-memory, use query 'session' to create new ones.`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
