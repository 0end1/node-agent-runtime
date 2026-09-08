import type { SandboxMode } from "@agent-runtime/sandbox";
import { ErrorCode } from "@agent-runtime/types";
import type { ProcessEnv, RunLimits } from "@agent-runtime/types";
import type { LogLevel } from "./log.js";

export interface FeatureFlags {
  mcp: boolean;
  sqlite: boolean;
  artifacts: boolean;
}

/** P3.6: MCP 供应链防护参数（由宿主透传给 transport）。 */
export interface McpConfig {
  /** Stdio 子进程启动超时（ms）。 */
  stdioStartTimeoutMs?: number;
  /** Streamable HTTP 端点 URL 白名单（SSRF 防护）。 */
  httpUrlAllowlist?: string[];
  /** 追加注入 stdio server 的环境变量（密钥只经此注入）。 */
  serverEnv?: Record<string, string>;
}

export interface RuntimeConfig {
  logLevel: LogLevel;
  provider: {
    kind: "mock" | "openai";
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  sandbox: {
    mode: SandboxMode;
    network: "deny" | "allowlist";
    networkAllowlist?: string[];
  };
  permission: {
    allow?: string[];
    deny?: string[];
  };
  /** P3.4: budget guardrails derived from env / overrides (unset = no cap). */
  limits?: RunLimits;
  /** P3.6: MCP supply-chain guardrails handed to hosts for their transports. */
  mcp?: McpConfig;
  features: FeatureFlags;
}

/** Thrown when configuration is missing/invalid (P3.8). Carries a stable `code`. */
export class ConfigError extends Error {
  readonly code = ErrorCode.CONFIG_INVALID;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const DEFAULT_FEATURES: FeatureFlags = { mcp: true, sqlite: false, artifacts: true };

export interface LoadConfigOptions {
  /** Defaults to `process.env`. Inject a custom env for tests. */
  env?: ProcessEnv;
  /** Environment-layering overrides (highest precedence). */
  overrides?: Partial<{
    logLevel: LogLevel;
    provider: Partial<RuntimeConfig["provider"]>;
    sandbox: Partial<RuntimeConfig["sandbox"]>;
    permission: Partial<RuntimeConfig["permission"]>;
    limits: Partial<RunLimits>;
    mcp: Partial<McpConfig>;
    features: Partial<FeatureFlags>;
  }>;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** P3.4: assemble `limits` from `AGENT_LIMIT_*` / `AGENT_RATE_TOOL_*` env + overrides. */
function buildLimits(
  env: ProcessEnv,
  overrides: Partial<RunLimits> | undefined,
): RunLimits | undefined {
  const rateCalls = parsePositiveInt(env.AGENT_RATE_TOOL_MAX_CALLS);
  const rateWindow = parsePositiveInt(env.AGENT_RATE_TOOL_WINDOW_MS);
  const limits: RunLimits = {
    ...(parsePositiveInt(env.AGENT_LIMIT_MAX_STEPS) !== undefined
      ? { maxSteps: parsePositiveInt(env.AGENT_LIMIT_MAX_STEPS) }
      : {}),
    ...(parsePositiveInt(env.AGENT_LIMIT_MAX_MODEL_CALLS) !== undefined
      ? { maxModelCalls: parsePositiveInt(env.AGENT_LIMIT_MAX_MODEL_CALLS) }
      : {}),
    ...(parsePositiveInt(env.AGENT_LIMIT_MAX_INPUT_TOKENS) !== undefined
      ? { maxInputTokens: parsePositiveInt(env.AGENT_LIMIT_MAX_INPUT_TOKENS) }
      : {}),
    ...(parsePositiveInt(env.AGENT_LIMIT_MAX_OUTPUT_TOKENS) !== undefined
      ? { maxOutputTokens: parsePositiveInt(env.AGENT_LIMIT_MAX_OUTPUT_TOKENS) }
      : {}),
    ...(parsePositiveInt(env.AGENT_LIMIT_MAX_TOTAL_TOKENS) !== undefined
      ? { maxTotalTokens: parsePositiveInt(env.AGENT_LIMIT_MAX_TOTAL_TOKENS) }
      : {}),
    ...(parsePositiveInt(env.AGENT_LIMIT_MAX_DURATION_MS) !== undefined
      ? { maxDurationMs: parsePositiveInt(env.AGENT_LIMIT_MAX_DURATION_MS) }
      : {}),
    ...(parsePositiveInt(env.AGENT_LIMIT_MAX_COST_USD) !== undefined
      ? { maxCostUsd: parsePositiveInt(env.AGENT_LIMIT_MAX_COST_USD) }
      : {}),
    ...(rateCalls !== undefined && rateWindow !== undefined
      ? { toolRate: { maxCalls: rateCalls, windowMs: rateWindow } }
      : {}),
    ...(overrides ?? {}),
  };
  return Object.keys(limits).length === 0 ? undefined : limits;
}

const MCP_ENV_PREFIX = "AGENT_MCP_ENV_";

/** P3.6: assemble MCP 供应链参数 from `AGENT_MCP_*` env + overrides. */
function buildMcpConfig(
  env: ProcessEnv,
  overrides: Partial<McpConfig> | undefined,
): McpConfig | undefined {
  const serverEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(MCP_ENV_PREFIX) && value !== undefined) {
      // AGENT_MCP_ENV_MY_TOKEN=xx → { MY_TOKEN: "xx" }
      serverEnv[key.slice(MCP_ENV_PREFIX.length)] = value;
    }
  }
  const allowlist = parseList(env.AGENT_MCP_HTTP_ALLOWLIST);
  const mcp: McpConfig = {
    ...(parsePositiveInt(env.AGENT_MCP_STDIO_TIMEOUT_MS) !== undefined
      ? { stdioStartTimeoutMs: parsePositiveInt(env.AGENT_MCP_STDIO_TIMEOUT_MS) }
      : {}),
    ...(allowlist?.length ? { httpUrlAllowlist: allowlist } : {}),
    ...(Object.keys(serverEnv).length > 0 ? { serverEnv } : {}),
    ...(overrides ?? {}),
  };
  return Object.keys(mcp).length === 0 ? undefined : mcp;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function boolFlag(value: string | undefined, def: boolean): boolean {
  if (value === undefined) return def;
  return value === "true" || value === "1";
}

/**
 * Centralized, layered runtime configuration (P3.8, 吸收 D2). Provider secrets
 * are read **only** here (from env or explicit overrides) — no scattered magic
 * `process.env` reads elsewhere. Missing/invalid required config throws a
 * readable `ConfigError` rather than a cryptic failure deep inside a provider.
 */
export function loadConfig(options: LoadConfigOptions = {}): RuntimeConfig {
  const env = options.env ?? process.env;
  const ov = options.overrides ?? {};

  const rawLevel = ov.logLevel ?? (env.AGENT_LOG_LEVEL as LogLevel | undefined);
  const logLevel = rawLevel ?? "info";
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(
      `AGENT_LOG_LEVEL 取值非法：${String(rawLevel)}（允许 ${LOG_LEVELS.join(", ")}）`,
    );
  }

