// ---- Agent runtime core ----
// 公共 API 兼容面：core 同时转发 C1 叶子包（@agent-runtime/types）的全部导出，
// 因此 `import { validate, type ChatMessage } from "@agent-runtime/core"` 仍可用。
export * from "@agent-runtime/types";
export { AgentRuntime, RunAbortedError } from "./runtime.js";
export type {
  AgentRuntimeOptions,
  RunOptions,
  RunResult,
} from "./runtime.js";

export { Agent, defineAgent, DEFAULT_AGENT_INSTRUCTIONS } from "./agent.js";
export type { AgentOptions } from "./agent.js";

// ---- Events ----
export { EventBus } from "./events.js";
export type {
  RuntimeEvent,
  RunStartEvent,
  UserMessageEvent,
  StepStartEvent,
  ModelResponseEvent,
  ToolStartEvent,
  ToolEndEvent,
  RunEndEvent,
  RunErrorEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionClosedEvent,
  TaskCreatedEvent,
  TaskStatusEvent,
} from "./events.js";

// ---- Sessions, tasks & persistence (M1) ----
export { SessionManager, SessionError } from "./session.js";
export type {
  Session,
  SessionStatus,
  Task,
  TaskStatus,
  RunRecord,
  RunStatus,
  ChatOutcome,
  SessionManagerOptions,
} from "./session.js";

export { MemoryStorage } from "./store/memory.js";
export { FileStorage } from "./store/file.js";
export type { Storage, DocDomain, StreamDomain } from "./store/types.js";

export { buildRunContext } from "./context.js";
export type { RunContext, RunContextSeed } from "./context.js";

// ---- Tools ----
export { defineTool, findDuplicateToolNames } from "./tool.js";
export type {
  ToolDefinition,
  AnyTool,
  ToolExecutionContext,
} from "./tool.js";

export { builtinTools } from "./tools/builtin.js";
export type { CurrencyCode } from "./tools/builtin.js";
export { CURRENCY_ALIASES } from "./tools/builtin.js";

export { evaluate } from "./tools/calculator.js";

// ---- Model providers ----
export type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  RawToolCall,
  FinishReason,
} from "./provider.js";
export { ModelRequestError } from "./provider.js";

export { OpenAIClientProvider } from "./providers/openai-compatible.js";
export type { OpenAIClientOptions } from "./providers/openai-compatible.js";

export { MockProvider } from "./providers/mock.js";
