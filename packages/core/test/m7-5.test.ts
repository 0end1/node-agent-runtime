import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Agent,
  AgentCompileError,
  agentSnapshotOf,
  assertResumable,
  CheckpointMismatchError,
  compileAgent,
  type AnyTool,
  type Checkpoint,
} from "@node-agent-runtime/core";

function tool(name: string, parameters?: AnyTool["parameters"]): AnyTool {
  return { name, description: `tool ${name}`, parameters, execute: async () => name };
}

/** Compile and return the thrown `AgentCompileError` (fails the test if none). */
function expectFailure(run: () => unknown): AgentCompileError {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof AgentCompileError, `expected AgentCompileError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected the recipe to fail compilation");
}

function checkpoint(snapshot: Checkpoint["agentSnapshot"]): Checkpoint {
  return { id: "ckpt_1", agentSnapshot: snapshot } as unknown as Checkpoint;
}

describe("M7-5 compileAgent (docs/m7-base-governance.md §9)", () => {
  it("accepts a clean recipe", () => {
    const compiled = compileAgent({
      name: "assistant",
      tools: [tool("a", { type: "object", properties: { q: { type: "string" } }, required: ["q"] })],
    });
    assert.equal(compiled.tools.length, 1);
    assert.deepEqual(compiled.warnings, []);
  });

  it("rejects duplicate tool names (§9.3-1)", () => {
    const err = expectFailure(() => compileAgent({ name: "a", tools: [tool("dup"), tool("dup")] }));
    assert.equal(err.code, "agent_invalid");
    assert.ok(err.issues.some((i) => i.code === "duplicate-tool"), JSON.stringify(err.issues));
  });

  it("rejects a malformed parameter schema (§9.3-2)", () => {
    const err = expectFailure(() =>
      compileAgent({
        name: "a",
        tools: [tool("bad", { type: "strng" } as unknown as AnyTool["parameters"])],
      }),
    );
    assert.ok(err.issues.some((i) => i.code === "invalid-schema"), JSON.stringify(err.issues));
  });

  it("rejects `required` naming a property that does not exist", () => {
    const err = expectFailure(() =>
      compileAgent({
        name: "a",
        tools: [tool("bad", { type: "object", properties: {}, required: ["nope"] })],
      }),
    );
    assert.ok(err.issues.some((i) => i.code === "invalid-schema"));
  });

  it("reports every finding at once instead of failing fast", () => {
    const err = expectFailure(() =>
      compileAgent({
        name: "a",
        tools: [tool("dup"), tool("dup"), tool("bad", { type: "strng" } as never)],
        mcpTools: [{ server: "fs", tool: "read" }],
      }),
    );
    const codes = new Set(err.issues.map((i) => i.code));
    assert.ok(codes.has("duplicate-tool"));
    assert.ok(codes.has("invalid-schema"));
    assert.ok(codes.has("mcp-unreachable"));
  });

  it("fails an unresolved MCP ref (§9.3-3)", () => {
    const err = expectFailure(() =>
      compileAgent({ name: "a", tools: [tool("x")], mcpTools: [{ server: "fs", tool: "read" }] }),
    );
    const issue = err.issues.find((i) => i.code === "mcp-unreachable");
    assert.ok(issue, JSON.stringify(err.issues));
    assert.match(issue!.message, /fs::read/);
  });

  it("merges MCP tools resolved through the injected resolver (§9.3-4)", () => {
    const compiled = compileAgent(
      { name: "a", tools: [tool("local")], mcpTools: [{ server: "fs", tool: "read" }] },
      { resolveMcp: (ref) => tool(`mcp__${ref.server}__${ref.tool}`) },
    );
    assert.deepEqual(
      compiled.tools.map((t) => t.name),
      ["local", "mcp__fs__read"],
    );
  });

  it("detects a collision between a local tool and a resolved MCP tool", () => {
    const err = expectFailure(() =>
      compileAgent(
        { name: "a", tools: [tool("read")], mcpTools: [{ server: "fs", tool: "read" }] },
        { resolveMcp: () => tool("read") },
      ),
    );
    assert.ok(err.issues.some((i) => i.code === "duplicate-tool"));
  });

  it("is deterministic so the result can be cached (§9.3-5)", () => {
    const recipe = () =>
      compileAgent({ name: "a", tools: [tool("x"), tool("y")], instructions: "be terse" });
    const first = recipe();
    const second = recipe();
    assert.equal(first.toolsHash, second.toolsHash);
    assert.equal(first.instructionsHash, second.instructionsHash);
  });

  it("is order-insensitive for tools but sensitive for instructions", () => {
    const a = compileAgent({ name: "a", tools: [tool("x"), tool("y")], instructions: "v1" });
    const b = compileAgent({ name: "a", tools: [tool("y"), tool("x")], instructions: "v1" });
    const c = compileAgent({ name: "a", tools: [tool("x"), tool("y")], instructions: "v2" });
    assert.equal(a.toolsHash, b.toolsHash);
    assert.notEqual(a.instructionsHash, c.instructionsHash);
  });

  it("warns (not errors) when the recipe declares no tools", () => {
    const compiled = compileAgent({ name: "a" });
    assert.equal(compiled.warnings.length, 1);
    assert.equal(compiled.warnings[0].code, "empty-tools");
  });

  it("accepts an already-constructed Agent", () => {
    const agent = new Agent({ name: "a", tools: [tool("x")] });
    const compiled = compileAgent(agent);
    assert.equal(compiled.agent, agent);
  });

  it("exposes a checkpoint-ready snapshot", () => {
    const compiled = compileAgent({ name: "assistant", tools: [tool("x")] });
    assert.deepEqual(agentSnapshotOf(compiled), {
      agentId: "assistant",
      toolsHash: compiled.toolsHash,
      instructionsHash: compiled.instructionsHash,
    });
  });
});

describe("M7-5 recipe snapshot & resume guard (§8-12)", () => {
  const tools = [tool("x")];

  it("blocks a resume when the instructions drifted, unless explicitly allowed (§9.3-6)", () => {
    const compiled = compileAgent({ name: "assistant", tools, instructions: "v1" });
    const cp = checkpoint(agentSnapshotOf(compiled));

    assert.doesNotThrow(() => assertResumable(cp, compiled.agent));

    const drifted = compileAgent({ name: "assistant", tools, instructions: "v2" });
    assert.throws(() => assertResumable(cp, drifted.agent), CheckpointMismatchError);
    assert.doesNotThrow(() =>
      assertResumable(cp, drifted.agent, { allowInstructionChange: true }),
    );
  });

  it("stays compatible with pre-M7-5 checkpoints that have no instructionsHash (§9.3-7)", () => {
    const compiled = compileAgent({ name: "assistant", tools, instructions: "v1" });
    // A checkpoint written before M7-5: only agentId + toolsHash.
    const legacy = checkpoint({ agentId: "assistant", toolsHash: compiled.toolsHash });

    const drifted = compileAgent({ name: "assistant", tools, instructions: "v2" });
    assert.doesNotThrow(() => assertResumable(legacy, drifted.agent));

    // The hard guard still applies: a tool-set change is never resumable.
    const wider = compileAgent({ name: "assistant", tools: [tool("x"), tool("y")] });
    assert.throws(() => assertResumable(legacy, wider.agent), CheckpointMismatchError);
  });

  it("still refuses a foreign agent id", () => {
    const compiled = compileAgent({ name: "assistant", tools });
    const cp = checkpoint(agentSnapshotOf(compiled));
    const other = compileAgent({ name: "someone-else", tools });
    assert.throws(() => assertResumable(cp, other.agent), CheckpointMismatchError);
  });
});
