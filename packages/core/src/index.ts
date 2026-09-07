// ---- Agent runtime core ----
// 公共 API 兼容面：core 同时转发 C1 叶子包（@agent-runtime/types）的全部导出，
// 因此 `import { validate, type ChatMessage } from "@agent-runtime/core"` 仍可用。
export * from "@agent-runtime/types";
export { AgentRuntime, RunAbortedError } from "./runtime.js";
export type {
  AgentRuntimeOptions,
  RunOptions,
  RunResult,
  StepSnapshot,
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
  CheckpointSavedEvent,
  CheckpointRestoredEvent,
  PermissionRequestEvent,
  PermissionApprovedEvent,
  PermissionDeniedEvent,
  SandboxWriteEvent,
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

// ---- Memory & checkpoint (M2) ----
export {
  CheckpointStore,
  CheckpointMismatchError,
  computeToolsHash,
  assertResumable,
} from "./checkpoint.js";
export type { Checkpoint, AgentSnapshot, CheckpointSeed } from "./checkpoint.js";

// SessionMemory / Memory 实现已外置为 C3 `@agent-runtime/memory`（M6 批次 B3）：
//   import { SessionMemory } from "@agent-runtime/memory";

// ---- Governance (M3) ----
// 实现已外置为 C4 `@agent-runtime/sandbox` 与 C5 `@agent-runtime/policy`
//（M6 批次 B3，C2 决策：独立两包）：
//   import { LocalSandbox, classifyToolName, isPathAllowed } from "@agent-runtime/sandbox";
//   import { PermissionManager, DefaultPermissionPolicy } from "@agent-runtime/policy";

export { MemoryStorage } from "./store/memory.js";
export { FileStorage } from "./store/file.js";
// Storage / DocDomain / StreamDomain 契约已下沉 C1（M6 拆包前置），
// 经顶部 `export * from "@agent-runtime/types"` 转发，公共导入面不变。

// ---- Artifact (M4) ----
// 实现已外置为 C3 `@agent-runtime/memory`：
//   import { ArtifactManager, ArtifactError, MIME_BY_KIND } from "@agent-runtime/memory";
// 契约类型（Artifact / ArtifactKind / ArtifactInput）已下沉 C1，经顶部
// `export * from "@agent-runtime/types"` 转发，公共导入面不变。

export { buildRunContext } from "./context.js";
export type { RunContext, RunContextSeed } from "./context.js";

// ---- Tools ----
export { defineTool, findDuplicateToolNames } from "./tool.js";
export type {
  ToolDefinition,
  AnyTool,
  ToolExecutionContext,
  ToolKind,
  ToolMeta,
} from "./tool.js";

export { builtinTools } from "./tools/builtin.js";
export type { CurrencyCode } from "./tools/builtin.js";
export { CURRENCY_ALIASES } from "./tools/builtin.js";

export { evaluate } from "./tools/calculator.js";

// ---- MCP adapter ----
// M6 拆包批次 B1：`mcp/` 已外置为 C6 `@agent-runtime/mcp`（方向 mcp → core，
// core 不再反向依赖以避免循环）。请从新包导入：
//   import { McpRegistry, McpClient, StdioTransport } from "@agent-runtime/mcp";

// ---- Model providers ----
export type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  RawToolCall,
  FinishReason,
} from "./provider.js";
export { ModelRequestError } from "./provider.js";

// OpenAIClientProvider 已外置到 C7 @agent-runtime/provider-openai（HTTP/IO 不进 core，
// docs/crate-architecture.md §5.6）。MockProvider 是零 IO 演示/测试桩，留在 core。
export { MockProvider } from "./providers/mock.js";
