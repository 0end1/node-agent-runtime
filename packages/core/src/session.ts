import type { Agent } from "./agent.js";
import { AgentRuntime } from "./runtime.js";
import type { RunUsage } from "@agent-runtime/types";
import type { ChatMessage } from "@agent-runtime/types";
import type { Storage } from "./store/types.js";
import { newId } from "@agent-runtime/types";

/**
 * Lifecycle entities + SessionManager (docs/architecture.md §3).
 *
 *   Session (1) ── contains many ─▶ Task (n) ── runs many ─▶ Run
 *
 * Messages are persisted as a per-session message stream, so a process
 * restart (or a second manager over the same Storage) can reload a session
 * and keep chatting — the caller never has to manage `history` itself.
 */

export type SessionStatus = "idle" | "busy" | "closed";

export interface Session {
  readonly id: string;
  agentId: string;
  title: string;
  status: SessionStatus;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus = "created" | "running" | "done" | "failed" | "cancelled";

export interface Task {
  readonly id: string;
  sessionId: string;
  goal: string;
  status: TaskStatus;
  runIds: string[];
  /** Final answer once the task reaches `done`. */
  result?: string;
  /** Failure reason when the task reaches `failed`. */
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = "succeeded" | "stopped" | "aborted" | "failed";

/** A persisted run record (docs §3.1: Run promoted from memory-only return). */
export interface RunRecord {
  readonly id: string;
  taskId: string;
  sessionId: string;
  agentName: string;
  input: string;
  steps: number;
  output: string;
  usage: RunUsage;
  status: RunStatus;
  stoppedByMaxSteps: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface ChatOutcome {
  session: Session;
  task: Task;
  run: RunRecord;
}

export interface SessionManagerOptions {
  runtime: AgentRuntime;
  storage: Storage;
  /** Registry of agent recipes; sessions reference an agent by its `name`. */
  agents: readonly Agent[];
  /** Clock injectable for deterministic tests. */
  now?: () => number;
}

/** Thrown when an operation targets a session in a state that forbids it. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

export class SessionManager {
  private readonly runtime: AgentRuntime;
  private readonly storage: Storage;
  private readonly agents = new Map<string, Agent>();
  private readonly now: () => number;
  /** In-process busy guard to keep a single session from concurrent writes. */
  private readonly busy = new Set<string>();

  constructor(options: SessionManagerOptions) {
    this.runtime = options.runtime;
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
    for (const agent of options.agents) {
      if (this.agents.has(agent.name)) {
        throw new Error(`重复注册的 Agent 配方：${agent.name}`);
      }
      this.agents.set(agent.name, agent);
    }
  }

  // ------------------------------------------------------------------ Session

  async createSession(options: {
    agentId: string;
    /** Explicit id (e.g. a host-generated uuid). Defaults to a fresh one. */
    id?: string;
    title?: string;
    meta?: Record<string, unknown>;
  }): Promise<Session> {
    const agent = this.agents.get(options.agentId);
    if (!agent) throw new SessionError(`未知 Agent 配方：${options.agentId}`);
    const id = options.id?.trim() ? options.id.trim() : newId("session");
    const existing = await this.storage.loadDoc<Session>("session", id);
    if (existing) throw new SessionError(`会话已存在：${id}`);
    const t = this.now();
    const session: Session = {
      id,
      agentId: agent.name,
      title: options.title ?? "",
      status: "idle",
      meta: options.meta ?? {},
      createdAt: t,
      updatedAt: t,
    };
    await this.storage.saveDoc("session", session.id, session);
    this.runtime.events.emit({
      type: "session:created",
      sessionId: session.id,
      agentId: session.agentId,
      title: session.title,
    });
    return session;
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.storage.loadDoc<Session>("session", id);
  }

