/**
 * 审计主线 —— 审批留痕 + 导出 + traceId。
 *
 *   npx tsx examples/cookbook/audit.ts
 *
 * 治理要能「事后说得清」，靠两条：
 *   - **审批留痕**：每次授权决策落 `ApprovalRecord`（含决策人、时间、参数
 *     **指纹** —— 注意是 fingerprint 而非原始参数，审计轨迹不能变成第二份
 *     敏感数据，P3.2/P3.3）；
 *   - **traceId 贯穿**：一次 run 的所有事件共享同一个 traceId，可以拿去和
 *     外部链路追踪对上。
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Agent, AgentRuntime, FileStorage, defineTool } from "@node-agent-runtime/core";
import { SessionManager, serializeAudit } from "@node-agent-runtime/host";
import { createProductionDefaults } from "@node-agent-runtime/policy";

import { ScriptedProvider, reply, toolCall } from "./scripted-provider.js";

const root = mkdtempSync(join(tmpdir(), "cookbook-audit-"));
const workspace = join(root, "workspace");
mkdirSync(workspace, { recursive: true });

const writeNote = defineTool({
  name: "write_note",
  description: "Write a note into the workspace.",
  meta: { kind: "write", pathArgs: ["path"] },
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(args: { path: string; content: string }) {
    // 示例不真落盘：审计关心的是「谁批准了什么」。
    return { ok: true, path: resolve(workspace, args.path) };
  },
});

const runtime = new AgentRuntime({
  provider: new ScriptedProvider([
    toolCall("write_note", { path: "notes/a.txt", content: "hello", token: "sk-should-not-leak" }),
    reply("已写入。"),
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

/** traceId 从事件里取：一次 run 的所有事件共享同一个。 */
let traceId: string | undefined;
runtime.subscribe((event) => {
  if (event.traceId) traceId ??= event.traceId;
});

runtime.events.on("permission:request", (event) => {
  console.log(`⚠ 授权请求：${event.toolName} — ${event.reason}`);
  // 同步批准即可 —— PermissionManager 的 waiter 在事件发出前就已登记。
  void manager.approve(event.decisionId);
});
runtime.events.on("tool:end", (event) => {
  console.log(`   tool:end ${event.toolCall.name} ok=${event.ok}`);
});

const session = await manager.createSession({ agentId: "assistant" });
await manager.chat(session.id, "写一条笔记");

const records = await manager.approvals({ sessionId: session.id });
console.log(`\n① 审批记录：${records.length} 条`);
console.log(`   traceId=${traceId ?? "(无)"}`);

console.log("\n② CSV 导出（可直接进表格）：");
console.log(serializeAudit(records, { format: "csv" }));

console.log("③ JSON 导出（进 SIEM / 数仓）：");
console.log(serializeAudit(records, { format: "json" }).slice(0, 600));

console.log(`\n注意：参数列只有**指纹**（argumentsFingerprint），原始参数不进审计 —— 审计轨迹不能变成第二份敏感数据。`);
