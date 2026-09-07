// ---- C3 memory & artifact (M2 / M4) ----
// M6 拆包批次 B3：`memory.ts` + `artifact.ts` 外置为独立包。
// 依赖单向：memory → types（Storage / Artifact 契约已下沉 C1）；core → memory。

export { SessionMemory } from "./memory.js";
export type { Memory, MemoryFact, MemoryRecall, SessionMemoryOptions } from "./memory.js";

export { ArtifactManager, ArtifactError, MIME_BY_KIND, blobKeyOf } from "./artifact.js";
export type { ArtifactManagerOptions } from "./artifact.js";

// Artifact 契约类型位于 C1，此处 re-export 便于宿主单点导入。
export type { Artifact, ArtifactKind, ArtifactInput } from "@agent-runtime/types";
