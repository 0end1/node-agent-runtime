import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createProductionPolicy,
  createProductionDefaults,
  secureScope,
  PRODUCTION_MATRIX,
  type PermissionContext,
} from "@node-agent-runtime/policy";

const policy = createProductionPolicy();
const MODES = ["read-only", "workspace-write", "full-access"] as const;

function ctx(over: Partial<PermissionContext> = {}): PermissionContext {
  return {
    runId: "run1",
    conversationId: "conv1",
    tool: { name: "x", kind: "harmless" },
    sandboxMode: "workspace-write",
    scope: { workspace: "/ws", writablePaths: [], network: "deny" },
    ...over,
  };
}

function call(name: string) {
  return { name, arguments: {} };
}

function verdict(kind: PermissionContext["tool"]["kind"], mode: (typeof MODES)[number], name: string) {
  return policy.decide(ctx({ tool: { name, kind }, sandboxMode: mode }), call(name)).verdict;
}

describe("PRODUCTION_MATRIX", () => {
  it("denies credentials everywhere", () => {
    for (const mode of MODES) {
      assert.equal(PRODUCTION_MATRIX.credential[mode], "deny");
    }
  });

  it("denies network-read in workspace-write (production bias)", () => {
    assert.equal(PRODUCTION_MATRIX["network-read"]["workspace-write"], "deny");
    assert.equal(PRODUCTION_MATRIX["network-read"]["full-access"], "allow");
  });
});

describe("createProductionPolicy", () => {
  it("asks on write/exec in workspace-write", () => {
    assert.equal(verdict("write", "workspace-write", "w"), "ask");
    assert.equal(verdict("exec", "workspace-write", "w"), "ask");
  });

  it("allows harmless in all modes", () => {
    for (const mode of MODES) {
      assert.equal(verdict("harmless", mode, "h"), "allow");
    }
  });

  it("denies credentials regardless of mode", () => {
    for (const mode of MODES) {
      assert.equal(verdict("credential", mode, "c"), "deny");
    }
  });
});

describe("secureScope", () => {
  it("locks down to workspace with no network", () => {
    const scope = secureScope("/work");
    assert.equal(scope.workspace, "/work");
    assert.deepEqual(scope.writablePaths, []);
    assert.equal(scope.network, "deny");
  });

  it("merge overrides survive", () => {
    const scope = secureScope("/work", { writablePaths: ["/work/tmp"] });
    assert.deepEqual(scope.writablePaths, ["/work/tmp"]);
  });
});

describe("createProductionDefaults", () => {
  it("bundles a production policy + secure scope", () => {
    const d = createProductionDefaults("/app");
    assert.equal(d.sandboxMode, "workspace-write");
    assert.equal(d.scope.network, "deny");
    assert.equal(verdict("credential", "full-access", "c"), "deny");
  });
});