  async listSessions(): Promise<Session[]> {
    const all = await this.storage.listDocs<Session>("session");
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  async closeSession(id: string): Promise<Session> {
    const session = await this.requireSession(id);
    if (session.status === "closed") return session;
    const updated: Session = { ...session, status: "closed", updatedAt: this.now() };
    await this.storage.saveDoc("session", id, updated);
    this.runtime.events.emit({
      type: "session:updated",
      sessionId: id,
      status: updated.status,
    });
    this.runtime.events.emit({ type: "session:closed", sessionId: id });
    return updated;
  }

  /** Delete the session and everything attached to it (tasks, runs, messages). */
  async deleteSession(id: string): Promise<void> {
    const tasks = await this.storage.listDocs<Task>("task", { sessionId: id });
    const runs = await this.storage.listDocs<RunRecord>("run", { sessionId: id });
    for (const run of runs) await this.storage.deleteDoc("run", run.id);
    for (const task of tasks) await this.storage.deleteDoc("task", task.id);
    await this.storage.deleteDoc("session", id);
    await this.storage.deleteStream("message", id);
    this.busy.delete(id);
  }

  /** The full persisted transcript of a session (user/assistant/tool turns). */
  async messages(sessionId: string): Promise<ChatMessage[]> {
    const lines = await this.storage.readStream("message", sessionId);
    const out: ChatMessage[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as ChatMessage);
      } catch {
        // skip a corrupt line rather than losing the whole session
      }
    }
    return out;
  }

  // --------------------------------------------------------------------- Task

  async createTask(sessionId: string, goal: string): Promise<Task> {
    const session = await this.requireOpenSession(sessionId);
    const text = (goal ?? "").trim();
    if (!text) throw new SessionError("task goal 不能为空");
    const t = this.now();
    const task: Task = {
      id: newId("task"),
      sessionId,
      goal: text,
      status: "created",
      runIds: [],
      createdAt: t,
      updatedAt: t,
    };
    await this.storage.saveDoc("task", task.id, task);
    this.runtime.events.emit({
      type: "task:created",
      taskId: task.id,
      sessionId,
      goal: text,
    });
    // Lazily give the session a title from its first user goal.
    if (!session.title) {
      await this.renameSession(session, text);
    }
    return task;
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.storage.loadDoc<Task>("task", id);
  }

