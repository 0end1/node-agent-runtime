import { resolve } from "node:path";
import {
  AgentRuntime,
  EventBus,
  MemoryStorage,
  RunAbortedError,
  type Agent,
  type ModelProvider,
  type RuntimeEvent,
} from "@node-agent-runtime/core";
import { SessionManager, StorageApprovalStore } from "@node-agent-runtime/host";
import {
  DefaultPermissionPolicy,
  type PermissionPolicy,
} from "@node-agent-runtime/policy";
import type { Sandbox, SandboxMode } from "@node-agent-runtime/sandbox";
import type { ChatMessage, Storage } from "@node-agent-runtime/types";
import { AcpConnection, type MethodHandler, type NotificationHandler } from "./connection.js";
import { NoAskPolicy } from "./policy.js";
import {
  ACP_PROTOCOL_VERSION,
  promptToText,
  type AgentCapabilities,
  type CancelParams,
  type CloseSessionParams,
  type ImplementationInfo,
  type InitializeParams,
  type InitializeResult,
  type LoadSessionParams,
  type NewSessionParams,
  type NewSessionResult,
  type PromptParams,
  type PromptResult,
  type SessionUpdateParams,
} from "./protocol.js";
import { StdioTransport, type AcpTransport } from "./transport.js";
import { translateEvent } from "./update.js";

export interface AcpAgentOptions {
  /** Chat model backend shared by every session. */
  provider: ModelProvider;
  /** Agent recipes a session can bind to (`session/new` picks one). */
  agents: readonly Agent[];
  /** Session/task/run persistence. Defaults to an in-memory store. */
  storage?: Storage;
  /** Recipe used when the client does not name one via `_meta.agentId`. */
  defaultAgentId?: string;
  /** Run-level execution mode (docs/architecture.md §6.0.1). */
  sandboxMode?: SandboxMode;
  sandbox?: Sandbox;
  /** Authorization policy. M8-2 wraps it so `ask` degrades to `deny`. */
  policy?: PermissionPolicy;
  /** Advertised in `initialize`. */
  agentInfo?: ImplementationInfo;
  /** Diagnostics sink — must be stderr; stdout carries ACP messages only. */
  logger?: (line: string) => void;
}

interface SessionContext {
  sessionId: string;
  cwd: string;
  bus: EventBus<RuntimeEvent>;
  manager: SessionManager;
  controller?: AbortController;
}

const defaultLogger = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * An ACP v1 agent backed by the runtime (M8-2).
 *
 * Lifecycle mapping (docs/product-build-paths.md §2.1):
 *
 *   initialize      → protocol version + capability negotiation
 *   session/new     → SessionManager.createSession (cwd → sandbox workspace root)
 *   session/prompt  → SessionManager.chat + EventBus → session/update notifications
 *   session/cancel  → AbortSignal → `cancelled` stop reason
 *   session/load    → replay the persisted transcript as message chunks
 *   session/close   → abort + closeSession
 *
 * Each session gets its own runtime + event bus. Sessions therefore never see
 * each other's events (the runtime bus is process-wide; a shared bus would mix
 * concurrent turns together), and per-session state — sandbox scope, pending
 * approvals — stays isolated.
 */
export class AcpAgent {
  private readonly provider: ModelProvider;
  private readonly agents: readonly Agent[];
  private readonly storage: Storage;
  private readonly defaultAgentId?: string;
  private readonly sandboxMode: SandboxMode;
  private readonly sandbox?: Sandbox;
  private readonly policy: PermissionPolicy;
  private readonly agentInfo: ImplementationInfo;
  private readonly logger: (line: string) => void;
  private readonly sessions = new Map<string, SessionContext>();
  private connection?: AcpConnection;

