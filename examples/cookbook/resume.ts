/**
 * 续跑主线 —— checkpoint + resume。
 *
 *   npx tsx examples/cookbook/resume.ts
 *
 * 长任务真正的成本不在「跑」，而在**断了能接上**：每完成一步就落一个
 * checkpoint（消息 + 用量 + 工具指纹），重启后从快照续跑，输出与一次性跑完
 * 等价。示例把这条链跑一遍：跑一轮 → 列出 checkpoint → 从快照续跑。
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent, AgentRuntime, FileStorage, defineTool } from "@node-agent-runtime/core";
import { SessionManager } from "@node-agent-runtime/host";
import { createProductionDefaults } from "@node-agent-runtime/policy";

import { ScriptedProvider, reply, toolCall } from "./scripted-provider.js";

const root = mkdtempSync(join(tmpdir(), "cookbook-resume-"));
const workspace = join(root, "workspace");
mkdirSync(workspace, { recursive: true });

/** 一个不落盘的纯计算工具：续跑关心的是状态，不是 IO。 */
const add = defineTool({
  name: "add",
  description: "Add two numbers.",
  meta: { kind: "harmless" },
  parameters: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  async execute(args: { a: number; b: number }) {
    return { sum: args.a + args.b };
  },
});

const prod = createProductionDefaults(workspace);
const manager = new SessionManager({
  runtime: new AgentRuntime({
    provider: new ScriptedProvider([
      toolCall("add", { a: 2, b: 3 }),
      reply("第一步：和为 5。"),
      reply("续跑：接着上一步，结果是 5。"),
    ]),
  }),
  storage: new FileStorage(join(root, ".runtime-data")),
  agents: [
    new Agent({
      name: "assistant",
      instructions: "需要计算就调用 add。",
      tools: [add],
    }),
  ],
  sandboxMode: prod.sandboxMode,
  scope: prod.scope,
  policy: prod.policy,
});

const session = await manager.createSession({ agentId: "assistant" });

console.log("① 跑一轮（中途会落 checkpoint）");
const first = await manager.chat(session.id, "2 + 3 等于多少");
console.log(`   task=${first.task.id} run=${first.run.id}`);

const checkpoints = await manager.listCheckpoints(first.task.id);
console.log(`\n② 该 task 的 checkpoint：${checkpoints.length} 个`);
for (const ckpt of checkpoints) {
  console.log(`   ${ckpt.id}  step=${ckpt.step}  toolsHash=${ckpt.agentSnapshot.toolsHash}`);
}
if (checkpoints.length === 0) {
  console.log("   （无 checkpoint —— 检查是否为单步即结束的轮次）");
  process.exit(0);
}

const latest = checkpoints[checkpoints.length - 1]!;
console.log(`\n③ 从 ${latest.id} 续跑`);
const resumed = await manager.resume(latest.id, "继续");
console.log(`   run=${resumed.run.id}`);
const messages = await manager.messages(session.id);
const last = [...messages].reverse().find((message) => message.role === "assistant");
console.log(`   最后一条助手消息：${last?.content ?? "(无)"}`);
console.log(`\n落盘目录：${root}`);
