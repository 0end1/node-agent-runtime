import { readFileSync } from "node:fs";
import type { SandboxMode } from "@node-agent-runtime/sandbox";
import type { ContextBudget } from "@node-agent-runtime/memory";
import {
  compilePolicy,
  validatePolicyDocument,
  PRESETS,
} from "@node-agent-runtime/policy";
import type { PermissionPolicy } from "@node-agent-runtime/policy";
import { ErrorCode } from "@node-agent-runtime/types";
import type { PriceTable, ProcessEnv, RunLimits } from "@node-agent-runtime/types";
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
    /** M7-3: preset name from `PRESETS` (e.g. "prod-strict"). */
    preset?: string;
    /** M7-3: path to an external `PolicyDocument` JSON (validated then compiled). */
    documentPath?: string;
    /** M7-3: compiled policy (set by `loadConfig` when `preset`/`documentPath` given). */
    policy?: PermissionPolicy;
    /**
     * P3 §3 第 3 项: 是否把 `policy-allow` 决策写入审计（默认 `true`）。
     * 关闭可减少高频无害工具产生的审计行；`deny` / `ask` / 宿主决策始终留痕。
     */
    auditPolicyAllows?: boolean;
  };
  /** P3.4: budget guardrails derived from env / overrides (unset = no cap). */
  limits?: RunLimits;
  /** M7-1: context budget for long-context compaction (unset = no cap). */
  context?: ContextBudget;
  /** M7-1: built-in cost meter price table (unset = cost not metered). */
  pricing?: PriceTable;
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
    context: Partial<ContextBudget>;
    pricing: PriceTable;
    mcp: Partial<McpConfig>;
    features: Partial<FeatureFlags>;
  }>;
}

/**
 * M8-4 顺带清理（P3 §3 第 1/2 项）：解析非负数（整数或小数，如 `MAX_COST_USD`）。
 *
 * 原先叫 `parsePositiveNumber` 却允许小数，且 `n > 0` 把 `0` 当成"未设置"丢弃——
 * 但 `AGENT_LIMIT_MAX_COST_USD=0` 是合法预算（禁止消费），必须能表达。改为
 * `>= 0`：**只有 `undefined` / 空串才表示"未设置"，显式 `0` 表示"零预算"**。
 */
function parsePositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** P3.4: assemble `limits` from `AGENT_LIMIT_*` / `AGENT_RATE_TOOL_*` env + overrides. */
function buildLimits(
  env: ProcessEnv,
  overrides: Partial<RunLimits> | undefined,
): RunLimits | undefined {
  // P3 §3 第 1 项：每个字段只求值一次，消除 `parsePositiveNumber(x) !== undefined
  // ? { ...: parsePositiveNumber(x) }` 的重复对 env 的两次解析。
  const maxSteps = parsePositiveNumber(env.AGENT_LIMIT_MAX_STEPS);
  const maxModelCalls = parsePositiveNumber(env.AGENT_LIMIT_MAX_MODEL_CALLS);
  const maxInputTokens = parsePositiveNumber(env.AGENT_LIMIT_MAX_INPUT_TOKENS);
  const maxOutputTokens = parsePositiveNumber(env.AGENT_LIMIT_MAX_OUTPUT_TOKENS);
  const maxTotalTokens = parsePositiveNumber(env.AGENT_LIMIT_MAX_TOTAL_TOKENS);
  const maxDurationMs = parsePositiveNumber(env.AGENT_LIMIT_MAX_DURATION_MS);
  const maxCostUsd = parsePositiveNumber(env.AGENT_LIMIT_MAX_COST_USD);
  const rateCalls = parsePositiveNumber(env.AGENT_RATE_TOOL_MAX_CALLS);
  const rateWindow = parsePositiveNumber(env.AGENT_RATE_TOOL_WINDOW_MS);

  const limits: RunLimits = {
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(maxModelCalls !== undefined ? { maxModelCalls } : {}),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
    ...(maxDurationMs !== undefined ? { maxDurationMs } : {}),
    ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
    ...(rateCalls !== undefined && rateWindow !== undefined
      ? { toolRate: { maxCalls: rateCalls, windowMs: rateWindow } }
      : {}),
    ...(overrides ?? {}),
  };
  return Object.keys(limits).length === 0 ? undefined : limits;
}

