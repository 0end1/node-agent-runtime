// C8 host：只依赖 core 的引擎 API 与外置能力包（方向单向，core 不反向依赖 host）。
import {
  AgentRuntime,
  CheckpointStore,
  assertResumable,
  computeToolsHash,
  defineAgent,
  type Agent,
  type Checkpoint,
  type RunResult,
  type StepSnapshot,
} from "@agent-runtime/core";
import {
  classifyToolName,
  toolKind as kindOfTool,
  type ChatMessage,
  type RunUsage,
  type Storage,
} from "@agent-runtime/types";
import { SessionMemory, type Memory } from "@agent-runtime/memory";
import {
  LocalSandbox,
  type Sandbox,
  type SandboxMode,
  type SandboxScope,
} from "@agent-runtime/sandbox";
import { PermissionManager } from "@agent-runtime/policy";
import { ArtifactManager, type Artifact } from "@agent-runtime/artifact";
import { newId } from "@agent-runtime/types";

/**
 * Lifecycle entities + SessionManager (docs/architecture.md §3).
 *
 *   Session (1) ── contains many ─▶ Task (n) ── runs many ─▶ Run ── snapshots ─▶ Checkpoint
 *
 * Messages are persisted as a per-session message stream, so a process
 * restart (or a second manager over the same Storage) can reload a session
 * and keep chatting — the caller never has to manage `history` itself.
 *
 * M2 adds step-granular persistence: every completed step is (1) appended to
 * the transcript and (2) snapshotted as a Checkpoint, so an interrupted run
 * can be resumed with `resume(checkpointId)` instead of starting over.
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
  /** M2: last checkpoint written by this run. */
  checkpointId?: string;
  /** M2: when this run continues an earlier one, the checkpoint it replays. */
  parentCheckpointId?: string;
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
  /** M2: checkpoint store. Defaults to one backed by `storage`. */
  checkpoints?: CheckpointStore;
  /** M3: sandbox instance. Defaults to `LocalSandbox` publishing `sandbox:write`. */
  sandbox?: Sandbox;
  /** M3: permission manager. Defaults to one publishing to the runtime bus. */
  permission?: PermissionManager;
  /** M4: artifact store. Defaults to one over `storage`. */
  artifacts?: ArtifactManager;
  /** M3: run-level execution mode (default `workspace-write`, docs §6.0.1). */
  sandboxMode?: SandboxMode;
  /** M3: declared write/network domain (defaults to cwd, no network). */
  scope?: SandboxScope;
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
  /** M2: step snapshots backing `resume()`. */
  readonly checkpoints: CheckpointStore;
  /** M3: governance — authorization decisions for tool calls. */
  readonly permission: PermissionManager;
  /** M4: artifact CRUD (metadata + payload over Storage). */
  readonly artifacts: ArtifactManager;
  private readonly sandbox: Sandbox;
  private readonly sandboxMode: SandboxMode;
  private readonly scope: SandboxScope;
  /** In-process busy guard to keep a single session from concurrent writes. */
  private readonly busy = new Set<string>();

  constructor(options: SessionManagerOptions) {
    this.runtime = options.runtime;
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
    this.checkpoints =
      options.checkpoints ?? new CheckpointStore({ storage: this.storage, now: this.now });
    this.sandbox =
      options.sandbox ??
      new LocalSandbox({
        onWrite: (info) =>
          this.runtime.events.emit({
            type: "sandbox:write",
            runId: info.runId ?? "",
            ...(info.sessionId ? { sessionId: info.sessionId } : {}),
            ...(info.taskId ? { taskId: info.taskId } : {}),
            toolName: info.toolName,
            paths: info.paths,
            ...(info.diff !== undefined ? { diff: info.diff } : {}),
            ok: info.ok,
          }),
      });
    this.permission = options.permission ?? new PermissionManager({ events: this.runtime.events });
    this.artifacts =
      options.artifacts ?? new ArtifactManager({ storage: this.storage, now: this.now });
    this.sandboxMode = options.sandboxMode ?? "workspace-write";
    this.scope = options.scope ?? {
      workspace: process.cwd(),
      writablePaths: [],
      network: "deny",
    };
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

  /** Delete the session and everything attached to it (tasks, runs, messages, checkpoints, facts, artifacts). */
  async deleteSession(id: string): Promise<void> {
    const tasks = await this.storage.listDocs<Task>("task", { sessionId: id });
    const runs = await this.storage.listDocs<RunRecord>("run", { sessionId: id });
    const checkpoints = await this.storage.listDocs<Checkpoint>("checkpoint", { sessionId: id });
    for (const run of runs) await this.storage.deleteDoc("run", run.id);
    for (const task of tasks) await this.storage.deleteDoc("task", task.id);
    for (const checkpoint of checkpoints) {
      await this.storage.deleteDoc("checkpoint", checkpoint.id);
    }
    // M4: artifact metadata rows + their blob payloads.
    const artifacts = await this.storage.listDocs<Artifact>("artifact", { sessionId: id });
    for (const artifact of artifacts) await this.artifacts.remove(artifact.id);
    await this.storage.deleteDoc("session", id);
    await this.storage.deleteDoc("memory", id);
    await this.storage.deleteStream("message", id);
    this.busy.delete(id);
  }

  /** The full persisted transcript of a session (user/assistant/tool turns). */
  async messages(sessionId: string): Promise<ChatMessage[]> {
    return this.memoryFor(sessionId).messages();
  }

  /** Memory facade of a session (M2): transcript + long-term facts. */
  memory(sessionId: string): Memory {
    return this.memoryFor(sessionId);
  }

  /** Checkpoints written for a task, oldest first (M2). */
  async listCheckpoints(taskId: string): Promise<Checkpoint[]> {
    return this.checkpoints.listByTask(taskId);
  }

  // ---------------------------------------------------------- Approvals (M3)

  /** Decisions waiting for the host UI to answer. */
  pendingApprovals() {
    return this.permission.pending();
  }

  /** Approve a pending decision; `always` remembers the tool. */
  approve(decisionId: string, options: { always?: boolean } = {}): boolean {
    return this.permission.approve(decisionId, options);
  }

  /** Reject a pending decision. */
  deny(decisionId: string, reason?: string): boolean {
    return this.permission.deny(decisionId, reason);
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
    const { task, session, agent } = await this.prepareRun(taskId);
    const history = await this.messages(session.id);
    return this.executeRun({ task, session, agent, history, input: task.goal, signal: options.signal });
  }

  /**
   * Continue a task from a persisted checkpoint (M2, docs §9).
   *
   *   resume(ckpt) = load checkpoint → verify the tool fingerprint →
   *                  replay the transcript → keep running the same task
   *
   * `continuation` optionally appends a new user turn; when omitted the run
   * resumes with the checkpoint's original input. Resuming costs at most the
   * steps already snapshotted: an interrupted run finishes where it stopped
   * instead of starting over.
   */
  async resume(
    checkpointId: string,
    continuation?: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<ChatOutcome> {
    const checkpoint = await this.checkpoints.load(checkpointId);
    if (!checkpoint) throw new SessionError(`未知 checkpoint：${checkpointId}`);
    const session = await this.requireOpenSession(checkpoint.sessionId);
    const agent = this.agents.get(session.agentId);
    if (!agent) throw new SessionError(`未知 Agent 配方：${session.agentId}`);
    // A transcript is only meaningful for the tool surface that produced it.
    assertResumable(checkpoint, agent);

    const { task } = await this.prepareRun(checkpoint.taskId);
    const input = continuation?.trim() ? continuation.trim() : checkpoint.input;
    const history = await this.messages(session.id);

    return this.executeRun({
      task,
      session,
      agent,
      history,
      input,
      parentCheckpointId: checkpoint.id,
      initialUsage: checkpoint.usage,
      // No new instruction -> replay the checkpoint's transcript as-is.
      appendUserMessage: Boolean(continuation?.trim()),
      signal: options.signal,
      onRunStart: (runId) =>
        this.runtime.events.emit({
          type: "checkpoint:restored",
          checkpointId: checkpoint.id,
          runId,
          sessionId: session.id,
          taskId: task.id,
          step: checkpoint.step,
        }),
    });
  }

  /** Load + lock everything a run needs (throws if the session is closed/busy). */
  private async prepareRun(taskId: string): Promise<{ task: Task; session: Session; agent: Agent }> {
    const task = await this.storage.loadDoc<Task>("task", taskId);
    if (!task) throw new SessionError(`未知 Task：${taskId}`);
    const session = await this.requireOpenSession(task.sessionId);
    if (this.busy.has(session.id)) {
      throw new SessionError(`会话 ${session.id} 正在运行中，请稍候`);
    }
    const agent = this.agents.get(session.agentId);
    if (!agent) throw new SessionError(`未知 Agent 配方：${session.agentId}`);
    this.busy.add(session.id);
    await this.setSessionStatus(session, "busy");
    await this.patchTask(task, { status: "running", error: undefined });
    return { task, session, agent };
  }

  /**
   * One engine run. Per completed step the host (a) streams the new messages
   * and (b) writes a Checkpoint — the engine itself stays stateless.
   */
  private async executeRun(args: {
    task: Task;
    session: Session;
    agent: Agent;
    history: ChatMessage[];
    input: string;
    parentCheckpointId?: string;
    initialUsage?: RunUsage;
    /** Resume keeps the transcript identical: no extra user turn by default. */
    appendUserMessage?: boolean;
    signal?: AbortSignal;
    onRunStart?: (runId: string) => void;
  }): Promise<ChatOutcome> {
    const { task, session, agent } = args;
    const memory = this.memoryFor(session.id);
    const toolsHash = computeToolsHash(agent);
    const runId = newId("run");
    const startedAt = this.now();
    /** How many leading messages are already durable in the transcript. */
    let persisted = args.history.length;
    let checkpointId: string | undefined;

    args.onRunStart?.(runId);

    // M3: bind the run-level execution domain; every tool gets wrapped so the
    // boundary is enforced per call (docs §6.2).
    const handle = await this.sandbox.begin(this.sandboxMode, this.scope, {
      runId,
      sessionId: session.id,
      taskId: task.id,
    });
    const guardedAgent = defineAgent({
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
      instructions: agent.instructions,
      tools: agent.tools.map((tool) => handle.wrap(tool)),
      maxSteps: agent.maxSteps,
      ...(agent.temperature !== undefined ? { temperature: agent.temperature } : {}),
      ...(agent.maxTokens !== undefined ? { maxTokens: agent.maxTokens } : {}),
    });

    /** M3: the single governance seam — policy decides, sandbox enforces. */
    const gate = async (
      call: { name: string; arguments: unknown }
    ): Promise<{ ok: boolean; reason?: string }> => {
      const definition = agent.tools.find((tool) => tool.name === call.name);
      const verdict = await this.permission.gate(call, {
        runId,
        conversationId: session.id,
        sessionId: session.id,
        taskId: task.id,
        tool: {
          name: call.name,
          kind: definition ? kindOfTool(definition) : classifyToolName(call.name),
        },
        sandboxMode: this.sandboxMode,
        scope: this.scope,
      });
      return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
    };

    const onStepEnd = async (snapshot: StepSnapshot): Promise<void> => {
      // 1) stream whatever this step produced, so a crash loses nothing the
      //    model already saw.
      for (const message of snapshot.messages.slice(persisted)) {
        await memory.append(message);
      }
      persisted = snapshot.messages.length;
      // 2) step-granular checkpoint = the resume point of this run.
      const checkpoint = await this.checkpoints.save({
        runId,
        sessionId: session.id,
        taskId: task.id,
        step: snapshot.step,
        input: args.input,
        messages: snapshot.messages,
        usage: snapshot.usage,
        agentSnapshot: { agentId: agent.name, toolsHash },
      });
      checkpointId = checkpoint.id;
      this.runtime.events.emit({
        type: "checkpoint:saved",
        checkpointId: checkpoint.id,
        runId,
        sessionId: session.id,
        taskId: task.id,
        step: snapshot.step,
      });
    };

    try {
      const result = await this.runtime.run({
        agent: guardedAgent,
        input: args.input,
        history: args.history,
        conversationId: session.id,
        sessionId: session.id,
        taskId: task.id,
        signal: args.signal,
        onStepEnd,
        gate,
        ...(args.appendUserMessage === false ? { appendUserMessage: false } : {}),
        ...(args.initialUsage ? { initialUsage: args.initialUsage } : {}),
      });
      return await this.finishTask({
        task,
        session,
        agent,
        result,
        runId,
        startedAt,
        input: args.input,
        persisted,
        memory,
        checkpointId,
        parentCheckpointId: args.parentCheckpointId,
      });
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
          input: args.input,
          steps: 0,
          output: "",
          usage: args.initialUsage ?? { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
          status: aborted ? "aborted" : "failed",
          stoppedByMaxSteps: false,
          startedAt,
          finishedAt: this.now(),
          ...(checkpointId ? { checkpointId } : {}),
          ...(args.parentCheckpointId ? { parentCheckpointId: args.parentCheckpointId } : {}),
        };
        await this.storage.saveDoc("run", runId, run);
      } finally {
        await this.setSessionStatus(session, "idle");
        this.busy.delete(session.id);
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      await handle.dispose();
    }
  }

  /** Persist the remaining turns, promote the task, emit events. */
  private async finishTask(args: {
    task: Task;
    session: Session;
    agent: Agent;
    result: RunResult;
    runId: string;
    startedAt: number;
    input: string;
    /** Messages already streamed by the step hook. */
    persisted: number;
    memory: SessionMemory;
    checkpointId?: string;
    parentCheckpointId?: string;
  }): Promise<ChatOutcome> {
    const { task, session, agent, result, runId, startedAt, memory } = args;
    // 1) persist the messages this run produced that the step hook has not
    //    streamed yet (the closing assistant turn, or everything when the run
    //    ended inside its first step before a snapshot was taken).
    for (const message of result.messages.slice(args.persisted)) {
      await memory.append(message);
    }

    // 2) run record
    const finishedAt = this.now();
    const run: RunRecord = {
      id: runId,
      taskId: task.id,
      sessionId: session.id,
      agentName: agent.name,
      input: args.input,
      steps: result.steps,
      output: result.output,
      usage: result.usage,
      status: result.stoppedByMaxSteps ? "stopped" : "succeeded",
      stoppedByMaxSteps: result.stoppedByMaxSteps,
      startedAt,
      finishedAt,
      ...(args.checkpointId ? { checkpointId: args.checkpointId } : {}),
      ...(args.parentCheckpointId ? { parentCheckpointId: args.parentCheckpointId } : {}),
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

  /** Memory facade for one session (M2 §8.2): transcript + long-term facts. */
  private memoryFor(sessionId: string): SessionMemory {
    return new SessionMemory({ storage: this.storage, sessionId, now: this.now });
  }

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