  async listTasks(sessionId: string): Promise<Task[]> {
    const all = await this.storage.listDocs<Task>("task", { sessionId });
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  async cancelTask(id: string): Promise<Task> {
    const task = await this.storage.loadDoc<Task>("task", id);
    if (!task) throw new SessionError(`未知 Task：${id}`);
    if (task.status === "running") {
      throw new SessionError("task 正在运行，无法取消（M3 起支持运行中取消）");
    }
    const updated: Task = { ...task, status: "cancelled", updatedAt: this.now() };
    await this.storage.saveDoc("task", id, updated);
    this.emitTaskStatus(updated);
    return updated;
  }

  // ------------------------------------------------------------------ Submit

  /**
   * Run one user goal as a task inside a session (high-level convenience):
   * creates the task, schedules a run, persists the transcript.
   *
   * The caller never manages `history`: prior messages are reloaded from the
   * store automatically, making a restart-transparent conversational loop.
   */
  async chat(
    sessionId: string,
    input: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<ChatOutcome> {
    const session = await this.requireOpenSession(sessionId);
    const text = (input ?? "").trim();
    if (!text) throw new SessionError("输入不能为空");
    const task = await this.createTask(sessionId, text);
    return this.submitTask(task.id, options);
  }

  /**
   * Schedule a run for an existing task. A task can be re-submitted to
   * continue (M2 resume / follow-up questions reuse the same task).
   */
  async submitTask(taskId: string, options: { signal?: AbortSignal } = {}): Promise<ChatOutcome> {
    const task = await this.storage.loadDoc<Task>("task", taskId);
    if (!task) throw new SessionError(`未知 Task：${taskId}`);
    const session = await this.requireOpenSession(task.sessionId);
    if (this.busy.has(session.id)) {
      throw new SessionError(`会话 ${session.id} 正在运行中，请稍候`);
    }
    this.busy.add(session.id);
    await this.setSessionStatus(session, "busy");
    await this.patchTask(task, { status: "running", error: undefined });

    const agent = this.agents.get(session.agentId);
    if (!agent) throw new SessionError(`未知 Agent 配方：${session.agentId}`);

    const history = await this.messages(session.id);
    const runId = newId("run");
    const startedAt = this.now();

    try {
      const result = await this.runtime.run({
        agent,
        input: task.goal,
        history,
        conversationId: session.id,
        sessionId: session.id,
        taskId: task.id,
        signal: options.signal,
      });
      return await this.finishTask(task, session, agent, result, runId, startedAt, history.length);
    } catch (err) {
      const aborted = err instanceof Error && err.name === "RunAbortedError";
      try {
        const failed: Task = {
          ...task,
          status: aborted ? "cancelled" : "failed",
          error: err instanceof Error ? err.message : String(err),
          updatedAt: this.now(),
        };
        await this.storage.saveDoc("task", task.id, failed);
        this.emitTaskStatus(failed);
        const run: RunRecord = {
          id: runId,
          taskId: task.id,
          sessionId: session.id,
          agentName: agent.name,
          input: task.goal,
          steps: 0,
          output: "",
          usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
          status: aborted ? "aborted" : "failed",
          stoppedByMaxSteps: false,
          startedAt,
          finishedAt: this.now(),
        };
        await this.storage.saveDoc("run", runId, run);
      } finally {
        await this.setSessionStatus(session, "idle");
        this.busy.delete(session.id);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /** Persist the new turns, promote the task, emit events. */
  private async finishTask(
    task: Task,
    session: Session,
    agent: Agent,
    result: Awaited<ReturnType<AgentRuntime["run"]>>,
    runId: string,
    startedAt: number,
    historyLength: number
  ): Promise<ChatOutcome> {
    // 1) persist the messages produced by this run (everything after the history
    //    we passed in — the runtime appended user + assistant + tool turns).
    const fresh = result.messages.slice(historyLength);
    for (const message of fresh) {
      await this.storage.appendStream("message", session.id, JSON.stringify(message));
    }

    // 2) run record
    const finishedAt = this.now();
    const run: RunRecord = {
      id: runId,
      taskId: task.id,
      sessionId: session.id,
      agentName: agent.name,
      input: task.goal,
      steps: result.steps,
      output: result.output,
      usage: result.usage,
      status: result.stoppedByMaxSteps ? "stopped" : "succeeded",
      stoppedByMaxSteps: result.stoppedByMaxSteps,
      startedAt,
      finishedAt,
    };
    await this.storage.saveDoc("run", runId, run);

    // 3) task -> done
    const done: Task = {
      ...task,
      status: "done",
      result: result.output,
      runIds: [...task.runIds, runId],
      updatedAt: finishedAt,
    };
    await this.storage.saveDoc("task", task.id, done);
    this.emitTaskStatus(done);

    // 4) session back to idle
    const relaxed: Session = { ...session, status: "idle", updatedAt: finishedAt };
    await this.storage.saveDoc("session", session.id, relaxed);
    this.busy.delete(session.id);
    this.runtime.events.emit({
      type: "session:updated",
      sessionId: session.id,
      status: "idle",
    });

    return { session: relaxed, task: done, run };
  }

  // ------------------------------------------------------------------ helpers

  private async requireSession(id: string): Promise<Session> {
    const session = await this.storage.loadDoc<Session>("session", id);
    if (!session) throw new SessionError(`未知会话：${id}`);
    return session;
  }

  private async requireOpenSession(id: string): Promise<Session> {
    const session = await this.requireSession(id);
    if (session.status === "closed") {
      throw new SessionError(`会话 ${id} 已关闭`);
    }
    return session;
  }

  private async setSessionStatus(session: Session, status: SessionStatus): Promise<void> {
    const updated: Session = { ...session, status, updatedAt: this.now() };
    await this.storage.saveDoc("session", session.id, updated);
    this.runtime.events.emit({
      type: "session:updated",
      sessionId: session.id,
      status,
    });
  }

  private async renameSession(session: Session, title: string): Promise<void> {
    const clean = title.length > 24 ? title.slice(0, 24) + "…" : title;
    const updated: Session = { ...session, title: clean, updatedAt: this.now() };
    await this.storage.saveDoc("session", session.id, updated);
    this.runtime.events.emit({
      type: "session:updated",
      sessionId: session.id,
      title: clean,
    });
  }

  private async patchTask(task: Task, patch: Partial<Task>): Promise<void> {
    const updated: Task = { ...task, ...patch, updatedAt: this.now() };
    await this.storage.saveDoc("task", task.id, updated);
    if (patch.status && patch.status !== task.status) {
      this.emitTaskStatus(updated);
    }
  }

  private emitTaskStatus(task: Task): void {
    this.runtime.events.emit({
      type: "task:status",
      taskId: task.id,
      sessionId: task.sessionId,
      status: task.status,
    });
  }
}
