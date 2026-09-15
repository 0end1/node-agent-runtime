import type { Agent } from "./agent.js";
import { buildRunContext } from "./context.js";
import { ToolIndex, createToolSearchTool } from "./tool-search.js";
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
import type { ChatMessage, PriceTable, RunUsage, ToolCall, ToolResultMessage } from "@node-agent-runtime/types";
import type { LimitViolation, RunLimits } from "@node-agent-runtime/types";
import {
  newId,
  stringifyResult,
  usageCost,
  validate,
  ErrorCode,
  errorInfo,
  checkRunLimits,
} from "@node-agent-runtime/types";
import { compactMessages, countMessagesTokens, type ContextBudget } from "@node-agent-runtime/memory";
import { toLogger, redact, type Logger } from "./log.js";

export interface AgentRuntimeOptions {
  /** Chat model backend. */
  provider: ModelProvider;
  /** Optional structured logger for server-side traces (P3.1). Accepts a `Logger`
   *  or the legacy `(line: string) => void` callback. */
  logger?: Logger | ((line: string) => void);
  /**
   * Optional event bus to publish to. Injecting one lets the host own the bus
   * (instead of the runtime creating it internally) — M6 P1 review, P2.
   */
  events?: EventBus<RuntimeEvent>;
  /**
   * P3.4: default budget guardrails for every run. Per-run `RunOptions.limits`
   * are merged on top of these (per-run wins).
   */
  limits?: RunLimits;
  /**
   * M7-1: default cost meter price table for every run. Per-run `RunOptions.pricing`
   * overrides it. Has priority over any `RunOptions.costUsd` hook.
   */
  pricing?: PriceTable;
  /**
   * M7-1: default context budget for long-context compaction. Per-run `RunOptions.context`
   * overrides it.
   */
  context?: ContextBudget;
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
  /**
   * M7-6a: the tool surface of this step — what was declared to the model and
   * what was actually executed. Independent of `toolsHash` (which fingerprints
   * the agent recipe for resume safety); used for audit/replay reconciliation.
   */
  toolSurface?: { declared: readonly string[]; used: readonly string[] };
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
    ctx: ToolExecutionContext,
  ) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * M7-6a: 检索式工具声明预算（opt-in，默认关闭）。
   * `search: true` 且工具数 > `maxDeclared` 时，仅向模型声明 `maxDeclared` 个工具
   * + `tool_search` 元工具，其余工具仍可通过 `tool_search` 发现后按名调用（权限面不变）。
   */
  toolBudget?: { maxDeclared?: number; search?: boolean };
  /**
   * Whether `input` becomes a new user turn in the transcript (default true).
   * M2 resume sets this to false when continuing without a new instruction,
   * so replaying a checkpoint yields the exact transcript an uninterrupted
   * run would have produced.
   */
  appendUserMessage?: boolean;
  /**
   * P3.4: budget guardrails for this run (merged over `AgentRuntimeOptions.limits`).
   * Exceeding any cap aborts the run with `LimitExceededError` and publishes a
   * `run:error` carrying `code: "limit_exceeded"`.
   */
  limits?: RunLimits;
  /**
   * Optional cost meter: return the estimated USD spend so far. Required for
   * `limits.maxCostUsd`; without it the cost cap is simply not evaluated.
   */
  costUsd?: (usage: RunUsage) => number | undefined;
  /**
   * M7-2: trace correlation id for this run. Defaults to a generated
   * `newId("trace")`. Every event the run emits carries it, so one run's
   * events can be stitched into a single trace (and told apart from
   * concurrent runs on the same runtime instance).
   */
  /**
   * M7-1: built-in cost meter price table for this run (overrides the runtime
   * default). Has priority over the `costUsd` hook.
   */
  pricing?: PriceTable;
  /**
   * M7-1: context budget for long-context compaction of this run (overrides the
   * runtime default).
   */
  context?: ContextBudget;
  traceId?: string;
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
  /** M7-2: trace correlation id of this run (echoes `RunOptions.traceId`). */
  traceId: string;
}

/** Thrown when the run is aborted via AbortSignal. */
export class RunAbortedError extends Error {
  readonly code = ErrorCode.RUN_ABORTED;
  constructor() {
    super("run aborted");
    this.name = "RunAbortedError";
  }
}