  // P3.8: 空串密钥是"配了但没填"，静默回落 mock 会让宿主以为在用真模型 —— 直接报错。
  const rawKey = env.OPENAI_API_KEY;
  if (typeof rawKey === "string" && rawKey.trim() === "") {
    throw new ConfigError("OPENAI_API_KEY 已设置但为空；请填写有效密钥，或移除该环境变量以显式使用 mock");
  }
  const apiKeyFromEnv =
    typeof rawKey === "string" && rawKey.trim() !== "" ? rawKey.trim() : undefined;

  const wantsOpenAI =
    ov.provider?.kind === "openai" || Boolean(ov.provider?.apiKey) || apiKeyFromEnv !== undefined;
  const provider: RuntimeConfig["provider"] = {
    kind: wantsOpenAI ? "openai" : "mock",
    ...(apiKeyFromEnv ? { apiKey: apiKeyFromEnv } : {}),
    ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
    ...(env.OPENAI_MODEL ? { model: env.OPENAI_MODEL } : {}),
    ...(ov.provider ?? {}),
  };
  if (provider.kind === "openai" && !provider.apiKey) {
    throw new ConfigError(
      "provider=openai 但未配置密钥：请设置 OPENAI_API_KEY，或经 overrides.provider.apiKey 注入",
    );
  }

  const networkRaw = ov.sandbox?.network ?? (env.AGENT_SANDBOX_NETWORK as "deny" | "allowlist" | undefined);
  const network: "deny" | "allowlist" = networkRaw ?? "deny";
  if (network !== "deny" && network !== "allowlist") {
    throw new ConfigError(
      `AGENT_SANDBOX_NETWORK 取值非法：${String(networkRaw)}（允许 deny | allowlist）`,
    );
  }

  const features: FeatureFlags = {
    mcp: boolFlag(env.AGENT_FEATURE_MCP, ov.features?.mcp ?? DEFAULT_FEATURES.mcp),
    sqlite: boolFlag(env.AGENT_FEATURE_SQLITE, ov.features?.sqlite ?? DEFAULT_FEATURES.sqlite),
    artifacts: boolFlag(env.AGENT_FEATURE_ARTIFACTS, ov.features?.artifacts ?? DEFAULT_FEATURES.artifacts),
  };

  return {
    logLevel,
    provider,
    sandbox: {
      mode: ov.sandbox?.mode ?? "workspace-write",
      network,
      ...(network === "allowlist"
        ? {
            networkAllowlist:
              ov.sandbox?.networkAllowlist ?? parseList(env.AGENT_SANDBOX_NETWORK_ALLOWLIST),
          }
        : {}),
    },
    permission: { ...(ov.permission ?? {}) },
    limits: buildLimits(env, ov.limits),
    mcp: buildMcpConfig(env, ov.mcp),
    features,
  };
}
