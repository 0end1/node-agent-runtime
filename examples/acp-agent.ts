/**
 * ACP agent 入口 —— **真机联调用**（Zed / DeepChat / 任一 ACP Client）。
 *
 *   OPENAI_API_KEY=sk-... npm run demo:acp
 *
 * Client 会以子进程方式启动本脚本，并通过 stdio 说 ACP：
 *
 *   initialize → session/new → session/prompt → session/update … → session/close
 *
 * 两点纪律（写死在包里，入口不再重复保证）：
 *  - **stdout 只允许 ACP 消息**，诊断一律走 stderr —— 因此终端里看到的日志
 *    不会污染协议流；
 *  - 审批通过 `session/request_permission` 回到 Client：Client 不实现该
 *    方法时降级为拒绝，而不是空等到审批超时。
 *
 * 未设 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 时退回 `MockProvider`（规则式、
 * 不联网）—— 足以验证协议链路（握手 / 工具呈现 / 取消），只是回答没有智能。
 * 文件系统与终端由 Client 侧提供（ACP 的通常分工），故这里只挂只读类内置
 * 工具；工作区写入由 `session/set_config_option` 的执行模式与沙箱共同约束。
 */
import { Agent } from "@node-agent-runtime/core";
import { AcpAgent } from "@node-agent-runtime/acp";
import { MockProvider } from "@node-agent-runtime/mock";
import { OpenAIClientProvider } from "@node-agent-runtime/provider-openai";
import { builtinTools } from "@node-agent-runtime/tools-basic";

const hasRealModel = Boolean(process.env.OPENAI_API_KEY ?? process.env.OPENAI_BASE_URL);

if (!hasRealModel) {
  process.stderr.write(
    "[acp] 未检测到 OPENAI_API_KEY / OPENAI_BASE_URL，使用 MockProvider（规则式、不联网）\n",
  );
}

void new AcpAgent({
  provider: hasRealModel ? new OpenAIClientProvider() : new MockProvider(),
  agents: [
    new Agent({
      name: "assistant",
      instructions: "你是 ACP 形态下的助手。需要精确计算或查询时先调用工具，再简洁作答。",
      tools: [...builtinTools],
    }),
  ],
  defaultAgentId: "assistant",
  // 默认「工作区可写」；Client 可用 session/set_config_option（或旧面
  // session/set_mode）在会话中切换，自下一次对话生效。
  sandboxMode: "workspace-write",
}).start();
