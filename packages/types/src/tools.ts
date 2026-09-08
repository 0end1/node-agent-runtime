import type { JsonSchema } from "./schema.js";

/**
 * Tool contracts (C4 决策触发：M6 拆 C4/C5 时若工具契约留在 core，
 * sandbox/policy 包将反向依赖 core 形成包级循环，故下沉 C1；
 * 实现 `defineTool` / `findDuplicateToolNames` 仍留在 core)。
 */

/** Extra context handed to a tool when it executes. */
export interface ToolExecutionContext {
  /** Conversation this run belongs to. */
  conversationId: string;
  /** Id of the current run. */
  runId: string;
  /** Hosting session id (M1; populated when run through a SessionManager). */
  sessionId?: string;
  /** Hosting task id (M1; populated when run through a SessionManager). */
  taskId?: string;
  now(): Date;
}

/**
 * Sensitivity class of a tool (M3, docs §6.1). Drives the default
 * allow/ask/deny matrix; tools may declare it explicitly, otherwise the
 * runtime infers it from the tool name.
 */
export type ToolKind =
  /** Pure computation / clock: no side effects. */
  | "harmless"
  /** Outbound read-only network (weather, search…). */
  | "network-read"
  /** Mutates the workspace (write/edit/delete files). */
  | "write"
  /** Runs a command or spawns a process. */
  | "exec"
  /** Touches credentials / secrets — never allowed by default. */
  | "credential";

/** Optional governance metadata a tool can declare about itself. */
export interface ToolMeta {
  kind?: ToolKind;
  /** Argument fields that carry a filesystem path (checked against the sandbox scope). */
  pathArgs?: string[];
}

/**
 * A tool is a named, documented function a model can call.
 * `parameters` is a JSON Schema used both for the model prompt and local validation.
 */
export interface ToolDefinition<Args extends Record<string, unknown> = Record<string, unknown>, Result = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  /** M3: governance hints (sensitivity class, path-bearing arguments). */
  meta?: ToolMeta;
  execute(args: Args, ctx: ToolExecutionContext): Result | Promise<Result>;
}

export type AnyTool = ToolDefinition<any, any>;

/**
 * Infer a tool's sensitivity class from its name (tools may declare it).
 *
 * 下沉说明（M6 P1 审查 P1）：分类属**工具元数据推断**，与沙箱执行域无关；
 * 原先放在 sandbox 包导致 mcp 为取分类而依赖 sandbox。下沉后 mcp 只依赖 C1。
 */
const HARMLESS = new Set(["calculator", "now", "math", "time"]);

export function classifyToolName(name: string): ToolKind {
  const n = name.toLowerCase();
  if (/(token|secret|credential|apikey|api_key|password|_env$)/.test(n)) return "credential";
  if (/(exec|shell|bash|command|terminal|spawn|subprocess|run_)/.test(n)) return "exec";
  if (/(write|edit|create|delete|remove|patch|append|save|move|mkdir|truncate)/.test(n)) return "write";
  // Built-in demos (weather / geocode / exchange) read local static data —
  // they are harmless, not outbound network.
  if (/(fetch|http|request|search|web|download|api)/.test(n)) return "network-read";
  if (HARMLESS.has(n)) return "harmless";
  return "harmless";
}

/** A tool's effective class: declared `meta.kind` wins, else inferred from name. */
export function toolKind(tool: AnyTool): ToolKind {
  return tool.meta?.kind ?? classifyToolName(tool.name);
}
