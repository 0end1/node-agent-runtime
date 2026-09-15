import { ErrorCode, validateSchema } from "@node-agent-runtime/types";
import { computeInstructionsHash, computeToolsHash } from "@node-agent-runtime/memory";
import type { AnyTool } from "./tool.js";
import { findDuplicateToolNames } from "./tool.js";
import { Agent } from "./agent.js";
import type { AgentOptions, McpToolRefLike } from "./agent.js";

/**
 * Agent recipe compilation (M7-5, docs/m7-base-governance.md §9;
 * design origin docs/architecture.md §3.2).
 *
 * The point is to move a class of failures *earlier*: duplicate tool names,
 * malformed parameter schemas and unreachable MCP servers today only surface
 * mid-run (or never, in the schema case — the model just keeps calling the tool
 * wrong). Compiling the recipe fails loudly, once, before any token is spent.
 *
 * What this is **not**: a permission check. A compiled tool still goes through
 * M3 approval and the sandbox on every single call.
 */

export type { McpToolRefLike };

export type AgentDiagnosticCode =
  /** Two tools (local or MCP-materialized) declare the same name. */
  | "duplicate-tool"
  /** `parameters` is not a valid `JsonSchema` (checked with `validateSchema`). */
  | "invalid-schema"
  /** A declared `mcpTools` ref could not be resolved by `resolveMcp`. */
  | "mcp-unreachable"
  /** (warn) The recipe declares no tools at all — usually a wiring mistake. */
  | "empty-tools";

export interface AgentDiagnostic {
  level: "error" | "warn";
  code: AgentDiagnosticCode;
  message: string;
  /** Name of the offending tool, when the diagnostic is about one. */
  tool?: string;
}

export interface CompileAgentOptions {
  /**
   * Resolve a `{ server, tool }` ref to a materialized tool.
   * Wire it to the MCP registry: `resolveMcp: (ref) => registry.resolve(ref)`.
   * Omit it and any `mcpTools` entry is reported as `mcp-unreachable`.
   */
  resolveMcp?: (ref: McpToolRefLike) => AnyTool | undefined;
}

/**
 * The compiled form of a recipe. Deterministic and therefore cacheable: the
 * same inputs always yield the same `toolsHash` / `instructionsHash`, so a host
 * may memoize it per recipe and skip recompiling on every run.
 */
export interface CompiledAgent {
  readonly agent: Agent;
  /** Local tools plus resolved MCP tools, in declaration order. */
  readonly tools: readonly AnyTool[];
  /** Fingerprint of the tool surface — same algorithm as `computeToolsHash`. */
  readonly toolsHash: string;
  /** Fingerprint of the instructions (soft resume guard, §8-12). */
  readonly instructionsHash: string;
  /** Non-fatal findings (fatal ones throw). */
  readonly warnings: readonly AgentDiagnostic[];
}

/** Thrown when a recipe does not compile. `issues` carries every finding at once. */
export class AgentCompileError extends Error {
  readonly code = ErrorCode.AGENT_INVALID;

  constructor(
    readonly agentName: string,
    readonly issues: readonly AgentDiagnostic[],
  ) {
    super(`Agent "${agentName}" 编译失败：${issues.map((i) => i.message).join("；")}`);
    this.name = "AgentCompileError";
  }
}

/**
 * Validate an agent recipe and return its compiled form.
 *
 * Errors are collected (not fail-fast) so a host can fix everything in one
 * pass; warnings are returned on the result.
 */
export function compileAgent(
  input: Agent | AgentOptions,
  options: CompileAgentOptions = {},
): CompiledAgent {
  const agent = input instanceof Agent ? input : new Agent(input);
  const errors: AgentDiagnostic[] = [];
  const warnings: AgentDiagnostic[] = [];

  const tools: AnyTool[] = [...agent.tools];

  for (const ref of agent.mcpTools) {
    const resolved = options.resolveMcp?.(ref);
    if (!resolved) {
      const name = `${ref.server}::${ref.tool}`;
      errors.push({
        level: "error",
        code: "mcp-unreachable",
        message: `MCP 工具 ${name} 不可达（server 未注册，或 registry 未解析该工具）`,
        tool: name,
      });
      continue;
    }
    tools.push(resolved);
  }

  // MCP-materialized tools join the same namespace as local ones, so collision
  // detection has to run on the merged set.
  for (const name of findDuplicateToolNames(tools)) {
    errors.push({
      level: "error",
      code: "duplicate-tool",
      message: `工具名 "${name}" 重复（本地工具与 MCP 工具共用一个命名空间）`,
      tool: name,
    });
  }

  for (const tool of tools) {
    if (!tool.parameters) continue;
    for (const issue of validateSchema(tool.parameters)) {
      errors.push({
        level: "error",
        code: "invalid-schema",
        message: `工具 "${tool.name}" 的参数 schema 非法：${issue}`,
        tool: tool.name,
      });
    }
  }

  if (tools.length === 0) {
    warnings.push({
      level: "warn",
      code: "empty-tools",
      message: `Agent "${agent.name}" 未声明任何工具`,
    });
  }

  if (errors.length > 0) throw new AgentCompileError(agent.name, errors);

  return {
    agent,
    tools,
    toolsHash: computeToolsHash({ name: agent.name, tools }),
    instructionsHash: computeInstructionsHash(agent),
    warnings,
  };
}

/** Snapshot of a compiled recipe, ready to be stored on a checkpoint. */
export function agentSnapshotOf(compiled: CompiledAgent): {
  agentId: string;
  toolsHash: string;
  instructionsHash: string;
} {
  return {
    agentId: compiled.agent.name,
    toolsHash: compiled.toolsHash,
    instructionsHash: compiled.instructionsHash,
  };
}
