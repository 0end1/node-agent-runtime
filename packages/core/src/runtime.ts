import type { Agent } from "./agent.js";
import { buildRunContext } from "./context.js";
import type { ToolExecutionContext } from "./tool.js";
import {
  EventBus,
  type ModelResponseEvent,
  type RunErrorEvent,
  type RuntimeEvent,
  type ToolEndEvent,
  type ToolStartEvent,
  type UserMessageEvent,
} from "./events.js";
import type { ModelProvider } from "./provider.js";
import { findDuplicateToolNames } from "./tool.js";
import type { AnyTool } from "./tool.js";
import type {
  ChatMessage,
  RunUsage,
  ToolCall,
  ToolResultMessage,
} from "@agent-runtime/types";
import { newId, stringifyResult, validate } from "@agent-runtime/types";

export interface AgentRuntimeOptions {
  /** Chat model backend. */
  provider: ModelProvider;
  /** Optional console logger for server-side traces. */
  logger?: (line: string) => void;
  /**
   * Optional event bus to publish to. Injecting one lets the host own the bus
   * (instead of the runtime creating it internally) — M6 P1 review, P2.
   */
  events?: EventBus<RuntimeEvent>;
}

/**
 * A step-granular view of a run, handed to the host after every step (M2).
 * The host persists it as a Checkpoint; the engine itself stays stateless.
 */
export interface StepSnapshot {
  runId: string;
  /** 1-based index of the step that just completed. */
  step: number;
  /** Full transcript (history + everything produced so far). */
  messages: ChatMessage[];
  /** Usage accumulated up to and including this step. */
  usage: RunUsage;
}

export interface RunOptions {
  agent: Agent;
  /** The user's message for this run. */
  input: string;
  /** Prior conversation to continue from (optional). Not mutated. */
  history?: readonly ChatMessage[];
  /** Identifier grouping this run with a conversation (for tool context). */
  conversationId?: string;
  /** Hosting session id (M1): threaded through to the tool context. */
  sessionId?: string;
  /** Hosting task id (M1): threaded through to the tool context. */
  taskId?: string;
  /** Abort the loop; throws AbortError at the next await point. */
  signal?: AbortSignal;
  /**
   * Called after every completed step (M2). The host uses it to persist a
   * Checkpoint; the engine keeps no snapshot state of its own.
   */
  onStepEnd?: (snapshot: StepSnapshot) => void | Promise<void>;
  /** Usage already accumulated before this run (M2 resume continues the ledger). */
  initialUsage?: RunUsage;
  /**
   * M3: the single governance seam of the run loop (docs §12-4). Called before
   * every tool execution; a negative verdict is fed back to the model as a
   * tool error so it can self-correct. The engine knows nothing about policies,
   * sandboxes or approval UIs.
   */
  gate?: (
    call: { name: string; arguments: unknown },
    ctx: ToolExecutionContext
  ) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * Whether `input` becomes a new user turn in the transcript (default true).
   * M2 resume sets this to false when continuing without a new instruction,
   * so replaying a checkpoint yields the exact transcript an uninterrupted
   * run would have produced.
   */
  appendUserMessage?: boolean;
}

export interface RunResult {
  runId: string;
  agentName: string;
  conversationId: string;
  input: string;
  steps: number;
  /** Full transcript of this run (history + new messages). */
  messages: ChatMessage[];
  /** The final assistant message (natural-language answer). */
  finalMessage: Extract<ChatMessage, { role: "assistant" }>;
  /** Concatenated final answer text. */
  output: string;
  usage: RunUsage;
  stoppedByMaxSteps: boolean;
}

/** Thrown when the run is aborted via AbortSignal. */
export class RunAbortedError extends Error {
  constructor() {
    super("run aborted");
    this.name = "RunAbortedError";
  }
}

const DEFAULT_CONVERSATION = "default";

/**
 * AgentRuntime — the heart of the framework.
 *
 * Executes one agent run as a loop over model round-trips:
 *
 *   while steps < max:
 *     1. call provider with (history + tools)
 *     2. if the model emitted tool calls -> validate & execute each,
 *        append results to history, continue
 *     3. otherwise the answer is complete -> stop
 *
 * Every interesting moment is published to an event bus so that UIs can
 * render the agent's step-by-step reasoning, not just the final answer.
 */
export class AgentRuntime {
  readonly provider: ModelProvider;
  readonly events: EventBus<RuntimeEvent>;
  private readonly logger?: (line: string) => void;

  constructor(options: AgentRuntimeOptions) {
    this.provider = options.provider;
    this.logger = options.logger;
    this.events = options.events ?? new EventBus<RuntimeEvent>();
  }

  /** Subscribe to all runtime lifecycle events. */
  subscribe(listener: (e: RuntimeEvent) => void): () => void {
    return this.events.subscribe(listener);
  }

