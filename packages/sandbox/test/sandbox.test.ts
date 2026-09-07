import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  Agent,
  AgentRuntime,
  MemoryStorage,
  SessionManager,
  defineTool,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type RuntimeEvent,
  type SessionManagerOptions,
  type ToolExecutionContext,
} from "@agent-runtime/core";
import {
  LocalSandbox,
  SandboxTimeoutError,
  SandboxViolationError,
  classifyToolName,
  isPathAllowed,
  simpleDiff,
  type SandboxWriteInfo,
} from "@agent-runtime/sandbox";
import { PermissionManager, StaticPolicy } from "@agent-runtime/policy";

// --------------------------------------------------------------- test double

const dummyCtx: ToolExecutionContext = {
  conversationId: "conv",
  runId: "run",
  now: () => new Date(0),
};

function toolCallResp(name: string, args: Record<string, unknown>): ModelResponse {
  return {
    content: `调用 ${name}`,
    toolCalls: [{ id: `call_${Math.random()}`, name, arguments: JSON.stringify(args) }],
    finishReason: "tool_calls",
    usage: { inputTokens: 2, outputTokens: 2 },
  };
}

function finalResp(text: string): ModelResponse {
  return {
    content: text,
    toolCalls: [],
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

class ScriptedProvider implements ModelProvider {
  readonly id = "script";
  readonly label = "scripted test model";
  calls = 0;
  constructor(private readonly script: Array<() => ModelResponse>) {}
  async chat(_request: ModelRequest): Promise<ModelResponse> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls += 1;
    return step();
  }
}

function fixture(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "sandbox-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function manager(env: { runtime: AgentRuntime; storage: MemoryStorage }, agents: readonly Agent[]) {
  const events: RuntimeEvent[] = [];
  env.runtime.subscribe((e) => events.push(e));
  return { manager: new SessionManager({ runtime: env.runtime, storage: env.storage, agents }), events };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timeout");
    await tick();
  }
}

// -------------------------------------------------------------------- tests

describe("classifyToolName (§6.1 sensitivity)", () => {
  it("maps built-in and risky tool names to a kind", () => {
    assert.equal(classifyToolName("calculator"), "harmless");
    assert.equal(classifyToolName("weather"), "harmless"); // local static data demo
    assert.equal(classifyToolName("fetch_weather"), "network-read");
    assert.equal(classifyToolName("edit_file"), "write");
    assert.equal(classifyToolName("run_tests"), "exec");
    assert.equal(classifyToolName("get_api_key"), "credential");
  });
});

describe("isPathAllowed (§6.2 declared write domain)", () => {
  const scope = { workspace: "/ws", writablePaths: ["/extra"], network: "deny" as const };
  it("accepts paths inside the workspace or extra writable roots", () => {
    assert.ok(isPathAllowed("/ws/a/b.txt", scope, "workspace-write"));
    assert.ok(isPathAllowed("/ws/./a.txt", scope, "workspace-write"));
    assert.ok(isPathAllowed("/extra/notes.md", scope, "workspace-write"));
  });
  it("rejects escapes and rejects everything when no root is declared", () => {
    assert.equal(isPathAllowed("/etc/passwd", scope, "workspace-write"), false);
    assert.equal(isPathAllowed("/ws2/x.txt", scope, "workspace-write"), false);
    assert.equal(isPathAllowed("/anything", { workspace: "", writablePaths: [], network: "deny" }, "workspace-write"), false);
  });
  it("full-access opens the boundary", () => {
    assert.ok(isPathAllowed("/etc/passwd", scope, "full-access"));
  });
});

describe("simpleDiff (§6.2 write is visible)", () => {
  it("emits +/- lines between before and after", () => {
    const diff = simpleDiff("a\nb", "a\nc");
    assert.match(diff, /- b/);
    assert.match(diff, /\+ c/);
  });
});

