// ---- C3 memory & artifact (M2 / M4) ----
// M6 拆包批次 B3：`memory.ts` + `artifact.ts` 外置为独立包。
// 依赖单向：memory → types（Storage / Artifact 契约已下沉 C1）；core → memory。

// 一包一职责：memory 只承载会话记忆（M6 P1 审查 P1），产物已迁至 `@agent-runtime/artifact`。
export { SessionMemory } from "./memory.js";
export type { Memory, MemoryFact, MemoryRecall, SessionMemoryOptions } from "./memory.js";