  constructor(options: AcpAgentOptions) {
    this.provider = options.provider;
    this.agents = options.agents;
    this.storage = options.storage ?? new MemoryStorage();
    this.defaultAgentId = options.defaultAgentId;
    this.sandboxMode = options.sandboxMode ?? "workspace-write";
    this.sandbox = options.sandbox;
    this.policy = new NoAskPolicy(options.policy ?? new DefaultPermissionPolicy());
    this.agentInfo = options.agentInfo ?? {
      name: "node-agent-runtime",
      title: "Node Agent Runtime",
      version: "0.4.2",
    };
    this.logger = options.logger ?? defaultLogger;
  }

  /** Start serving on stdio (or any injected transport). */
  async start(transport: AcpTransport = new StdioTransport({ logger: this.logger })): Promise<void> {
    this.connection = new AcpConnection(transport, {
      methods: this.methods(),
      notifications: this.notifications(),
      logger: this.logger,
    });
    this.connection.start();
  }

  stop(): void {
    for (const context of this.sessions.values()) context.controller?.abort();
    this.sessions.clear();
    this.connection?.close();
    this.connection = undefined;
  }

  // ------------------------------------------------------------- method table

  private methods(): Record<string, MethodHandler> {
    return {
      initialize: (params) => this.initialize(params as InitializeParams),
      "session/new": (params) => this.newSession(params as NewSessionParams),
      "session/prompt": (params) => this.prompt(params as PromptParams),
      "session/load": (params) => this.loadSession(params as LoadSessionParams),
      "session/close": (params) => this.closeSession(params as CloseSessionParams),
    };
  }

  private notifications(): Record<string, NotificationHandler> {
    return {
      "session/cancel": (params) => this.cancel(params as CancelParams),
    };
  }

  // ------------------------------------------------------------------ methods