/** Thrown when a run/session budget or tool rate cap is hit (P3.4). */
export class LimitExceededError extends Error {
  readonly code = ErrorCode.LIMIT_EXCEEDED;
  readonly violation: LimitViolation;
  constructor(violation: LimitViolation) {
    super(violation.message);
    this.name = "LimitExceededError";
    this.violation = violation;
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
  private readonly logger?: Logger;
  private readonly defaultLimits?: RunLimits;
  private readonly pricing?: PriceTable;
  private readonly contextBudget?: ContextBudget;

  constructor(options: AgentRuntimeOptions) {
    this.provider = options.provider;
    this.logger = toLogger(options.logger);
    this.events = options.events ?? new EventBus<RuntimeEvent>();
    this.defaultLimits = options.limits;
    this.pricing = options.pricing;
    this.contextBudget = options.context;
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

    // M7-6a: 检索式工具声明（opt-in）。构建全量索引；仅当开启检索且工具数超过
    // `maxDeclared` 时，才向 provider 注入 `tool_search` 元工具并裁剪「声明面」。
    // `toolMap` 始终保留全量，故未声明但被模型显式调用的工具仍能执行（gate/sandbox 不变）。
    const budget = options.toolBudget;
    const maxDeclared = budget?.maxDeclared ?? 50;
    const searchEnabled = budget?.search ?? false;
    const toolIndex = new ToolIndex(toolMap.values());
    let searchTool: AnyTool | undefined;
    if (searchEnabled && toolMap.size > maxDeclared) {
      searchTool = createToolSearchTool(toolIndex);
      toolMap.set(searchTool.name, searchTool); // 让 executeTool 能按名找到它
    }
    const realTools = [...toolMap.values()].filter((t) => t !== searchTool);
    const declaredTools = searchTool
      ? [...realTools.slice(0, maxDeclared), searchTool]
      : realTools;
    const declaredNames = declaredTools.map((t) => t.name);
    const requestTools = declaredTools.length > 0 ? declaredTools : undefined;
    // 本步实际执行的工具（含 tool_search 本身），用于 toolSurface 快照。
    const usedTools = new Set<string>();

    let history: ChatMessage[] = [...(options.history ?? [])];
    const userMessage: ChatMessage = { role: "user", content: input };
    if (options.appendUserMessage !== false) history.push(userMessage);

    const usage: RunUsage = {
      inputTokens: options.initialUsage?.inputTokens ?? 0,
      outputTokens: options.initialUsage?.outputTokens ?? 0,
      modelCalls: options.initialUsage?.modelCalls ?? 0,
      ...(options.initialUsage?.cachedInputTokens !== undefined
        ? { cachedInputTokens: options.initialUsage.cachedInputTokens }
        : {}),
      ...(options.initialUsage?.costUsd !== undefined ? { costUsd: options.initialUsage.costUsd } : {}),
    };
    // M7-1: 内置计量与上下文压缩的配置（per-run 覆盖 runtime 默认值）。
    const pricing = options.pricing ?? this.pricing;
    const contextBudget = options.context ?? this.contextBudget;
    const stepEvents: StepLedger = { toolStarts: [], toolEnds: [], responses: [] };

    // M7-2: 一次 run 一个 traceId —— 缺省由引擎生成，宿主可注入以对齐外部链路。
    // 注入点收口在 `emit`（与 `redact()` 同处），保证「一处注入、全局一致」；
    // 用 run 内闭包而非实例字段，故同一 runtime 上的并发 run 互不串扰。
    const traceId = options.traceId ?? newId("trace");
    const emit = (event: RuntimeEvent): void => this.emit(event, traceId);
    const logger = this.logger?.child?.({ traceId, runId }) ?? this.logger;
    const log = (line: string, meta?: unknown): void => logger?.info(line, meta);
    const startedAt = Date.now();

    emit({ type: "run:start", runId, agentName: agent.name, input, startedAt });
    if (options.appendUserMessage !== false) {
      emit({ type: "message:user", runId, message: userMessage } as UserMessageEvent);
    }
    log(`run:start agent=${agent.name} input="${input.slice(0, 60)}"`);

    let lastAssistant: Extract<ChatMessage, { role: "assistant" }> | null = null;
    let stoppedByMaxSteps = false;

    // P3.4: per-run limits are merged over the runtime defaults (per-run wins).
    const limits: RunLimits = { ...(this.defaultLimits ?? {}), ...(options.limits ?? {}) };
    // The loop bound stays `agent.maxSteps` (a soft "stop converging here").
    // `limits.maxSteps` is a **budget**: tripping it must surface as a
    // `run:error` with `code: limit_exceeded` on the step that goes over,
    // not as an ordinary end-of-loop result.
    const maxSteps = agent.maxSteps;
    const toolCallTimes: number[] = [];
    const assertWithinLimits = (step: number): void => {
      const violation = checkRunLimits(
        usage,
        {
          steps: step,
          elapsedMs: Date.now() - startedAt,
          ...(usage.costUsd !== undefined
            ? { costUsd: usage.costUsd }
            : options.costUsd
              ? { costUsd: options.costUsd(usage) }
              : {}),
          toolCallTimes,
        },
        limits,
      );
      if (violation) throw new LimitExceededError(violation);
    };



    try {
      for (let step = 1; step <= maxSteps; step++) {
        // P3.4: budget check before every model round-trip (duration / tokens / cost).
        assertWithinLimits(step);
        // M7-1: 上下文预算触发压缩（确定性纯函数，零依赖）。压缩发生在 provider
        // 调用之前，保证送入模型的 history 始终在预算内。
        if (contextBudget?.maxInputTokens !== undefined) {
          const used = countMessagesTokens(history);
          if (used > contextBudget.maxInputTokens) {
            const compacted = compactMessages(history, contextBudget);
            history = compacted.messages;
            emit({
              type: "context:compacted",
              runId,
              step,
              removed: compacted.removed,
              estimatedTokens: compacted.estimatedTokens,
            });
          }
        }
        emit({ type: "step:start", runId, step, declaredTools: declaredNames });
        log(`  step ${step} -> provider "${this.provider.id}" (messages=${history.length})`);

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
          if (response.usage.cachedInputTokens) {
            usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + response.usage.cachedInputTokens;
          }
        }
        // M7-1: 内置计量（脱钩宿主钩子）。优先级 pricing > costUsd 钩子。
        let cost: number | undefined;
        if (pricing) cost = usageCost(usage, pricing);
        else if (options.costUsd) cost = options.costUsd(usage);
        if (cost !== undefined) usage.costUsd = cost;

        // M7-1: 用量/成本更新后再做一次预算校验，使 maxCostUsd 在成本已知后生效
        // （step 开头的校验发生在 provider 返回之前，此时 costUsd 尚未算出）。
        assertWithinLimits(step);

        // M7-1: step 级用量/成本/上下文事件（审计与计费对账用）。
        const contextUsed = contextBudget ? countMessagesTokens(history) : undefined;
        emit({
          type: "usage:update",
          runId,
          step,
          usage: { ...usage },
          ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
          ...(contextUsed !== undefined ? { contextUsed } : {}),
          ...(contextBudget?.contextWindow !== undefined ? { contextSize: contextBudget.contextWindow } : {}),
        });

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
        emit(modelEvent);
        stepEvents.responses.push(modelEvent);
        lastAssistant = assistantMsg;
        history.push(assistantMsg);

        const toolCalls = response.toolCalls;
        if (toolCalls.length === 0) {
          // Natural end: the model answered. Snapshot once more so the final
          // answer is replayable and a follow-up can resume from this state.
          await this.snapshotStep(options, runId, step, history, usage, declaredNames, [...usedTools]);
          break;
        }

        // Execute tool calls (sequentially, feeding results back).
        const assistantWithCalls = assistantMsg as Extract<ChatMessage, { role: "assistant" }> & {
          toolCalls: ToolCall[];
        };
        for (const rawCall of toolCalls) {
          const parsed =
            (assistantWithCalls.toolCalls ?? []).find((tc) => tc.id === rawCall.id) ??
            parseToolCall(rawCall, this.provider.id);

          // P3.4: 工具调用速率（滑动窗口）——先记账再判定，超限即中止本轮。
          toolCallTimes.push(Date.now());
          assertWithinLimits(step);

          const startEvt: ToolStartEvent = {
            type: "tool:start",
            runId,
            step,
            // P3.2: 事件流脱敏——参数含 key/secret 时仅对订阅者暴露脱敏值；
            // 真实参数仍经 gate/沙箱/工具执行（不走事件）安全使用。
            toolCall: {
              id: parsed.id,
              name: parsed.name,
              arguments: redact(parsed.arguments) as Record<string, unknown>,
            },
          };
          emit(startEvt);
          stepEvents.toolStarts.push(startEvt);
          log(`    tool:start ${parsed.name}`, redact(parsed.arguments));

          const toolStartMs = Date.now();
          const ctx = buildRunContext({
            runId,
            conversationId,
            ...(options.sessionId ? { sessionId: options.sessionId } : {}),
            ...(options.taskId ? { taskId: options.taskId } : {}),
          });
          const outcome = await this.executeTool(toolMap, parsed, ctx, options.gate);
          usedTools.add(parsed.name);

          const endEvt: ToolEndEvent = {
            type: "tool:end",
            runId,
            step,
            // P3.2: 脱敏事件参数（理由同 tool:start）。
            toolCall: {
              id: parsed.id,
              name: parsed.name,
              arguments: redact(parsed.arguments) as Record<string, unknown>,
            },
            // 工具结果同样可能回显凭据/文件内容，事件侧只暴露脱敏后的值。
            result: redact(outcome.content) as string,
            durationMs: Date.now() - toolStartMs,
            ok: outcome.ok,
          };
          emit(endEvt);
          stepEvents.toolEnds.push(endEvt);
          log(`    tool:end ${parsed.name} ok=${outcome.ok} ${outcome.content.slice(0, 120)}`);

          const toolResult: ToolResultMessage = {
            role: "tool",
            toolCallId: parsed.id,
            content: outcome.content,
          };
          history.push(toolResult);
        }

        await this.snapshotStep(options, runId, step, history, usage, declaredNames, [...usedTools]);
      }
      // Exhausted steps without the model finishing -> leave a graceful marker.
      const finishedNaturally = history.at(-1)?.role !== "tool";
      if (!finishedNaturally || !lastAssistant) {
        stoppedByMaxSteps = !finishedNaturally;
        if (stoppedByMaxSteps && history.at(-1)?.role === "tool") {
          const note: ChatMessage = {
            role: "assistant",
            content: `已达到最大步数（${maxSteps}）仍未收敛，已停止。可以追问来继续。`,
          };
          history.push(note);
          lastAssistant = note;
          emit({ type: "model:response", runId, step: maxSteps, message: note });
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
          // P3.1: 事件携带稳定错误码，UI/CLI/日志可按 code 分支而不必匹配文案。
          code: ErrorCode.RUN_ABORTED,
        };
        emit(abortedEvent);
        throw err;
      }
      const info = errorInfo(err);
      emit({
        type: "run:error",
        runId,
        step: history.length,
        error: info.message,
        code: info.code,
      } as RunErrorEvent);
      logger?.error(`run:error [${info.code}] ${info.message}`);
      throw err instanceof Error ? err : new Error(info.message);
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
      traceId,
    };
    emit({
      type: "run:end",
      runId,
      steps: usage.modelCalls,
      output: result.output,
      usage,
      stoppedByMaxSteps,
      endedAt: Date.now(),
    });
    log(
      `run:end steps=${usage.modelCalls} tokens=${usage.inputTokens}+${usage.outputTokens} elapsed=${Date.now() - startedAt}ms stoppedByMaxSteps=${stoppedByMaxSteps}`,
    );
    return result;
  }

