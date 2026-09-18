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

export interface ConfigOptionUpdate {
  sessionUpdate: "config_option_update";
  configOptions: ConfigOption[];
}

export type SessionUpdate =
  | AgentMessageChunkUpdate
  | UserMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallUpdate_
  | ToolCallPatchUpdate
  | UsageUpdate
  | PlanUpdate
  | CurrentModeUpdate
  | ConfigOptionUpdate;

export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

// -------------------------------------------------------------- permissions

export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

/**
 * One button in the client's approval dialog.
 *
 * `kind` carries the semantics so the client can render its own wording and
 * decide whether to remember the answer, instead of pattern-matching our
 * labels.
 */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: ToolCallUpdate_;
  options: PermissionOption[];
}

export type PermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface RequestPermissionResult {
  outcome: PermissionOutcome;
}

// ------------------------------------------------------------- session modes

export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionMode[];
}

export interface SetModeParams {
  sessionId: string;
  modeId: string;
}

export interface SetModeResult {
  [key: string]: never;
}

// ------------------------------------------------------ session config options

export interface ConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

/**
 * A session-level selector. Only `select` is emitted: `boolean` requires the
 * client to advertise `session.configOptions.boolean` during initialize, and
 * every option we expose today is an enumeration.
 */
export interface ConfigOption {
  id: string;
  name: string;
  description?: string;
  /**
   * UX hint only; clients must tolerate unknown values. Spec-reserved values
   * are `mode` / `model` / `model_config` / `thought_level`.
   */
  category?: string;
  type: "select";
  currentValue: string;
  options: ConfigOptionValue[];
}

export interface SetConfigOptionParams {
  sessionId: string;
  configId: string;
  value: string;
}

/** The full configuration state — not just the option that changed. */
export interface SetConfigOptionResult {
  configOptions: ConfigOption[];
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
  /**
   * Legacy mode selector (M8-3). Superseded by `configOptions`, but older
   * clients only read this field — both are always sent, kept in sync.
   */
  modes?: SessionModeState;
  /** Preferred selector surface; clients that support it should ignore `modes`. */
  configOptions?: ConfigOption[];
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