  async run(options: RunOptions): Promise<RunResult> {
    const runId = newId("run");
    const conversationId = options.conversationId ?? DEFAULT_CONVERSATION;
    const agent = options.agent;
    const input = options.input?.trim() ?? "";
    if (!input) throw new Error("run(): input 不能为空");

    const dupes = findDuplicateToolNames(agent.tools);
    if (dupes.length > 0) {
      throw new Error(`Agent "${agent.name}" 的工具名重复：${dupes.join(", ")}`);
    }

    const toolMap = new Map<string, AnyTool>();
    for (const tool of agent.tools) toolMap.set(tool.name, tool);
    const canUseTools = toolMap.size > 0;

    const history: ChatMessage[] = [...(options.history ?? [])];
    const userMessage: ChatMessage = { role: "user", content: input };
    if (options.appendUserMessage !== false) history.push(userMessage);

    const usage: RunUsage = {
      inputTokens: options.initialUsage?.inputTokens ?? 0,
      outputTokens: options.initialUsage?.outputTokens ?? 0,
      modelCalls: options.initialUsage?.modelCalls ?? 0,
    };
    const stepEvents: StepLedger = { toolStarts: [], toolEnds: [], responses: [] };

    this.emit({ type: "run:start", runId, agentName: agent.name, input });
    if (options.appendUserMessage !== false) {
      this.emit({ type: "message:user", runId, message: userMessage } as UserMessageEvent);
    }
    this.log(`run:start agent=${agent.name} input="${input.slice(0, 60)}"`);

    const startedAt = Date.now();
    let lastAssistant: Extract<ChatMessage, { role: "assistant" }> | null = null;
    let stoppedByMaxSteps = false;

    const requestTools = canUseTools ? [...toolMap.values()] : undefined;

    try {
      for (let step = 1; step <= agent.maxSteps; step++) {
        this.emit({ type: "step:start", runId, step });
        this.log(`  step ${step} -> provider "${this.provider.id}" (messages=${history.length})`);

        const response = await this.provider.chat({
          messages: history,
          tools: requestTools,
          system: agent.instructions,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          signal: options.signal,
        });

        if (options.signal?.aborted) throw new RunAbortedError();

        usage.modelCalls += 1;
        if (response.usage) {
          usage.inputTokens += response.usage.inputTokens;
          usage.outputTokens += response.usage.outputTokens;
        }

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: response.content ?? "",
          ...(response.toolCalls.length > 0
            ? { toolCalls: response.toolCalls.map((tc) => parseToolCall(tc, this.provider.id)) }
            : {}),
        };
        const modelEvent: ModelResponseEvent = {
          type: "model:response",
          runId,
          step,
          message: assistantMsg,
        };
        this.emit(modelEvent);
        stepEvents.responses.push(modelEvent);
        lastAssistant = assistantMsg;
        history.push(assistantMsg);

        const toolCalls = response.toolCalls;
        if (toolCalls.length === 0) {
          // Natural end: the model answered. Snapshot once more so the final
          // answer is replayable and a follow-up can resume from this state.
          await this.snapshotStep(options, runId, step, history, usage);
          break;
        }

        // Execute tool calls (sequentially, feeding results back).
        const assistantWithCalls = assistantMsg as Extract<ChatMessage, { role: "assistant" }> & {
          toolCalls: ToolCall[];
        };
        for (const rawCall of toolCalls) {
          const parsed = (assistantWithCalls.toolCalls ?? []).find(
            (tc) => tc.id === rawCall.id
          ) ?? parseToolCall(rawCall, this.provider.id);

          const startEvt: ToolStartEvent = {
            type: "tool:start",
            runId,
            step,
            toolCall: { id: parsed.id, name: parsed.name, arguments: parsed.arguments },
          };
          this.emit(startEvt);
          stepEvents.toolStarts.push(startEvt);
          this.log(`    tool:start ${parsed.name} ${JSON.stringify(parsed.arguments).slice(0, 120)}`);

          const toolStartMs = Date.now();
          const ctx = buildRunContext({
            runId,
            conversationId,
            ...(options.sessionId ? { sessionId: options.sessionId } : {}),
            ...(options.taskId ? { taskId: options.taskId } : {}),
          });
          const outcome = await this.executeTool(toolMap, parsed, ctx, options.gate);

          const endEvt: ToolEndEvent = {
            type: "tool:end",
            runId,
            step,
            toolCall: { id: parsed.id, name: parsed.name, arguments: parsed.arguments },
            result: outcome.content,
            durationMs: Date.now() - toolStartMs,
            ok: outcome.ok,
          };
          this.emit(endEvt);
          stepEvents.toolEnds.push(endEvt);
          this.log(`    tool:end ${parsed.name} ok=${outcome.ok} ${outcome.content.slice(0, 120)}`);

          const toolResult: ToolResultMessage = {
            role: "tool",
            toolCallId: parsed.id,
            content: outcome.content,
          };
          history.push(toolResult);
        }

        await this.snapshotStep(options, runId, step, history, usage);
      }
      // Exhausted steps without the model finishing -> leave a graceful marker.
      const finishedNaturally = history.at(-1)?.role !== "tool";
      if (!finishedNaturally || !lastAssistant) {
        stoppedByMaxSteps = !finishedNaturally;
        if (stoppedByMaxSteps && history.at(-1)?.role === "tool") {
          const note: ChatMessage = {
            role: "assistant",
            content: `已达到最大步数（${agent.maxSteps}）仍未收敛，已停止。可以追问来继续。`,
          };
          history.push(note);
          lastAssistant = note;
          this.emit({ type: "model:response", runId, step: agent.maxSteps, message: note });
        }
      }
      if (!lastAssistant) {
        // extremely defensive: provider returned nothing at all
        lastAssistant = { role: "assistant", content: "（模型未返回任何内容）" };
        history.push(lastAssistant);
      }
    } catch (err) {
      if (err instanceof RunAbortedError || (err instanceof Error && err.name === "AbortError")) {
        const abortedEvent: RunErrorEvent = {
          type: "run:error",
          runId,
          step: null,
          error: "run aborted",
        };
        this.emit(abortedEvent);
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: "run:error", runId, step: history.length, error: message } as RunErrorEvent);
      this.log(`  run:error ${message}`);
      throw err instanceof Error ? err : new Error(message);
    }

    const result: RunResult = {
      runId,
      agentName: agent.name,
      conversationId,
      input,
      steps: usage.modelCalls,
      messages: history,
      finalMessage: lastAssistant,
      output: lastAssistant.content ?? "",
      usage,
      stoppedByMaxSteps,
    };
    this.emit({
      type: "run:end",
      runId,
      steps: usage.modelCalls,
      output: result.output,
      usage,
      stoppedByMaxSteps,
    });
    this.log(
      `run:end steps=${usage.modelCalls} tokens=${usage.inputTokens}+${usage.outputTokens} elapsed=${Date.now() - startedAt}ms stoppedByMaxSteps=${stoppedByMaxSteps}`
    );
    return result;
  }

  /** Publish a per-step snapshot to the host (M2 checkpoint hook). */
  private async snapshotStep(
    options: RunOptions,
    runId: string,
    step: number,
    history: ChatMessage[],
    usage: RunUsage
  ): Promise<void> {
    if (!options.onStepEnd) return;
    await options.onStepEnd({
      runId,
      step,
      messages: [...history],
      usage: { ...usage },
    });
  }

  private async executeTool(
    toolMap: Map<string, AnyTool>,
    call: ToolCall,
    ctx: ToolExecutionContext,
    gate?: RunOptions["gate"]
  ): Promise<{ content: string; ok: boolean }> {
    // M3: authorization happens before anything else — a denied call never
    // reaches the tool, and the model is told why so it can adapt.
    if (gate) {
      const verdict = await gate({ name: call.name, arguments: call.arguments }, ctx);
      if (!verdict.ok) {
        return {
          content: JSON.stringify({
            error: `工具调用未获授权：${verdict.reason ?? "策略拒绝"}`,
            denied: true,
          }),
          ok: false,
        };
      }
    }

    const tool = toolMap.get(call.name);
    if (!tool) {
      return {
        content: JSON.stringify({ error: `未知工具 "${call.name}"。可用工具：${[...toolMap.keys()].join(", ")}` }),
        ok: false,
      };
    }
    if (tool.parameters) {
      const errors = validate(call.arguments, tool.parameters);
      if (errors.length > 0) {
        return {
          content: JSON.stringify({
            error: `工具参数校验失败：${errors.join("；")}`,
            // echo schema so a real model can self-correct on the next round
            hint: tool.parameters,
          }),
          ok: false,
        };
      }
    }
    try {
      const result = await tool.execute(call.arguments as never, ctx);
      return { content: stringifyResult(result), ok: true };
    } catch (err) {
      return {
        content: JSON.stringify({
          error: `工具执行异常：${err instanceof Error ? err.message : String(err)}`,
        }),
        ok: false,
      };
    }
  }

  private emit(event: RuntimeEvent): void {
    this.events.emit(event);
  }

  private log(line: string): void {
    this.logger?.(line);
  }
}

interface StepLedger {
  responses: ModelResponseEvent[];
  toolStarts: ToolStartEvent[];
  toolEnds: ToolEndEvent[];
}

/** Parse a raw provider tool call into a validated JSON-argument ToolCall. */
function parseToolCall(
  raw: { id: string; name: string; arguments: string },
  providerId: string
): ToolCall {
  let argumentsObj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw.arguments || "{}") as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      argumentsObj = parsed as Record<string, unknown>;
    } else if (parsed !== null && typeof parsed === "object") {
      argumentsObj = parsed as Record<string, unknown>;
    } else {
      argumentsObj = { value: parsed };
    }
  } catch {
    // LLM emitted malformed JSON arguments; surface it so the tool layer
    // (or the model itself on retry) can recover gracefully.
    argumentsObj = {
      _parseError: true,
      _rawArguments: String(raw.arguments ?? "").slice(0, 500),
    };
  }
  if (!raw.id || !raw.name) {
    throw new Error(`provider "${providerId}" 返回了不完整的工具调用（缺少 id 或 name）`);
  }
  return { id: raw.id, name: raw.name, arguments: argumentsObj };
}
