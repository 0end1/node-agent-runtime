import type { JsonSchema } from "@agent-runtime/types";

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
 * A tool is a named, documented function a model can call.
 * `parameters` is a JSON Schema used both for the model prompt and local validation.
 */
export interface ToolDefinition<Args extends Record<string, unknown> = Record<string, unknown>, Result = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  execute(args: Args, ctx: ToolExecutionContext): Result | Promise<Result>;
}

export type AnyTool = ToolDefinition<any, any>;

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
