import { resolve, sep } from "node:path";
import type { AnyTool, ToolKind } from "./tool.js";

/**
 * Sandbox — run-level execution boundary (M3, docs/architecture.md §6.2 v1.2).
 *
 * The sandbox is **not** a tool decorator: every run binds a mode + a declared
 * scope, and the runtime enforces that boundary for every tool call — a tool
 * cannot widen its own reach. OS-level isolation (container/VM) stays a host
 * concern; this file ships the in-process `LocalSandbox` (default) and the
 * interfaces a `WorkerSandbox` / `ContainerSandbox` can implement later.
 */

export type SandboxMode =
  /** No side effects: computation, clock, read-only queries. */
  | "read-only"
  /** Default: writes allowed inside the declared workspace only. */
  | "workspace-write"
  /** Boundary off. Host must enable it explicitly (ideally in a container/VM). */
  | "full-access";

export interface SandboxScope {
  /** Writable root. Empty for `read-only`. */
  workspace: string;
  /** Extra writable paths granted by the host. */
  writablePaths: string[];
  /** Outbound network is denied unless the host allowlists it. */
  network: "deny" | "allowlist";
  networkAllowlist?: string[];
  /** Trimmed environment (secrets stripped by the host). */
  env?: Record<string, string>;
}

export interface SandboxRunContext {
  runId?: string;
  sessionId?: string;
  taskId?: string;
}

/** Emitted for write-class tools so the host UI can show "what changed". */
export interface SandboxWriteInfo {
  toolName: string;
  paths: string[];
  /** Line-level text diff (best effort; absent for binary/new files). */
  diff?: string;
  ok: boolean;
  runId?: string;
  sessionId?: string;
  taskId?: string;
}

export interface SandboxHandle {
  readonly mode: SandboxMode;
  readonly scope: SandboxScope;
  /** Wrap a tool so the boundary is enforced before/around its execution. */
  wrap<T extends AnyTool>(tool: T): T;
  dispose(): void | Promise<void>;
}

export interface Sandbox {
  begin(
    mode: SandboxMode,
    scope: SandboxScope,
    ctx?: SandboxRunContext
  ): Promise<SandboxHandle>;
}

/** Raised when a tool call leaves the execution boundary. */
export class SandboxViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxViolationError";
  }
}

/** Raised when a tool exceeds its execution budget. */
export class SandboxTimeoutError extends Error {
  constructor(readonly toolName: string, readonly timeoutMs: number) {
    super(`工具 ${toolName} 执行超时（${timeoutMs}ms），已被沙箱中止`);
    this.name = "SandboxTimeoutError";
  }
}

// ------------------------------------------------------------- classification

const HARMLESS = new Set(["calculator", "now", "math", "time"]);

/** Infer a tool's sensitivity class from its name (tools may declare it). */
export function classifyToolName(name: string): ToolKind {
  const n = name.toLowerCase();
  if (/(token|secret|credential|apikey|api_key|password|_env$)/.test(n)) return "credential";
  if (/(exec|shell|bash|command|terminal|spawn|subprocess|run_)/.test(n)) return "exec";
  if (/(write|edit|create|delete|remove|patch|append|save|move|mkdir|truncate)/.test(n)) return "write";
  // Built-in demos (weather / geocode / exchange) read local static data —
  // they are harmless, not outbound network.
  if (/(fetch|http|request|search|web|download|api)/.test(n)) return "network-read";
  if (HARMLESS.has(n)) return "harmless";
  return "harmless";
}

export function toolKind(tool: AnyTool): ToolKind {
  return tool.meta?.kind ?? classifyToolName(tool.name);
}

const PATH_KEY = /(^|_)(path|paths|file|filepath|filename|dir|folder|target|to|from|root)$/i;

/** Collect path-like string arguments of a tool call. */
export function pathArgsOf(tool: AnyTool, args: unknown): string[] {
  const declared = tool.meta?.pathArgs;
  if (declared?.length) {
    return declared
      .map((key) => (args as Record<string, unknown> | undefined)?.[key])
      .filter((v): v is string => typeof v === "string");
  }
  if (!args || typeof args !== "object") return [];
  return Object.entries(args as Record<string, unknown>)
    .filter(([key, value]) => PATH_KEY.test(key) && typeof value === "string")
    .map(([, value]) => value as string);
}

/** Whether `target` stays inside the declared write domain. */
export function isPathAllowed(target: string, scope: SandboxScope, mode: SandboxMode): boolean {
  if (mode === "full-access") return true;
  const roots = [scope.workspace, ...(scope.writablePaths ?? [])]
    .filter((r) => typeof r === "string" && r.length > 0)
    .map((r) => resolve(r));
  if (roots.length === 0) return false;
  const resolved = resolve(scope.workspace || ".", target);
  return roots.some((root) => resolved === root || resolved.startsWith(root + sep));
}