  /** Version + capability negotiation (docs/acp-spec-review.md §3). */
  initialize(params: InitializeParams): InitializeResult {
    const requested = params?.protocolVersion;
    if (typeof requested !== "number") {
      throw AcpConnection.invalidParams("initialize 需要 protocolVersion");
    }
    if (requested !== ACP_PROTOCOL_VERSION) {
      this.logger(`[acp] client asked for v${requested}, serving v${ACP_PROTOCOL_VERSION}`);
    }
    const capabilities: AgentCapabilities = {
      loadSession: true,
      // promptCapabilities omitted: image / audio / embeddedContext all default
      // to false, which is exactly what this adapter accepts today.
      sessionCapabilities: { close: {} },
    };
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: capabilities,
      agentInfo: this.agentInfo,
      authMethods: [],
    };
  }

  async newSession(params: NewSessionParams): Promise<NewSessionResult> {
    const cwd = this.requireAbsoluteCwd(params?.cwd);
    const agentId = params?._meta?.agentId ?? this.defaultAgentId ?? this.agents[0]?.name;
    if (!agentId) throw AcpConnection.invalidParams("没有可用的 Agent 配方");
    const context = this.createContext(cwd);
    const session = await context.manager.createSession({ agentId });
    context.sessionId = session.id;
    this.sessions.set(session.id, context);
    return { sessionId: session.id };
  }

  /**
   * One full prompt turn: stream updates, run the loop, return a stop reason.
   *
   * Cancellation is not an error path — ACP requires the agent to catch the
   * abort and answer with `cancelled` so clients can confirm it cleanly.
   */
  async prompt(params: PromptParams): Promise<PromptResult> {
    const sessionId = params?.sessionId;
    const context = this.sessions.get(sessionId);
    if (!context) throw AcpConnection.invalidParams(`未知会话：${sessionId}`);
    const text = promptToText(params.prompt);
    if (!text) throw AcpConnection.invalidParams("prompt 不能为空");

    const controller = new AbortController();
    context.controller = controller;
    const unsubscribe = context.bus.subscribe((event) => this.forward(context, event));
    try {
      const outcome = await context.manager.chat(sessionId, text, { signal: controller.signal });
      return {
        stopReason: outcome.run.stoppedByMaxSteps ? "max_turn_requests" : "end_turn",
      };
    } catch (error) {
      if (isAbort(error)) return { stopReason: "cancelled" };
      throw error;
    } finally {
      unsubscribe();
      context.controller = undefined;
    }
  }

  cancel(params: CancelParams): void {
    const context = this.sessions.get(params?.sessionId);
    if (!context) return;
    context.controller?.abort();
  }

  /** Replay a persisted transcript so a client can re-attach to a session. */
  async loadSession(params: LoadSessionParams): Promise<null> {
    const sessionId = params?.sessionId;
    const existing = this.sessions.get(sessionId);
    const context = existing ?? this.createContext(this.requireAbsoluteCwd(params?.cwd));
    const session = await context.manager.getSession(sessionId);
    if (!session) throw AcpConnection.invalidParams(`未知会话：${sessionId}`);
    context.sessionId = sessionId;
    this.sessions.set(sessionId, context);

    const messages = await context.manager.messages(sessionId);
    for (const message of messages) {
      for (const update of replayMessage(message)) {
        this.sendUpdate(sessionId, update);
      }
    }
    return null;
  }

  async closeSession(params: CloseSessionParams): Promise<Record<string, never>> {
    const sessionId = params?.sessionId;
    const context = this.sessions.get(sessionId);
    if (!context) throw AcpConnection.invalidParams(`未知会话：${sessionId}`);
    context.controller?.abort();
    await context.manager.closeSession(sessionId);
    this.sessions.delete(sessionId);
    return {};
  }

  // ------------------------------------------------------------------ helpers

  private createContext(cwd: string): SessionContext {
    const bus = new EventBus<RuntimeEvent>();
    const runtime = new AgentRuntime({ provider: this.provider, events: bus });
    const manager = new SessionManager({
      runtime,
      storage: this.storage,
      agents: this.agents,
      events: bus,
      sandboxMode: this.sandboxMode,
      scope: { workspace: cwd, writablePaths: [], network: "deny" },
      policy: this.policy,
      ...(this.sandbox ? { sandbox: this.sandbox } : {}),
      approvalStore: new StorageApprovalStore(this.storage),
    });
    return { sessionId: "", cwd, bus, manager };
  }

  private forward(context: SessionContext, event: RuntimeEvent): void {
    for (const update of translateEvent(event)) {
      this.sendUpdate(context.sessionId, update);
    }
  }

  private sendUpdate(sessionId: string, update: SessionUpdateParams["update"]): void {
    if (!this.connection) return;
    const params: SessionUpdateParams = { sessionId, update };
    this.connection.notify("session/update", params);
  }

  private requireAbsoluteCwd(cwd: string | undefined): string {
    if (typeof cwd !== "string" || !cwd.trim()) {
      throw AcpConnection.invalidParams("cwd 必填且必须是绝对路径");
    }
    return resolve(cwd);
  }
}

/**
 * Aborts reach us in two shapes: the runtime's own `RunAbortedError`, and the
 * `AbortError` that provider SDKs (and `fetch`) raise when a request is
 * cancelled mid-flight. ACP calls this out explicitly — the agent MUST catch
 * both and answer `cancelled`, because clients surface unrecognised errors to
 * the user and a cancellation is not an error.
 */
function isAbort(error: unknown): boolean {
  return (
    error instanceof RunAbortedError || (error instanceof Error && error.name === "AbortError")
  );
}

/** Persisted turn → the message chunks a client needs to rebuild the view. */
function replayMessage(message: ChatMessage): SessionUpdateParams["update"][] {
  if (message.role === "user") {
    return [{ sessionUpdate: "user_message_chunk", content: { type: "text", text: message.content } }];
  }
  if (message.role === "assistant") {
    return message.content.trim()
      ? [
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: message.content },
          },
        ]
      : [];
  }
  // Tool results are already surfaced through tool_call updates on their turn.
  return [];
}
