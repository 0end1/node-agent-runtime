import type { AnyTool } from "./tool.js";

/**
 * A structural reference to one remote MCP tool.
 *
 * Deliberately **structural** (not a named `McpToolRef` import): the dependency
 * direction is `mcp → core`, so core must not import from `@node-agent-runtime/mcp`.
 * `McpRegistry.resolve(ref)` accepts the same shape, so hosts wire it up with
 * `resolveMcp: (ref) => registry.resolve(ref)` — zero coupling, still type-checked.
 * (M7-5, docs/m7-base-governance.md §8-10)
 */
export interface McpToolRefLike {
  server: string;
  tool: string;
}

export interface AgentOptions {
  /** Unique identifier. */
  name: string;
  /** Optional short description (useful for multi-agent routing later). */
  description?: string;
  /** System prompt / operating instructions. */
  instructions?: string;
  /** Tools the agent can call during a run. */
  tools?: readonly AnyTool[];
  /**
   * Remote MCP tools the recipe depends on. Resolved (and validated) by
   * `compileAgent()` — never at run time, so an unreachable server fails the
   * recipe instead of the run.
   */
  mcpTools?: readonly McpToolRefLike[];
  /** Max model round-trips per run (default 8). */
  maxSteps?: number;
  /** Sampling temperature passed to the model. */
  temperature?: number;
  /** Max output tokens per model response. */
  maxTokens?: number;
}

export const DEFAULT_AGENT_INSTRUCTIONS = `你是基于自研 Agent 运行时驱动的智能助手。
你可以调用工具来完成真实计算与查询，规则如下：
1. 遇到需要精确计算/外部数据的问题时，主动选择合适的工具；
2. 一次只推进必要的步骤：工具结果返回后再决定下一步或给出最终答案；
3. 永远基于工具真实返回与对话上下文作答，绝不编造数据；
4. 回答保持简洁、自然的中文。`;

/**
 * An Agent couples instructions + tools + model sampling options.
 * A single runtime can run many agents; pick one per run().
 */
export class Agent {
  readonly name: string;
  readonly description?: string;
  readonly instructions: string;
  readonly tools: readonly AnyTool[];
  readonly mcpTools: readonly McpToolRefLike[];
  readonly maxSteps: number;
  readonly temperature?: number;
  readonly maxTokens?: number;

  constructor(options: AgentOptions) {
    if (!options.name || !options.name.trim()) {
      throw new Error("Agent 必须有一个非空 name");
    }
    this.name = options.name.trim();
    this.description = options.description;
    this.instructions = options.instructions ?? DEFAULT_AGENT_INSTRUCTIONS;
    this.tools = options.tools ?? [];
    this.mcpTools = options.mcpTools ?? [];
    this.maxSteps = Math.max(1, options.maxSteps ?? 8);
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
  }
}

/** Functional shorthand for `new Agent(...)`. */
export function defineAgent(options: AgentOptions): Agent {
  return new Agent(options);
}
