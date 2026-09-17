/**
 * ACP v1 protocol types (docs/acp-spec-review.md).
 *
 * Field names mirror the specification verbatim so that a wrong shape is a
 * type error rather than a runtime surprise against a real client. Only the
 * subset this adapter actually emits/receives is modelled.
 */

/** ACP v1 identifies itself with a single integer MAJOR version. */
export const ACP_PROTOCOL_VERSION = 1;

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type PlanPriority = "high" | "medium" | "low";

// ---------------------------------------------------------------- content

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ResourceContentBlock {
  type: "resource";
  resource: { uri: string; mimeType?: string; text?: string };
}

export interface ResourceLinkContentBlock {
  type: "resource_link";
  uri: string;
  title?: string;
  mimeType?: string;
}

export interface ImageContentBlock {
  type: "image";
  data?: string;
  mimeType?: string;
  uri?: string;
}

export interface AudioContentBlock {
  type: "audio";
  data?: string;
  mimeType?: string;
}

export type ContentBlock =
  | TextContentBlock
  | ResourceContentBlock
  | ResourceLinkContentBlock
  | ImageContentBlock
  | AudioContentBlock;

export type ToolCallContent =
  | { type: "content"; content: ContentBlock }
  | { type: "diff"; path: string; oldText?: string; newText: string }
  | { type: "terminal"; terminalId: string };

export interface ToolCallLocation {
  path: string;
  line?: number;
}

// ------------------------------------------------------------ session/update

interface ToolCallFields {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface ToolCallUpdate_ extends ToolCallFields {
  sessionUpdate: "tool_call";
}

export interface ToolCallPatchUpdate extends ToolCallFields {
  sessionUpdate: "tool_call_update";
}

export interface AgentMessageChunkUpdate {
  sessionUpdate: "agent_message_chunk";
  messageId?: string;
  content: ContentBlock;
}

export interface UserMessageChunkUpdate {
  sessionUpdate: "user_message_chunk";
  messageId?: string;
  content: ContentBlock;
}

export interface AgentThoughtChunkUpdate {
  sessionUpdate: "agent_thought_chunk";
  messageId?: string;
  content: ContentBlock;
}

export interface UsageUpdate {
  sessionUpdate: "usage_update";
  /** Tokens used in the current session context (required, non-null). */
  used: number;
  /** Context-window size in tokens (required, non-null). */
  size: number;
  cost?: { amount: number; currency: string };
}

export interface PlanEntry {
  content: string;
  priority: PlanPriority;
  status: "pending" | "in_progress" | "completed";
}

export interface PlanUpdate {
  sessionUpdate: "plan";
  entries: PlanEntry[];
}

export interface CurrentModeUpdate {
  sessionUpdate: "current_mode_update";
  modeId: string;
}

export type SessionUpdate =
  | AgentMessageChunkUpdate
  | UserMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallUpdate_
  | ToolCallPatchUpdate
  | UsageUpdate
  | PlanUpdate
  | CurrentModeUpdate;

export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

// ------------------------------------------------------------- capabilities

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  sessionCapabilities?: {
    resume?: Record<string, never> | Record<string, unknown>;
    close?: Record<string, never> | Record<string, unknown>;
    additionalDirectories?: Record<string, never> | Record<string, unknown>;
  };
}

export interface ImplementationInfo {
  name: string;
  title?: string;
  version?: string;
}

export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
}

// ------------------------------------------------------------------ methods

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities?: Record<string, unknown>;
  clientInfo?: ImplementationInfo;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities?: AgentCapabilities;
  agentInfo?: ImplementationInfo;
  authMethods: AuthMethod[];
}

export interface NewSessionParams {
  /** Absolute path; becomes the session's primary filesystem root. */
  cwd: string;
  mcpServers?: unknown[];
  /** Non-spec escape hatch: which runtime agent recipe to bind (M8-2). */
  _meta?: { agentId?: string } & Record<string, unknown>;
}

export interface NewSessionResult {
  sessionId: string;
}

export interface PromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export interface PromptResult {
  stopReason: StopReason;
}

export interface CancelParams {
  sessionId: string;
}

export interface LoadSessionParams {
  sessionId: string;
  cwd: string;
  mcpServers?: unknown[];
}

export interface CloseSessionParams {
  sessionId: string;
}

// ------------------------------------------------------------------ helpers

/**
 * Flatten the `prompt` array into a single user instruction.
 *
 * Only `text` is part of the v1 baseline every agent must accept; `resource`
 * (embedded context) is folded in when the client sends it anyway, and every
 * other block type is skipped rather than crashing the turn.
 */
export function promptToText(blocks: readonly ContentBlock[] | undefined): string {
  if (!blocks) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      if (block.text) parts.push(block.text);
    } else if (block.type === "resource") {
      const resource = block.resource;
      const label = resource.uri ? `[${resource.uri}]` : "[resource]";
      if (resource.text) parts.push(`${label}\n${resource.text}`);
    } else if (block.type === "resource_link") {
      parts.push(`[${block.uri}]`);
    }
    // image / audio: not advertised in our promptCapabilities — ignored.
  }
  return parts.join("\n\n").trim();
}
