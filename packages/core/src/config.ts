import type { SandboxMode } from "@agent-runtime/sandbox";
import { ErrorCode } from "@agent-runtime/types";
import type { LogLevel } from "./log.js";

export interface FeatureFlags {
  mcp: boolean;
  sqlite: boolean;
  artifacts: boolean;
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
  env?: NodeJS.ProcessEnv;
  /** Environment-layering overrides (highest precedence). */
  overrides?: Partial<{
    logLevel: LogLevel;
    provider: Partial<RuntimeConfig["provider"]>;
    sandbox: Partial<RuntimeConfig["sandbox"]>;
    permission: Partial<RuntimeConfig["permission"]>;
    features: Partial<FeatureFlags>;
  }>;
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

  const wantsOpenAI = ov.provider?.kind === "openai" || Boolean(env.OPENAI_API_KEY);
  const provider: RuntimeConfig["provider"] = {
    kind: wantsOpenAI ? "openai" : "mock",
    ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
    ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
    ...(env.OPENAI_MODEL ? { model: env.OPENAI_MODEL } : {}),
    ...(ov.provider ?? {}),
  };

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
    features,
  };
}
