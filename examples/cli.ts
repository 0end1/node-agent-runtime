#!/usr/bin/env tsx
/**
 * Interactive CLI demo of the Agent runtime.
 *
 *   npm run demo:cli                    # mock provider (no API key)
 *   OPENAI_API_KEY=sk-xxx npm run demo:cli   # real OpenAI-compatible provider
 *
 * Type 'exit' or press Ctrl+C to quit.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  Agent,
  AgentRuntime,
  MockProvider,
  OpenAIClientProvider,
  builtinTools,
  type ChatMessage,
  type ModelProvider,
  type RuntimeEvent,
} from "../src/index.js";

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

  const history: ChatMessage[] = [];
  const rl = readline.createInterface({ input, output });

  console.log(
    `\x1b[1mAgent Runtime · CLI demo\x1b[0m\n` +
    `Provider : \x1b[36m${provider.label}\x1b[0m\n` +
    `Agent    : ${agent.name} (tools: ${agent.tools.map((t) => t.name).join(", ")})\n` +
    `试试     : 3.5 + 2 * 4 = ?  /  现在几点了？  /  北京天气怎么样  /  100 美元等于多少人民币\n`
  );

  for (;;) {
    let input: string;
    try {
      input = (await rl.question("\x1b[1m你\x1b[0m > ")).trim();
    } catch {
      break; // stdin closed (e.g. piped input reached EOF)
    }
    if (!input) continue;
    if (/^(exit|quit|q)$/i.test(input)) break;

    const unsubscribe = runtime.subscribe((e) => {
      const line = describeEvent(e);
      if (line) console.log(line);
    });

    try {
      const result = await runtime.run({ agent, input, history, conversationId: "cli" });
      history.push({ role: "user", content: input }, result.finalMessage);
      console.log(`\n\x1b[1m助手\x1b[0m > ${result.output}`);
      console.log(
        `\x1b[90m(round-trips=${result.usage.modelCalls} · input=${result.usage.inputTokens} · output=${result.usage.outputTokens})\x1b[0m`
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