/** M7-1: assemble `context` budget from `AGENT_CONTEXT_*` env + overrides. */
function buildContext(
  env: ProcessEnv,
  overrides: Partial<ContextBudget> | undefined,
): ContextBudget | undefined {
  const budget: ContextBudget = {
    ...(parsePositiveNumber(env.AGENT_CONTEXT_MAX_INPUT_TOKENS) !== undefined
      ? { maxInputTokens: parsePositiveNumber(env.AGENT_CONTEXT_MAX_INPUT_TOKENS) }
      : {}),
    ...(parsePositiveNumber(env.AGENT_CONTEXT_WINDOW) !== undefined
      ? { contextWindow: parsePositiveNumber(env.AGENT_CONTEXT_WINDOW) }
      : {}),
    ...(parsePositiveNumber(env.AGENT_CONTEXT_KEEP_LAST_TURNS) !== undefined
      ? { keepLastTurns: parsePositiveNumber(env.AGENT_CONTEXT_KEEP_LAST_TURNS) }
      : {}),
    ...(overrides ?? {}),
  };
  return Object.keys(budget).length === 0 ? undefined : budget;
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
    ...(parsePositiveNumber(env.AGENT_MCP_STDIO_TIMEOUT_MS) !== undefined
      ? { stdioStartTimeoutMs: parsePositiveNumber(env.AGENT_MCP_STDIO_TIMEOUT_MS) }
      : {}),
    ...(allowlist?.length ? { httpUrlAllowlist: allowlist } : {}),
    ...(Object.keys(serverEnv).length > 0 ? { serverEnv } : {}),
    ...(overrides ?? {}),
  };
  return Object.keys(mcp).length === 0 ? undefined : mcp;
}

/** M7-3: assemble `permission` from `AGENT_POLICY_*` env + overrides. */
function buildPermission(
  env: ProcessEnv,
  overrides: Partial<RuntimeConfig["permission"]> | undefined,
): RuntimeConfig["permission"] {
  const perm: RuntimeConfig["permission"] = { ...(overrides ?? {}) };
  if (env.AGENT_POLICY_PRESET) perm.preset = env.AGENT_POLICY_PRESET;
  if (env.AGENT_POLICY_FILE) perm.documentPath = env.AGENT_POLICY_FILE;
  // P3 §3 第 3 项: `policy-allow` 审计开关（默认 true）。关闭可减少高频无害工具产生的审计行。
  if (env.AGENT_PERMISSION_AUDIT_POLICY_ALLOWS !== undefined) {
    perm.auditPolicyAllows =
      env.AGENT_PERMISSION_AUDIT_POLICY_ALLOWS !== "false" &&
      env.AGENT_PERMISSION_AUDIT_POLICY_ALLOWS !== "0";
  }

  // M7-3: 外部策略文件必须先校验再编译（P3.8 口径），非法即抛 ConfigError。
  if (perm.documentPath) {
    let raw: string;
    try {
      raw = readFileSync(perm.documentPath, "utf8");
    } catch {
      throw new ConfigError(`AGENT_POLICY_FILE 指向的文件不可读：${perm.documentPath}`);
    }
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new ConfigError(`AGENT_POLICY_FILE 不是合法 JSON：${perm.documentPath}`);
    }
    perm.policy = compilePolicy(validatePolicyDocument(doc));
  } else if (perm.preset) {
    const preset = PRESETS[perm.preset];
    if (!preset) {
      throw new ConfigError(
        `AGENT_POLICY_PRESET 未知预设：${perm.preset}（可用：${Object.keys(PRESETS).join(", ")}）`,
      );
    }
    perm.policy = compilePolicy(preset);
  }
  return perm;
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
    permission: buildPermission(env, ov.permission),
    limits: buildLimits(env, ov.limits),
    context: buildContext(env, ov.context),
    pricing: ov.pricing,
    mcp: buildMcpConfig(env, ov.mcp),
    features,
  };
}
