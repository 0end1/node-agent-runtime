// ---- C3 memory & artifact (M2 / M4) ----
// M6 拆包批次 B3：`memory.ts` + `artifact.ts` 外置为独立包。
// 依赖单向：memory → types（Storage / Artifact 契约已下沉 C1）；core → memory。

// 一包一职责：memory 只承载会话记忆（M6 P1 审查 P1），产物已迁至 `@node-agent-runtime/artifact`。
export { SessionMemory } from "./memory.js";
export type { Memory, MemoryFact, MemoryRecall, SessionMemoryOptions } from "./memory.js";

// Checkpoint（M2 步级快照 + 续跑校验）：随 C3 归位（M6 P1 审查 P2）。
// 已解耦 `Agent` 类（改为结构化 `ToolSurface`），故本包仍只依赖 types。
export {
  CheckpointStore,
  CheckpointMismatchError,
  computeToolsHash,
  computeInstructionsHash,
  assertResumable,
} from "./checkpoint.js";
export type {
  Checkpoint,
  AssertResumableOptions,
  AgentSnapshot,
  CheckpointSeed,
  CheckpointStoreOptions,
  ToolSurface,
} from "./checkpoint.js";

// M7-1: 确定性、零依赖的上下文压缩（引擎在 step 循环内调用）。
export {
  compactMessages,
  countMessagesTokens,
  estimateTokens,
} from "./compact.js";
export type { ContextBudget, CompactResult } from "./compact.js";
