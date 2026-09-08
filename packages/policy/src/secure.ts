import type { SandboxMode, SandboxScope } from "@agent-runtime/sandbox";
import {
  DefaultPermissionPolicy,
  type DecisionMatrix,
  type DefaultPermissionPolicyOptions,
} from "./permission.js";

/**
 * Production-hardened default permission matrix (P3.7). Relative to the default
 * `DEFAULT_MATRIX`, it denies `network-read` tools in `workspace-write` (a
 * production host should not reach the network unless explicitly allowlisted or
 * running in `full-access`), while keeping `credential` tools denied everywhere
 * and `write`/`exec` gated behind `ask`.
 */
export const PRODUCTION_MATRIX: DecisionMatrix = {
  harmless: { "read-only": "allow", "workspace-write": "allow", "full-access": "allow" },
  "network-read": { "read-only": "allow", "workspace-write": "deny", "full-access": "allow" },
  write: { "read-only": "deny", "workspace-write": "ask", "full-access": "ask" },
  exec: { "read-only": "deny", "workspace-write": "ask", "full-access": "ask" },
  credential: { "read-only": "deny", "workspace-write": "deny", "full-access": "deny" },
};

/** A permission policy preset tuned for production (deny-by-default bias). */
export function createProductionPolicy(
  options: DefaultPermissionPolicyOptions = {},
): DefaultPermissionPolicy {
  const matrix = options.matrix ? mergeMatrix(PRODUCTION_MATRIX, options.matrix) : PRODUCTION_MATRIX;
  return new DefaultPermissionPolicy({ ...options, matrix });
}

function mergeMatrix(
  base: DecisionMatrix,
  override: Partial<Record<keyof typeof base, Partial<Record<SandboxMode, "allow" | "deny" | "ask">>>>,
): DecisionMatrix {
  const out: DecisionMatrix = { ...base };
  for (const kind of Object.keys(base) as (keyof typeof base)[]) {
    const modes = override[kind];
    if (modes) out[kind] = { ...base[kind], ...modes };
  }
  return out;
}

/** A locked-down sandbox scope: writes only inside `workspace`, no network. */
export function secureScope(workspace: string, extra: Partial<SandboxScope> = {}): SandboxScope {
  return { workspace, writablePaths: [], network: "deny", ...extra };
}

/** Convenience bundle adopted as the recommended production default. */
export function createProductionDefaults(workspace: string): {
  policy: DefaultPermissionPolicy;
  sandboxMode: SandboxMode;
  scope: SandboxScope;
} {
  return {
    policy: createProductionPolicy(),
    sandboxMode: "workspace-write",
    scope: secureScope(workspace),
  };
}
