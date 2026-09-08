// ---- C8 host (M1 生命周期产品面) ----
// M6 拆包：`session.ts` 外置为独立包。依赖方向 host → {core, memory, sandbox, policy, types}，
// 单向无环（core 不反向依赖 host，故 core 也不 re-export 本包）。

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

// ---- P3.3 approval audit + grant persistence ----
export { StorageApprovalStore } from "./approval-store.js";
