import type { AssistantMessage, RunUsage, ToolCall, UserMessage } from "./types.js";
import type { ErrorCode } from "./codes.js";

/**
 * Runtime event contracts (下沉 C1，M6 拆 C5 policy 前置：policy 需要
 * `RuntimeEvent` 而不能反向依赖 core)。实现 `EventBus` 仍留在 core。
 */

export interface RunStartEvent {
  type: "run:start";
  runId: string;
  agentName: string;
  input: string;
}

export interface UserMessageEvent {
  type: "message:user";
  runId: string;
  message: UserMessage;
}

export interface StepStartEvent {
  type: "step:start";
  runId: string;
  /** 1-based model round-trip index */
  step: number;
}

export interface ModelResponseEvent {
  type: "model:response";
  runId: string;
  step: number;
  /** The assistant turn: text and/or tool calls. */
  message: AssistantMessage;
}

export interface ToolStartEvent {
  type: "tool:start";
  runId: string;
  step: number;
  toolCall: ToolCall;
}

export interface ToolEndEvent {
  type: "tool:end";
  runId: string;
  step: number;
  toolCall: ToolCall;
  /** Serialized tool result (as fed back to the model). */
  result: string;
  durationMs: number;
  ok: boolean;
}

export interface RunEndEvent {
  type: "run:end";
  runId: string;
  steps: number;
  output: string;
  usage: RunUsage;
  stoppedByMaxSteps: boolean;
}

export interface RunErrorEvent {
  type: "run:error";
  runId: string;
  step: number | null;
  error: string;
  /**
   * P3.1: stable machine-readable cause (see `ErrorCode`). Present whenever the
   * failure came from a typed runtime error — `unknown` for legacy throws.
   */
  code?: ErrorCode;
}

// ---- Session & Task lifecycle events (M1) -------------------------------

export interface SessionCreatedEvent {
  type: "session:created";
  sessionId: string;
  agentId: string;
  title: string;
}

export interface SessionUpdatedEvent {
  type: "session:updated";
  sessionId: string;
  status?: string;
  title?: string;
}

export interface SessionClosedEvent {
  type: "session:closed";
  sessionId: string;
}

export interface TaskCreatedEvent {
  type: "task:created";
  taskId: string;
  sessionId: string;
  goal: string;
}

export interface TaskStatusEvent {
  type: "task:status";
  taskId: string;
  sessionId: string;
  status: string;
}

// ---- Checkpoint & resume events (M2) -------------------------------

export interface CheckpointSavedEvent {
  type: "checkpoint:saved";
  checkpointId: string;
  runId: string;
  sessionId: string;
  taskId: string;
  /** Steps completed at snapshot time. */
  step: number;
}

export interface CheckpointRestoredEvent {
  type: "checkpoint:restored";
  checkpointId: string;
  /** The *new* run created to continue from the checkpoint. */
  runId: string;
  sessionId: string;
  taskId: string;
  /** Step the resumed run starts from. */
  step: number;
}

// ---- Governance events (M3) ---------------------------------------

export interface PermissionRequestEvent {
  type: "permission:request";
  decisionId: string;
  runId: string;
  sessionId?: string;
  taskId?: string;
  toolName: string;
  /** Arguments as the model sent them (JSON-serializable). */
  arguments: unknown;
  reason: string;
}

export interface PermissionApprovedEvent {
  type: "permission:approved";
  decisionId: string;
  runId: string;
  sessionId?: string;
  toolName: string;
  /** The host asked to remember this approval for the tool. */
  always?: boolean;
}

export interface PermissionDeniedEvent {
  type: "permission:denied";
  decisionId: string;
  runId: string;
  sessionId?: string;
  toolName: string;
  reason: string;
  /** True when nobody answered before the ask timeout. */
  timedOut?: boolean;
}

export interface SandboxWriteEvent {
  type: "sandbox:write";
  runId: string;
  sessionId?: string;
  taskId?: string;
  toolName: string;
  paths: string[];
  /** Best-effort line diff ("write is visible"). */
  diff?: string;
  ok: boolean;
}

export type RuntimeEvent =
  | RunStartEvent
  | UserMessageEvent
  | StepStartEvent
  | ModelResponseEvent
  | ToolStartEvent
  | ToolEndEvent
  | RunEndEvent
  | RunErrorEvent
  // ---- Session & Task lifecycle events (M1) ----
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionClosedEvent
  | TaskCreatedEvent
  | TaskStatusEvent
  // ---- Checkpoint & resume events (M2) ----
  | CheckpointSavedEvent
  | CheckpointRestoredEvent
  // ---- Governance events (M3) ----
  | PermissionRequestEvent
  | PermissionApprovedEvent
  | PermissionDeniedEvent
  | SandboxWriteEvent;

/**
 * Minimal emitter surface consumers (policy 等外置包) depend on — core 的
 * `EventBus` 结构上即实现它，故外置包无需反向依赖 core。
 */
export interface EventEmitter<E> {
  emit(event: E): void;
}
