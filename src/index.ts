import { Agent } from "./agent.js";
import { builtinTools } from "./tools/builtin.js";

// ---- Agent runtime core ----
export { AgentRuntime, RunAbortedError } from "./runtime.js";
export type {
  AgentRuntimeOptions,
  RunOptions,
  RunResult,
} from "./runtime.js";

export { Agent, defineAgent, DEFAULT_AGENT_INSTRUCTIONS } from "./agent.js";
export type { AgentOptions } from "./agent.js";

// ---- Events ----
export { EventBus } from "./events.js";
export type {
  RuntimeEvent,
  RunStartEvent,
  UserMessageEvent,
  StepStartEvent,
  ModelResponseEvent,
  ToolStartEvent,
  ToolEndEvent,
  RunEndEvent,
  RunErrorEvent,
} from "./events.js";

// ---- Tools ----
export { defineTool, findDuplicateToolNames } from "./tool.js";
export type {
  ToolDefinition,
  AnyTool,
  ToolExecutionContext,
} from "./tool.js";

export { builtinTools } from "./tools/builtin.js";
export type { CurrencyCode } from "./tools/builtin.js";
export { CURRENCY_ALIASES } from "./tools/builtin.js";

export { evaluate } from "./tools/calculator.js";

// ---- Schema validation ----
export { validate } from "./schema.js";
export type { JsonSchema, JsonSchemaType } from "./schema.js";

// ---- Model providers ----
export type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  RawToolCall,
  FinishReason,
} from "./provider.js";
export { ModelRequestError } from "./provider.js";

export { OpenAIClientProvider } from "./providers/openai-compatible.js";
export type { OpenAIClientOptions } from "./providers/openai-compatible.js";

export { MockProvider } from "./providers/mock.js";

// ---- Shared types & utils ----
export type {
  ChatMessage,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolCall,
  RunUsage,
} from "./types.js";

export { newId, fmtNumber, stringifyResult, prettyJson } from "./util.js";

/**
 * Convenience: build the demo agent wired with all built-in tools.
 */
export function createDemoAgent(): Agent {
  return new Agent({
    name: "assistant",
    tools: builtinTools,
  });
}
