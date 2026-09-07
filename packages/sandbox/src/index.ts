// ---- C4 sandbox (M3, docs/architecture.md §6.2) ----
// M6 拆包批次 B3：`sandbox.ts` 外置为独立包，依赖单向 sandbox → types。

export {
  LocalSandbox,
  SandboxViolationError,
  SandboxTimeoutError,
  classifyToolName,
  toolKind,
  isPathAllowed,
  simpleDiff,
} from "./sandbox.js";
export type {
  Sandbox,
  SandboxHandle,
  SandboxMode,
  SandboxScope,
  SandboxRunContext,
  SandboxWriteInfo,
  LocalSandboxOptions,
} from "./sandbox.js";