// --------------------------------------------------------------- LocalSandbox

export interface LocalSandboxOptions {
  /** Execution budget per tool call (default 30s; 0 disables). */
  timeoutMs?: number;
  /** Called after a write-class tool ran, with a best-effort text diff. */
  onWrite?: (info: SandboxWriteInfo) => void;
  /** Read files for diffs (defaults to a Node fs reader). */
  readText?: (path: string) => Promise<string | undefined>;
}

const BLOCKED_IN_READ_ONLY: ReadonlySet<ToolKind> = new Set(["write", "exec", "credential"]);

/**
 * In-process sandbox: mode boundary + declared write domain + network switch +
 * per-call timeout + `sandbox:write` visibility.
 */
export class LocalSandbox implements Sandbox {
  private readonly timeoutMs: number;
  private readonly onWrite?: (info: SandboxWriteInfo) => void;
  private readonly readText: (path: string) => Promise<string | undefined>;

  constructor(options: LocalSandboxOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.onWrite = options.onWrite;
    this.readText =
      options.readText ??
      (async (p: string) => {
        try {
          const { readFile } = await import("node:fs/promises");
          return await readFile(p, "utf8");
        } catch {
          return undefined;
        }
      });
  }

  async begin(mode: SandboxMode, scope: SandboxScope, ctx?: SandboxRunContext): Promise<SandboxHandle> {
    return new LocalSandboxHandle(mode, scope, ctx, {
      timeoutMs: this.timeoutMs,
      onWrite: this.onWrite,
      readText: this.readText,
    });
  }
}

class LocalSandboxHandle implements SandboxHandle {
  constructor(
    readonly mode: SandboxMode,
    readonly scope: SandboxScope,
    private readonly ctx: SandboxRunContext | undefined,
    private readonly options: Required<Pick<LocalSandboxOptions, "timeoutMs" | "readText">> &
      Pick<LocalSandboxOptions, "onWrite">
  ) {}

  wrap<T extends AnyTool>(tool: T): T {
    const kind = toolKind(tool);
    const { mode, scope, options, ctx } = this;

    return {
      ...tool,
      execute: async (args: Record<string, unknown>, toolCtx: Parameters<T["execute"]>[1]) => {
        // 1) run-level boundary: side effects are off in read-only mode
        if (mode === "read-only" && BLOCKED_IN_READ_ONLY.has(kind)) {
          throw new SandboxViolationError(
            `沙箱为 read-only，禁止 ${kind} 类工具「${tool.name}」`
          );
        }
        // 2) network is denied unless the host allowlisted it
        if (kind === "network-read" && scope.network === "deny") {
          throw new SandboxViolationError(`沙箱已禁网，拒绝网络工具「${tool.name}」`);
        }
        // 3) declared write domain
        const paths = pathArgsOf(tool, args);
        for (const target of paths) {
          if (!isPathAllowed(target, scope, mode)) {
            throw new SandboxViolationError(
              `路径越界「${target}」：不在可写域 ${scope.workspace || "(未声明)"} 内`
            );
          }
        }

        // 4) snapshot before a write so the change is visible afterwards
        const before = kind === "write" ? await firstText(options.readText, paths) : undefined;

        const result = options.timeoutMs > 0
          ? await withTimeout(Promise.resolve(tool.execute(args as never, toolCtx)), options.timeoutMs, tool.name)
          : await tool.execute(args as never, toolCtx);

        // 5) "write is visible": publish a best-effort diff
        if (kind === "write" && options.onWrite) {
          const after = await firstText(options.readText, paths);
          options.onWrite({
            toolName: tool.name,
            paths,
            ...(before !== undefined || after !== undefined
              ? { diff: simpleDiff(before ?? "", after ?? "") }
              : {}),
            ok: true,
            ...(ctx?.runId ? { runId: ctx.runId } : {}),
            ...(ctx?.sessionId ? { sessionId: ctx.sessionId } : {}),
            ...(ctx?.taskId ? { taskId: ctx.taskId } : {}),
          });
        }
        return result;
      },
    } as T;
  }

  dispose(): void {
    // nothing to tear down for the in-process sandbox
  }
}

async function firstText(
  readText: (path: string) => Promise<string | undefined>,
  paths: string[]
): Promise<string | undefined> {
  for (const p of paths) {
    const text = await readText(p);
    if (text !== undefined) return text;
  }
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SandboxTimeoutError(toolName, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/** Naive line diff: good enough to show "what changed" in a host UI. */
export function simpleDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left !== undefined) out.push(`- ${left}`);
    if (right !== undefined) out.push(`+ ${right}`);
  }
  return out.join("\n");
}
