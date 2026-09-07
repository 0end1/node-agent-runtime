// 工具契约类型已下沉 C1（M6 拆 C4/C5 前置：避免 sandbox/policy 反向依赖 core），
// 实现（defineTool / findDuplicateToolNames）保留在此；core 内部
// `import ... from "./tool.js"` 无需改动，公共导入面不变。
import type { AnyTool, ToolDefinition } from "@agent-runtime/types";

export type {
  ToolDefinition,
  AnyTool,
  ToolExecutionContext,
  ToolKind,
  ToolMeta,
} from "@agent-runtime/types";

/** Create a tool from a plain definition (keeps inference for execute args). */
export function defineTool<Args extends Record<string, unknown>, Result>(
  def: ToolDefinition<Args, Result>
): ToolDefinition<Args, Result> {
  return def;
}

/** Whether two tool definitions collide by name. */
export function findDuplicateToolNames(
  tools: readonly AnyTool[]
): string[] {
  const seen = new Map<string, number>();
  for (const tool of tools) {
    seen.set(tool.name, (seen.get(tool.name) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}
