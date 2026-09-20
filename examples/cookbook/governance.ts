/**
 * 治理主线 —— 审批 + 三档执行模式。
 *
 *   npx tsx examples/cookbook/governance.ts
 *
 * 三段对照，看完就知道「治理」在这个运行时里到底指什么：
 *   1. **工作区可写**：写工具先要一次授权 —— 批准了才执行
 *   2. **越界写入**：路径不在沙箱域内，工具自己拒绝（生产环境由沙箱 scope 保证）
 *   3. **只读模式**：策略**直接判定拒绝**，连审批都不再弹 —— 模式改变的是策略，不是 UI
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Agent, AgentRuntime, FileStorage, defineTool } from "@node-agent-runtime/core";
import { SessionManager } from "@node-agent-runtime/host";
import { createProductionDefaults } from "@node-agent-runtime/policy";

import { ScriptedProvider, reply, toolCall } from "./scripted-provider.js";

const root = mkdtempSync(join(tmpdir(), "cookbook-governance-"));
const workspace = join(root, "workspace");
mkdirSync(workspace, { recursive: true });

const writeNote = defineTool({
  name: "write_note",
  description: "Write a note into the workspace.",
  meta: { kind: "write", pathArgs: ["path"] },
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的路径" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute(args: { path: string; content: string }) {
    const full = resolve(workspace, args.path);
    // 生产环境这道拦截由沙箱 scope 承担（见下面的 createProductionDefaults）；
    // 示例为了自包含，在工具里做同样的校验。
    if (!full.startsWith(workspace)) {
      throw new Error(`越界写入被拒绝：${args.path} 不在工作区内`);
    }
    mkdirSync(dirname(full), { recursive: true });
    await writeFile(full, args.content, "utf8");
    return { ok: true, path: full };
  },
});

const runtime = new AgentRuntime({
  provider: new ScriptedProvider([
    toolCall("write_note", { path: "notes/a.txt", content: "hello" }),
    reply("已写入 notes/a.txt。"),
    toolCall("write_note", { path: "../outside.txt", content: "越界" }),
    reply("越界写入失败了。"),
    toolCall("write_note", { path: "notes/b.txt", content: "只读下不应写入" }),
    reply("只读模式下没有写入。"),
  ]),
});

const prod = createProductionDefaults(workspace);
const manager = new SessionManager({
  runtime,
  storage: new FileStorage(join(root, ".runtime-data")),
  agents: [
    new Agent({
      name: "assistant",
      instructions: "需要写文件就调用 write_note。",
      tools: [writeNote],
    }),
  ],
  sandboxMode: prod.sandboxMode,
  scope: prod.scope,
  policy: prod.policy,
});

/** 审批次数 —— 只读模式那一段必须**不增加**它。 */
let asked = 0;
runtime.events.on("permission:request", (event) => {
  asked++;
  console.log(`⚠ 授权请求 #${asked}：${event.toolName} — ${event.reason}`);
  void manager.approve(event.decisionId);
});

const session = await manager.createSession({ agentId: "assistant" });

console.log("① 工作区可写：写工具先要授权");
await manager.chat(session.id, "把 hello 写进 notes/a.txt");
console.log(`   授权次数=${asked}（期望 1）\n`);

console.log("② 越界写入：路径不在工作区内");
await manager.chat(session.id, "把越界内容写进 ../outside.txt");
console.log(`   授权次数=${asked}（越界由工具/沙箱拦下，不是审批拦的）\n`);

console.log("③ 切到 read-only：策略直接拒绝，不再弹审批");
manager.setSandboxMode("read-only");
await manager.chat(session.id, "再写一次 notes/b.txt");
console.log(`   授权次数=${asked}（期望仍是 2：只读下根本不问）`);
console.log(`\n工作区：${workspace}`);
