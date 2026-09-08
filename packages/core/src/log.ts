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
    const metaStr = meta === undefined ? "" : " " + serialize(meta);
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
