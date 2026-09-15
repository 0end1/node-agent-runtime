// ---- Artifact (M4, docs/architecture.md §8.1) ----
// M6 P1 审查 P1：从 memory 包拆出，一包一职责（记忆 vs 产物）。
// 依赖单向：artifact → types（Storage 与 Artifact 契约）。

export { ArtifactManager, ArtifactError, MIME_BY_KIND, blobKeyOf } from "./artifact.js";
export type { ArtifactManagerOptions } from "./artifact.js";

// 契约类型位于 C1，此处 re-export 便于宿主单点导入。
export type { Artifact, ArtifactKind, ArtifactInput } from "@node-agent-runtime/types";
