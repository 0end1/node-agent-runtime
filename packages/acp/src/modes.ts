import type { SandboxMode } from "@node-agent-runtime/sandbox";
import type { ConfigOption, SessionMode, SessionModeState } from "./protocol.js";

/**
 * ACP session modes ↔ the runtime's execution modes (docs/architecture.md §6.0.1).
 *
 * A mode is not cosmetic: it feeds `PermissionContext.sandboxMode`, which is
 * one half of the policy decision matrix (`sandbox.begin()` reads it again at
 * the start of every turn). Switching modes therefore really does change what
 * the agent may do, not just what the UI shows.
 *
 * The spec now prefers Session Config Options and marks `session/set_mode` as
 * deprecated, so both surfaces are published from the same table below and are
 * always in sync (docs/acp-spec-review.md §6).
 */

/** The config-option id that mirrors the legacy `modes` selector. */
export const MODE_CONFIG_ID = "mode";

interface ModeSpec {
  id: SandboxMode;
  name: string;
  description: string;
}

export const SANDBOX_MODES: readonly ModeSpec[] = [
  {
    id: "read-only",
    name: "只读",
    description: "只读工作区：写入与命令执行直接拒绝，不做确认",
  },
  {
    id: "workspace-write",
    name: "工作区可写",
    description: "可在工作区内写入与执行命令，危险工具需逐次确认",
  },
  {
    id: "full-access",
    name: "完全访问",
    description: "放宽网络与越界限制，危险工具仍需确认",
  },
];

const MODE_IDS: ReadonlySet<string> = new Set(SANDBOX_MODES.map((mode) => mode.id));

export function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === "string" && MODE_IDS.has(value);
}

/** Legacy `modes` payload for `session/new`. */
export function modeState(current: SandboxMode): SessionModeState {
  const availableModes: SessionMode[] = SANDBOX_MODES.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
  return { currentModeId: current, availableModes };
}

/** Preferred `configOptions` payload for `session/new`. */
export function configOptions(current: SandboxMode): ConfigOption[] {
  return [
    {
      id: MODE_CONFIG_ID,
      name: "执行模式",
      description: "控制沙箱边界与确认强度，下一次对话生效",
      category: "mode",
      type: "select",
      currentValue: current,
      options: SANDBOX_MODES.map(({ id, name, description }) => ({
        value: id,
        name,
        description,
      })),
    },
  ];
}
