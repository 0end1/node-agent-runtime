import type {
  AssistantMessage,
  RunUsage,
  ToolCall,
  UserMessage,
} from "./types.js";

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
}

export type RuntimeEvent =
  | RunStartEvent
  | UserMessageEvent
  | StepStartEvent
  | ModelResponseEvent
  | ToolStartEvent
  | ToolEndEvent
  | RunEndEvent
  | RunErrorEvent;

/**
 * A tiny, typed event bus. The runtime emits lifecycle events so that
 * any frontend (CLI, Web UI, SDK user) can stream the agent's reasoning.
 */
export class EventBus<E extends { type: string }> {
  private all: Set<(e: E) => void> = new Set();
  private typed = new Map<string, Set<(e: E) => void>>();

  /** Receive every event emitted by the runtime. Returns an unsubscribe fn. */
  subscribe(listener: (e: E) => void): () => void {
    this.all.add(listener);
    return () => this.all.delete(listener);
  }

  /** Receive only events of a given `type`. Returns an unsubscribe fn. */
  on<K extends E["type"]>(type: K, listener: (e: Extract<E, { type: K }>) => void): () => void {
    let set = this.typed.get(type);
    if (!set) {
      set = new Set();
      this.typed.set(type, set);
    }
    set.add(listener as (e: E) => void);
    return () => set!.delete(listener as (e: E) => void);
  }

  emit(event: E): void {
    for (const listener of [...this.all]) {
      try {
        listener(event);
      } catch (err) {
        // A failing listener must never break the runtime loop.
        console.error("[agent-runtime] event listener error:", err);
      }
    }
    const typed = this.typed.get(event.type);
    if (typed) {
      for (const listener of [...typed]) {
        try {
          listener(event);
        } catch (err) {
          console.error("[agent-runtime] event listener error:", err);
        }
      }
    }
  }
}
