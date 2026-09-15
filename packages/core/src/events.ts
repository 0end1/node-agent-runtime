// 事件契约类型已下沉 C1（M6 拆 C5 policy 前置），`EventBus` 实现保留在 core。
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
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionClosedEvent,
  TaskCreatedEvent,
  TaskStatusEvent,
  CheckpointSavedEvent,
  CheckpointRestoredEvent,
  PermissionRequestEvent,
  PermissionApprovedEvent,
  PermissionDeniedEvent,
  SandboxWriteEvent,
} from "@node-agent-runtime/types";

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
        console.error("[node-agent-runtime] event listener error:", err);
      }
    }
    const typed = this.typed.get(event.type);
    if (typed) {
      for (const listener of [...typed]) {
        try {
          listener(event);
        } catch (err) {
          console.error("[node-agent-runtime] event listener error:", err);
        }
      }
    }
  }
}
