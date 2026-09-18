import type { ModelProvider, ModelResponse } from "@node-agent-runtime/core";

/**
 * 一个「按脚本回话」的 provider —— 示例库共用。
 *
 * 为什么不用 `MockProvider`：它是规则式的（只认计算 / 时间 / 天气 / 汇率），
 * 不会调用写工具，于是**审批与沙箱这两条治理主链根本跑不起来**。示例要
 * 演示的正是这两条，所以这里用一个几十行的脚本化 provider 把模型行为固定
 * 下来：无 Key、无网络、可复现。真实项目把它换成 `OpenAIClientProvider`。
 */
export class ScriptedProvider implements ModelProvider {
  readonly id = "scripted";
  readonly label = "Scripted";

  #script: ModelResponse[];

  constructor(script: ModelResponse[]) {
    this.#script = [...script];
  }

  async chat(): Promise<ModelResponse> {
    const next = this.#script.shift();
    return next ?? { content: "（脚本已用尽）", toolCalls: [], finishReason: "stop" };
  }
}

/** 一次工具调用。 */
export function toolCall(name: string, args: Record<string, unknown> = {}): ModelResponse {
  return {
    content: "",
    toolCalls: [{ id: `call_${name}`, name, arguments: JSON.stringify(args) }],
    finishReason: "tool_calls",
  };
}

/** 一次收尾回复。 */
export function reply(text: string): ModelResponse {
  return { content: text, toolCalls: [], finishReason: "stop" };
}
