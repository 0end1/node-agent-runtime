// ---- C5 policy (M3, docs/architecture.md §6.1) ----
// M6 拆包批次 B3：`permission.ts` 外置为独立包（C2 决策：与 sandbox 独立两包）。

export {
  PermissionManager,
  DefaultPermissionPolicy,
  StaticPolicy,
  combinePolicies,
  toolListPolicy,
} from "./permission.js";
export {
  createProductionPolicy,
  secureScope,
  createProductionDefaults,
  PRODUCTION_MATRIX,
} from "./secure.js";
export type {
  Verdict,
  Decision,
  PermissionPolicy,
  PermissionContext,
  PermissionCall,
  GateResult,
  PendingDecision,
  PermissionManagerOptions,
  DecisionMatrix,
  DefaultPermissionPolicyOptions,
} from "./permission.js";
