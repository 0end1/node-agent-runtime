/**
 * C9 ACP adapter — expose the runtime as an Agent Client Protocol (v1) agent.
 *
 *   import { AcpAgent } from "@node-agent-runtime/acp";
 *   await new AcpAgent({ provider, agents }).start();   // stdio
 *
 * Spec notes: docs/acp-spec-review.md · Roadmap: docs/development-checklist.md §3.4
 */
export { AcpAgent } from "./agent.js";
export type { AcpAgentOptions } from "./agent.js";

export { AcpConnection } from "./connection.js";
export type {
  AcpConnectionOptions,
  MethodHandler,
  NotificationHandler,
} from "./connection.js";

export { NoAskPolicy } from "./policy.js";

export {
  StdioTransport,
  MemoryTransportPair,
  type AcpTransport,
  type StdioTransportOptions,
} from "./transport.js";

export { mapToolKind, toolTitle, translateEvent, usageUpdate } from "./update.js";

export {
  ACP_PROTOCOL_VERSION,
  promptToText,
  type AgentCapabilities,
  type CancelParams,
  type CloseSessionParams,
  type ContentBlock,
  type ImplementationInfo,
  type InitializeParams,
  type InitializeResult,
  type LoadSessionParams,
  type NewSessionParams,
  type NewSessionResult,
  type PlanEntry,
  type PromptParams,
  type PromptResult,
  type SessionUpdate,
  type SessionUpdateParams,
  type StopReason,
  type TextContentBlock,
  type ToolCallContent,
  type ToolCallLocation,
  type ToolCallPatchUpdate,
  type ToolCallStatus,
  type ToolCallUpdate_,
  type ToolKind,
  type UsageUpdate,
} from "./protocol.js";

export {
  JsonRpcError,
  LineDecoder,
  encodeMessage,
  isRequest,
  isResponse,
  parseMessage,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccess,
} from "./jsonrpc.js";
