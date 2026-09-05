import type { ToolExecutionContext } from "./tool.js";

/**
 * Context facade (docs/architecture.md §3.1 / §10 `context.ts`).
 *
 * A `RunContext` is the capability surface a run exposes to tools and (later)
 * permission/sandbox hooks. The runtime injects one per run; nothing reaches
 * out to global state.
 */
export interface RunContext extends ToolExecutionContext {
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly conversationId: string;
  readonly runId: string;
}

export interface RunContextSeed {
  conversationId: string;
  runId: string;
  sessionId?: string;
  taskId?: string;
  now?: () => Date;
}

/** Build the context object handed to tools during a run. */
export function buildRunContext(seed: RunContextSeed): ToolExecutionContext {
  return {
    conversationId: seed.conversationId,
    runId: seed.runId,
    ...(seed.sessionId ? { sessionId: seed.sessionId } : {}),
    ...(seed.taskId ? { taskId: seed.taskId } : {}),
    now: seed.now ?? (() => new Date()),
  };
}