describe("LocalSandbox — run-level boundary (§6.2)", () => {
  const writeTool = defineTool({
    name: "write_file",
    description: "writes a file",
    meta: { kind: "write" },
    execute(args: { path: string; content: string }) {
      writeFileSync(args.path, args.content);
      return { ok: true };
    },
  });
  const fetchTool = defineTool({
    name: "fetch_data",
    description: "reads the network",
    meta: { kind: "network-read" },
    execute: () => ({ bytes: 42 }),
  });
  it("read-only mode blocks side-effect tools before they run", async (t) => {
    const dir = fixture(t);
    let executed = false;
    const probe = defineTool({
      name: "touch_file",
      description: "probe",
      meta: { kind: "write" },
      execute: (_args: Record<string, unknown>) => {
        executed = true;
        return "ran";
      },
    });
    const handle = await new LocalSandbox().begin("read-only", { workspace: dir, writablePaths: [], network: "deny" });
    await assert.rejects(async () => {
      await handle.wrap(probe).execute({ path: join(dir, "x") }, dummyCtx);
    }, SandboxViolationError);
    assert.equal(executed, false);
  });

  it("network is denied by default and opened by an allowlist", async () => {
    const handle = await new LocalSandbox().begin("workspace-write", {
      workspace: "/ws",
      writablePaths: [],
      network: "deny",
    });
    await assert.rejects(async () => {
      await handle.wrap(fetchTool).execute({}, dummyCtx);
    }, SandboxViolationError);

    const open = await new LocalSandbox().begin("workspace-write", {
      workspace: "/ws",
      writablePaths: [],
      network: "allowlist",
      networkAllowlist: ["weather.example"],
    });
    assert.deepEqual(await open.wrap(fetchTool).execute({}, dummyCtx), { bytes: 42 });
  });

  it("write tools cannot escape the declared workspace", async (t) => {
    const dir = fixture(t);
    const escapePath = join(dir, "..", `escape-${Date.now()}.txt`);
    const handle = await new LocalSandbox().begin("workspace-write", { workspace: dir, writablePaths: [], network: "deny" });
    await assert.rejects(async () => {
      await handle.wrap(writeTool).execute({ path: escapePath, content: "x" }, dummyCtx);
    }, SandboxViolationError);
    assert.equal(existsSync(escapePath), false); // nothing was written outside
  });

  it("kills a tool that exceeds its execution budget", async () => {
    const sleepy = defineTool({
      name: "sleep",
      description: "sleeps",
      execute: (_args: Record<string, unknown>) =>
        new Promise((resolve) => setTimeout(() => resolve("done"), 200)),
    });
    const sandbox = new LocalSandbox({ timeoutMs: 30 });
    const handle = await sandbox.begin("read-only", { workspace: "", writablePaths: [], network: "deny" });
    await assert.rejects(async () => {
      await handle.wrap(sleepy).execute({}, dummyCtx);
    }, SandboxTimeoutError);
  });

  it("publishes a best-effort diff for write tools (write is visible)", async (t) => {
    const dir = fixture(t);
    const writes: SandboxWriteInfo[] = [];
    const sandbox = new LocalSandbox({ onWrite: (info) => writes.push(info) });
    const handle = await sandbox.begin(
      "workspace-write",
      { workspace: dir, writablePaths: [], network: "deny" },
      { runId: "run1", sessionId: "s1", taskId: "t1" }
    );
    await handle.wrap(writeTool).execute({ path: join(dir, "a.txt"), content: "line1\nline2" }, dummyCtx);

    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.toolName, "write_file");
    assert.equal(writes[0]!.runId, "run1");
    assert.match(writes[0]!.diff ?? "", /\+ line1/);
  });
});

