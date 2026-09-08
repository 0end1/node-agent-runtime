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

// ---- Sessions, tasks (M1) ----
// 已外置为 C8 `@agent-runtime/host`（M6 拆包）：依赖方向为 host → core，core 不能
// 反向 re-export（会成环），请改从新包导入：
//   import { SessionManager } from "@agent-runtime/host";

// ---- Checkpoint (M2) ----
// 已随 C3 归位到 `@agent-runtime/memory`（M6 P1 审查 P2：解耦 `Agent` 类后不再依赖引擎）；
// 经 facade `export * from "@agent-runtime/memory"` 转发，从 core 导入仍然可用。

// ---- Facade re-exports (M6 批次 B4) ----
// core 收窄为聚合出口：以下能力已外置为独立包，此处统一 re-export；宿主既可
// 从 `@agent-runtime/core` 单点导入（兼容面不变），也可按需直连子包（推荐新代码）。
//   · C3 @agent-runtime/memory   —— SessionMemory / Checkpoint（ToolSurface 契约）
//   ·    @agent-runtime/artifact —— ArtifactManager（自 memory 拆出，M6 P1 审查 P1）
//   · C4 @agent-runtime/sandbox  —— LocalSandbox / classifyToolName / isPathAllowed
//   · C5 @agent-runtime/policy   —— PermissionManager / DefaultPermissionPolicy
// 注：C6 mcp 不在此 re-export —— 其依赖方向为 mcp → core，core 反向引用会形成
// 循环，请直接 `import { McpRegistry } from "@agent-runtime/mcp"`。
export * from "@agent-runtime/memory";
export * from "@agent-runtime/artifact";
export * from "@agent-runtime/sandbox";
export * from "@agent-runtime/policy";

export { MemoryStorage } from "./store/memory.js";
export { FileStorage } from "./store/file.js";
// Storage / DocDomain / StreamDomain 契约已下沉 C1（M6 拆包前置），
// 经顶部 `export * from "@agent-runtime/types"` 转发，公共导入面不变。

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

// 内置基础工具集已外置（M6 P1 审查 P0）：
//   import { builtinTools, evaluate, CURRENCY_ALIASES } from "@agent-runtime/tools-basic";

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
// docs/crate-architecture.md §5.6）；MockProvider 作为演示/测试桩亦已外置（M6 P1 审查 P0）：
//   import { MockProvider } from "@agent-runtime/mock";
