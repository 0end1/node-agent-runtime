#!/usr/bin/env tsx
/**
 * Interactive CLI demo of the Agent runtime (M1: Session-managed).
 *
 *   npm run demo:cli                    # mock provider (no API key)
 *   OPENAI_API_KEY=sk-xxx npm run demo:cli   # real OpenAI-compatible provider
 *
 * Conversations live in a SessionManager backed by FileStorage, so quitting
 * and re-running resumes the most recent session with full context.
 *
 * Commands:
 *   /new            start a brand-new session
 *   /list           list persisted sessions
 *   /use <id>       switch to an existing session
 *   exit / Ctrl+C   quit
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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

const argv = process.argv.slice(2);
const wantsOpenAI = argv.includes("--provider=openai") || argv.includes("--openai");

function pickProvider(): ModelProvider {
  if (wantsOpenAI || process.env.OPENAI_API_KEY) {
    return new OpenAIClientProvider();
  }
  return new MockProvider();
}

function describeEvent(e: RuntimeEvent): string {
  switch (e.type) {
    case "step:start":
      return `\n  \x1b[36m▶ 步骤 ${e.step}\x1b[0m`;
    case "model:response": {
      if (e.message.toolCalls?.length) {
        return `    \x1b[2m模型决策：调用 ${e.message.toolCalls.map((t) => t.name).join(", ")}\x1b[0m`;
      }
      return "";
    }
    case "tool:start": {
      const args = JSON.stringify(e.toolCall.arguments);
      return `    \x1b[33m⚙ ${e.toolCall.name}(${args.length > 90 ? args.slice(0, 90) + "…" : args})\x1b[0m`;
    }
    case "tool:end": {
      const state = e.ok ? "\x1b[32m✓" : "\x1b[31m✗";
      const result = e.result.length > 140 ? e.result.slice(0, 140) + "…" : e.result;
      return `      ${state}\x1b[0m (${e.durationMs}ms) ${result}`;
    }
    default:
      return "";
  }
}

async function main() {
  const provider = pickProvider();
  const runtime = new AgentRuntime({
    provider,
    logger: (line) => process.env.AGENT_DEBUG ? console.log(`\x1b[90m[debug] ${line}\x1b[0m`) : undefined,
  });
  const agent = new Agent({
    name: "assistant",
    instructions:
      "你是 Agent 运行时演示助手。需要精确计算/查询时先调用工具，再基于工具结果用简洁中文作答，不要编造数据。",
    tools: builtinTools,
  });

  const DATA_DIR = process.env.RUNTIME_DATA ?? ".runtime-data";
  const manager = new SessionManager({
    runtime,
    storage: new FileStorage(DATA_DIR),
    agents: [agent],
  });
  const rl = readline.createInterface({ input, output });

  // Resume the most recent open session if one exists.
  let current: Session | undefined = (await manager.listSessions())
    .filter((s) => s.status !== "closed")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  async function startNewSession(): Promise<void> {
    current = await manager.createSession({ agentId: agent.name });
    console.log(`\n\x1b[36m新会话已创建：${current.id}\x1b[0m`);
  }

  async function useSession(id: string): Promise<void> {
    const s = await manager.getSession(id);
    if (!s) {
      console.log(`\x1b[31m没有找到会话 ${id}（试试 /list）\x1b[0m`);
      return;
    }
    if (s.status === "closed") {
      console.log(`\x1b[31m会话 ${id} 已关闭，无法继续\x1b[0m`);
      return;
    }
    current = s;
    const history = await manager.messages(s.id);
    console.log(`\x1b[36m已切换到会话 ${s.id}（历史 ${history.length} 条消息）\x1b[0m`);
  }

  if (!current) {
    await startNewSession();
  }
  console.log(
    `\x1b[1mAgent Runtime · CLI demo (Session 化 · M1)\x1b[0m\n` +
    `Provider : \x1b[36m${provider.label}\x1b[0m\n` +
    `Storage  : \x1b[36m${DATA_DIR}/\x1b[0m\n` +
    `Session  : \x1b[36m${current!.id}\x1b[0m${current!.title ? ` · “${current!.title}”` : ""}\n` +
    `试试     : 3.5 + 2 * 4 = ?  /  现在几点了？  /  北京天气怎么样  /  100 美元等于多少人民币\n` +
    `命令     : /new   /list   /use <id>   exit\n`
  );

  for (;;) {
    let input: string;
    try {
      input = (await rl.question(`\x1b[1m你 [${current!.id.slice(-6)}]\x1b[0m > `)).trim();
    } catch {
      break; // stdin closed (e.g. piped input reached EOF)
    }
    if (!input) continue;
    if (/^(exit|quit|q)$/i.test(input)) break;
    if (input === "/new") {
      await startNewSession();
      continue;
    }
    if (input === "/list") {
      const sessions = await manager.listSessions();
      if (!sessions.length) {
        console.log("（暂无会话）");
        continue;
      }
      for (const s of sessions) {
        const msgs = (await manager.messages(s.id)).length;
        const mark = s.id === current?.id ? "  \x1b[36m← 当前\x1b[0m" : "";
        console.log(
          `  ${s.id}  \x1b[2m${s.title || "(无标题)"} · ${s.status} · ${msgs} msgs\x1b[0m${mark}`
        );
      }
      continue;
    }
    const useMatch = input.match(/^\/use\s+(\S+)$/);
    if (useMatch) {
      await useSession(useMatch[1]!);
      continue;
    }
    if (input.startsWith("/")) {
      console.log("未知命令。可用：/new  /list  /use <id>  exit");
      continue;
    }

    if (!current) await startNewSession();
    const unsubscribe = runtime.subscribe((e) => {
      const line = describeEvent(e);
      if (line) console.log(line);
    });

    try {
      const outcome = await manager.chat(current!.id, input);
      console.log(`\n\x1b[1m助手\x1b[0m > ${outcome.run.output}`);
      console.log(
        `\x1b[90m(task=${outcome.task.id.slice(-6)} · run=${outcome.run.id.slice(-6)} · round-trips=${outcome.run.usage.modelCalls} · input=${outcome.run.usage.inputTokens} · output=${outcome.run.usage.outputTokens})\x1b[0m`
      );
    } catch (err) {
      console.error(`\x1b[31m出错：\x1b[0m${err instanceof Error ? err.message : err}`);
    } finally {
      unsubscribe();
    }
  }

  rl.close();
  console.log("bye");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