describe("M3 integration — SessionManager enforces the boundary (§11 M3 验收)", () => {
  type EnvOptions = Partial<Omit<SessionManagerOptions, "runtime" | "storage" | "agents">>;

  function makeEnv(script: Array<() => ModelResponse>, agents: readonly Agent[], options: EnvOptions = {}) {
    const provider = new ScriptedProvider(script);
    const runtime = new AgentRuntime({ provider });
    const storage = new MemoryStorage();
    const events: RuntimeEvent[] = [];
    runtime.subscribe((e) => events.push(e));
    const mgr = new SessionManager({ runtime, storage, agents, ...options });
    return { runtime, storage, mgr, events };
  }

  it("read-only mode: an exec tool is refused and the model gets the denial", async (t) => {
    const dir = fixture(t);
    let executed = false;
    const execTool = defineTool({
      name: "run_command",
      description: "runs a command",
      meta: { kind: "exec" },
      execute: () => {
        executed = true;
        return "stdout";
      },
    });
    const coder = new Agent({ name: "coder", tools: [execTool] });
    const env = makeEnv(
      [() => toolCallResp("run_command", { cmd: "ls" }), () => finalResp("命令未执行")],
      [coder],
      { sandboxMode: "read-only", scope: { workspace: dir, writablePaths: [], network: "deny" } }
    );
    const session = await env.mgr.createSession({ agentId: "coder", title: "ro" });
    const out = await env.mgr.chat(session.id, "跑一下 ls");

    assert.equal(executed, false);
    assert.equal(out.run.output, "命令未执行");
    // the denial was fed back to the model as a tool error, and it self-corrected
    const messages = await env.mgr.messages(session.id);
    const toolResult = messages.find((m) => m.role === "tool");
    assert.ok(JSON.stringify(toolResult?.content).includes("未获授权"));
  });

  it("workspace-write: a write tool asks, the host approves, the write lands (diff visible)", async (t) => {
    const dir = fixture(t);
    const writeTool = defineTool({
      name: "edit_file",
      description: "writes a file in the workspace",
      meta: { kind: "write", pathArgs: ["path"] },
      execute(args: { path: string; content: string }) {
        writeFileSync(args.path, args.content);
        return { ok: true, written: args.path };
      },
    });
    const editor = new Agent({ name: "editor", tools: [writeTool] });
    const target = join(dir, "notes.txt");
    const env = makeEnv(
      [() => toolCallResp("edit_file", { path: target, content: "hello m3" }), () => finalResp("写完了")],
      [editor],
      { sandboxMode: "workspace-write", scope: { workspace: dir, writablePaths: [], network: "deny" } }
    );
    const session = await env.mgr.createSession({ agentId: "editor", title: "ww" });

    const pending = env.mgr.chat(session.id, "把 notes.txt 写成 hello m3");
    await waitFor(() => env.mgr.pendingApprovals().length === 1);
    assert.equal(env.mgr.pendingApprovals()[0]!.toolName, "edit_file");
    assert.ok(env.events.some((e) => e.type === "permission:request"));

    assert.equal(env.mgr.approve(env.mgr.pendingApprovals()[0]!.decisionId), true);
    const out = await pending;

    assert.equal(out.run.output, "写完了");
    assert.equal(out.task.status, "done");
    assert.equal(existsSync(target), true);
    // write-is-visible event carries the path and a diff
    const writeEvent = env.events.find((e) => e.type === "sandbox:write");
    assert.ok(writeEvent && writeEvent.type === "sandbox:write");
    assert.ok(writeEvent.paths.includes(target));
    assert.match(writeEvent.diff ?? "", /\+ hello m3/);
  });

  it("deny = policy allow does not beat a read-only sandbox (defense in depth)", async (t) => {
    const dir = fixture(t);
    let executed = false;
    const writeTool = defineTool({
      name: "write_file",
      description: "writes a file",
      meta: { kind: "write" },
      execute: () => {
        executed = true;
        return "wrote";
      },
    });
    const editor = new Agent({ name: "editor", tools: [writeTool] });
    // policy would allow everything — the sandbox boundary still holds
    const provider = new ScriptedProvider([() => toolCallResp("write_file", { path: "x" }), () => finalResp("done")]);
    const runtime = new AgentRuntime({ provider });
    const events: RuntimeEvent[] = [];
    runtime.subscribe((e) => events.push(e));
    const mgr = new SessionManager({
      runtime,
      storage: new MemoryStorage(),
      agents: [editor],
      sandboxMode: "read-only",
      scope: { workspace: dir, writablePaths: [], network: "deny" },
      permission: new PermissionManager({ events: runtime.events, policy: new StaticPolicy({ verdict: "allow" }) }),
    });
    const session = await mgr.createSession({ agentId: "editor", title: "deep" });
    const out = await mgr.chat(session.id, "写 x");

    assert.equal(executed, false);
    assert.equal(out.run.output, "done");
  });
});
