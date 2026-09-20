/**
 * 受治理的 ACP agent 子进程 —— 供 `scripts/e2e/acp.mjs` 驱动。
 *
 * 与 `stdio-agent.ts`（只验证传输帧）不同，这个 fixture 带一个 **write 类
 * 工具**：默认策略在 `workspace-write` 下对写工具判 `ask`，于是真实链路上
 * 会出现 `session/request_permission` 往返；切到 `read-only` 后同一工具被
 * 策略**直接拒绝**。E2E 用这一对行为证明「模式真的改变策略，而不只是改
 * UI」，这是内存传输的单测覆盖不到、只有真进程才敢下结论的部分。
 */
import {
  Agent,
  defineTool,
  type ModelProvider,
  type ModelResponse,
} from "@node-agent-runtime/core";
import { AcpAgent } from "../../src/agent.js";

/** 写工具（测试替身：不落盘 —— 关心的是「谁被问」，不是 IO）。 */
const writeFile = defineTool({
  name: "write_file",
  description: "Write a file (test double: never touches the disk).",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, apiKey: { type: "string" } },
    required: ["path"],
  },
  async execute(args: { path: string }) {
    return `written ${args.path}`;
  },
});

/**
 * 交替返回「要写文件」与「结束」，使每个会话的第一轮都能触发一次审批。
 *
 * `chat()` 前的停顿模拟真实模型延迟，也给 `session/cancel` 留出可插入的
 * 窗口 —— 取消只有在请求飞行途中才有意义。
 */
class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly label = "Scripted";
  private calls = 0;

  async chat(): Promise<ModelResponse> {
    const nth = this.calls++;
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (nth % 2 === 0) {
      return {
        content: "",
        toolCalls: [
          {
            id: `call_${nth}`,
            name: "write_file",
            arguments: JSON.stringify({ path: "e2e.txt", apiKey: "sk-e2e-secret" }),
          },
        ],
        finishReason: "tool_calls",
      };
    }
    return { content: "done", toolCalls: [], finishReason: "stop" };
  }
}

void new AcpAgent({
  provider: new ScriptedProvider(),
  agents: [
    new Agent({
      name: "assistant",
      instructions: "需要写文件就调用 write_file，然后用一句话总结。",
      tools: [writeFile],
    }),
  ],
  defaultAgentId: "assistant",
  // 诊断走 stderr：stdout 只允许出现 ACP 消息。
  logger: (line) => process.stderr.write(`${line}\n`),
}).start();