  /** Publish a per-step snapshot to the host (M2 checkpoint hook). */
  private async snapshotStep(
    options: RunOptions,
    runId: string,
    step: number,
    history: ChatMessage[],
    usage: RunUsage,
    declared: readonly string[],
    used: readonly string[],
  ): Promise<void> {
    if (!options.onStepEnd) return;
    await options.onStepEnd({
      runId,
      step,
      messages: [...history],
      usage: { ...usage },
      toolSurface: { declared: [...declared], used: [...used] },
    });
  }

  private async executeTool(
    toolMap: Map<string, AnyTool>,
    call: ToolCall,
    ctx: ToolExecutionContext,
    gate?: RunOptions["gate"],
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
        content: JSON.stringify({
          error: `未知工具 "${call.name}"。可用工具：${[...toolMap.keys()].join(", ")}`,
        }),
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

  /**
   * M7-2: 事件出口的唯一收口点 —— traceId 注入与 `redact()` 同处，因此两者都
   * 不可能被绕过（「一处注入、全局一致」）。traceId 由 run 内闭包传入而非实例
   * 字段，故同一 runtime 上并发的 run 不会互相串扰。
   * 已自带 traceId 的事件不被覆盖（保留外部生产者的显式值）。
   */
  private emit(event: RuntimeEvent, traceId?: string): void {
    const stamped: RuntimeEvent =
      traceId === undefined || event.traceId !== undefined
        ? event
        : ({ ...event, traceId } as RuntimeEvent);
    // P3.2: 事件流统一脱敏——任何事件（含 run:start 输入、model:response 内容、
    // tool:end 结果）在离开引擎前都过一遍 redact，确保 key/secret 永不外泄。
    // 工具执行本身仍使用未被脱敏的真实参数（脱敏只作用于对外事件）。
    this.events.emit(redact(stamped) as RuntimeEvent);
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
  providerId: string,
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
