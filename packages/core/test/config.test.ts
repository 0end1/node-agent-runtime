import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig, ConfigError } from "@agent-runtime/core";
import { ErrorCode } from "@agent-runtime/types";

const ENV = (over: Record<string, string | undefined> = {}) =>
  ({ ...over }) as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("defaults to mock provider + deny network + info level", () => {
    const cfg = loadConfig({ env: ENV() });
    assert.equal(cfg.provider.kind, "mock");
    assert.equal(cfg.sandbox.network, "deny");
    assert.equal(cfg.sandbox.mode, "workspace-write");
    assert.equal(cfg.logLevel, "info");
    assert.deepEqual(cfg.features, { mcp: true, sqlite: false, artifacts: true });
  });

  it("selects openai when OPENAI_API_KEY present", () => {
    const cfg = loadConfig({ env: ENV({ OPENAI_API_KEY: "sk-test" }) });
    assert.equal(cfg.provider.kind, "openai");
    assert.equal(cfg.provider.apiKey, "sk-test");
  });

  it("overrides take precedence over env (layering)", () => {
    const cfg = loadConfig({
      env: ENV({ OPENAI_API_KEY: "sk-env", OPENAI_MODEL: "gpt-x" }),
      overrides: { provider: { kind: "mock" } },
    });
    assert.equal(cfg.provider.kind, "mock");
    assert.equal(cfg.provider.apiKey, "sk-env");
  });

  it("parses feature flags from env", () => {
    const cfg = loadConfig({
      env: ENV({ AGENT_FEATURE_MCP: "false", AGENT_FEATURE_ARTIFACTS: "false" }),
    });
    assert.equal(cfg.features.mcp, false);
    assert.equal(cfg.features.artifacts, false);
  });

  it("rejects an invalid log level with a readable ConfigError", () => {
    assert.throws(
      () => loadConfig({ env: ENV({ AGENT_LOG_LEVEL: "verbose" }) }),
      (err: unknown) => err instanceof ConfigError && err.code === ErrorCode.CONFIG_INVALID,
    );
  });

  it("parses the network allowlist when AGENT_SANDBOX_NETWORK=allowlist", () => {
    const cfg = loadConfig({
      env: ENV({
        AGENT_SANDBOX_NETWORK: "allowlist",
        AGENT_SANDBOX_NETWORK_ALLOWLIST: "https://a.com, https://b.com",
      }),
    });
    assert.equal(cfg.sandbox.network, "allowlist");
    assert.deepEqual(cfg.sandbox.networkAllowlist, ["https://a.com", "https://b.com"]);
  });

  it("rejects an invalid sandbox network value", () => {
    assert.throws(
      () => loadConfig({ env: ENV({ AGENT_SANDBOX_NETWORK: "maybe" }) }),
      (err: unknown) => err instanceof ConfigError && err.code === ErrorCode.CONFIG_INVALID,
    );
  });
});
