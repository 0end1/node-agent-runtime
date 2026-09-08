import { errorInfo, type ErrorCode } from "@agent-runtime/types";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Injectable structured logger (P3.1). Hosts pass one to
 * `AgentRuntimeOptions.logger`. A legacy `(line: string) => void` callback is
 * accepted too and normalized by `toLogger` into a `Logger`.
 */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export class ConsoleLogger implements Logger {
  private readonly level: LogLevel;
  private readonly stream: (line: string) => void;

  constructor(opts: { level?: LogLevel; stream?: (line: string) => void } = {}) {
    this.level = opts.level ?? "info";
    this.stream = opts.stream ?? ((line) => process.stderr.write(line + "\n"));
  }

  debug(message: string, meta?: unknown): void {
    this.write("debug", message, meta);
  }
  info(message: string, meta?: unknown): void {
    this.write("info", message, meta);
  }
  warn(message: string, meta?: unknown): void {
    this.write("warn", message, meta);
  }
  error(message: string, meta?: unknown): void {
    this.write("error", message, meta);
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
    // P3.2: 任何 meta 都经脱敏，确保 key/secret 不进日志。
    const safeMeta = meta === undefined ? undefined : redact(meta);
    const metaStr = safeMeta === undefined ? "" : " " + serialize(safeMeta);
    this.stream(`[agent-runtime ${level}] ${message}${metaStr}`);
  }
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const REDACTED = "***REDACTED***";

/** Recursion budget. Anything deeper is masked wholesale — never passed through. */
const REDACT_DEPTH_LIMIT = 8;

// P3.2: 脱敏——key/secret 类字段与疑似密钥的值永不进入日志/事件。
// 键名允许 `x-`/`proxy-`/下划线等前缀与点分后缀（`x-api-key`、`proxy-authorization`…）。
const STRONG_SECRET_KEY =
  /(^|[-_.])(api[_-]?key|secret|token|password|passwd|pwd|authorization|auth|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|cookie|set[_-]?cookie|bearer)$/i;
const WEAK_SECRET_KEY = /(^|[-_.])(key|auth)$/i;
// 常见厂商密钥前缀 + JWT + 长 base64/hex 串。
const SECRET_VALUE =
  /^(sk-[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[aboprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|glpat-[A-Za-z0-9_-]{16,}|[A-Za-z0-9+/]{32,}={0,2}$)/;

/**
 * Deep-clone and mask likely secrets. Strong-secret keys are always masked;
 * weak keys (key/auth) are masked only when their value looks like a secret;
 * other values pass through untouched so ordinary tool args stay readable.
 * Used by `ConsoleLogger` and the runtime's event emission (P3.2).
 */
export function redact(value: unknown, depth = 0): unknown {
  return redactValue(value, new WeakSet<object>(), depth);
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && SECRET_VALUE.test(value)) return REDACTED;
    return value;
  }
  // 循环引用：不再继续展开（避免无限递归）。
  if (seen.has(value)) return REDACTED;
  // 深度上限：整值视为不可信并脱敏，而不是"深了就放行原文"。
  if (depth >= REDACT_DEPTH_LIMIT) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (STRONG_SECRET_KEY.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (WEAK_SECRET_KEY.test(key)) {
      out[key] =
        typeof val === "string" && SECRET_VALUE.test(val)
          ? REDACTED
          : redactValue(val, seen, depth + 1);
      continue;
    }
    out[key] = redactValue(val, seen, depth + 1);
  }
  return out;
}

/** Normalize a `Logger` or a legacy `(line: string) => void` into a `Logger`. */
export function toLogger(input?: Logger | ((line: string) => void)): Logger | undefined {
  if (!input) return undefined;
  if (typeof input === "function") {
    return {
      debug: () => {},
      info: (m) => input(m),
      warn: (m) => input(m),
      error: (m) => input(m),
    };
  }
  return input;
}

/** Build a stable error payload for HTTP/CLI responses: `{ error: { code, message } }`. */
export function errorPayload(
  err: unknown,
): { error: { code: ErrorCode; message: string } } {
  const info = errorInfo(err);
  return { error: { code: info.code, message: info.message } };
}
