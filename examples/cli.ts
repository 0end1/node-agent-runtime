#!/usr/bin/env tsx
/**
 * Interactive CLI demo of the Agent runtime (M1..M4 productization surface).
 *
 *   npm run demo:cli                    # mock provider (no API key)
 *   OPENAI_API_KEY=sk-xxx npm run demo:cli   # real OpenAI-compatible provider
 *
 * Conversations live in a SessionManager backed by FileStorage, so quitting
 * and re-running resumes the most recent session with full context.
 *
 * Commands (slash):
 *   /new                     start a brand-new session
 *   /list                    list persisted sessions
 *   /use <id>                switch to an existing session
 *   /checkpoints             list checkpoints of the current task (for /resume)
 *   /resume <id> [续跑说明]    continue a task from a checkpoint (M2)
 *   /approve <id> [always]   allow a pending tool (M3 ask)
 *   /deny <id> [理由]         reject a pending tool (M3 ask)
 *   /artifacts               list this session's artifacts (M4)
 *   /artifact <id>           show an artifact's text content (M4)
 *   /audit                   show the persisted approval audit trail (P3.3)
 *   /grants                  list "always allow" grants (P3.3)
 *   /revoke <tool>           remove an "always allow" grant (P3.3)
 *   exit / Ctrl+C            quit
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { join } from "node:path";

import {
  Agent,
  AgentRuntime,
  FileStorage,
  defineTool,
  loadConfig,
  ConsoleLogger,
  errorPayload,
  type AnyTool,
  type LogLevel,
  type ModelProvider,
  type RuntimeConfig,
  type RuntimeEvent,
} from "@node-agent-runtime/core";
import { SessionManager, type Session } from "@node-agent-runtime/host";
import { createProductionDefaults } from "@node-agent-runtime/policy";
import { MockProvider } from "@node-agent-runtime/mock";
import {
  McpClient,
  McpRegistry,
  StdioTransport,
  StreamableHttpTransport,
  type McpServerHandle,
} from "@node-agent-runtime/mcp";
import { OpenAIClientProvider } from "@node-agent-runtime/provider-openai";
import { SQLiteStorage } from "@node-agent-runtime/store-sqlite";
import { builtinTools } from "@node-agent-runtime/tools-basic";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Parse `--mcp <spec>` / `--mcp=<spec>` args (repeatable). Two transports:
 *   --mcp stdio:<command...>      spawn a child process (npx -y @scope/server …)
 *   --mcp https://host/mcp        Streamable HTTP endpoint
 */
function collectMcpSpecs(argv: string[]): string[] {
  const specs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--mcp=")) specs.push(a.slice("--mcp=".length));
    else if (a === "--mcp" && argv[i + 1]) specs.push(argv[++i]!);
  }
  return specs;
}

/** Derive a registry-safe server name (no "__") for the `mcp__<name>__<tool>` prefix. */
function mcpName(spec: string, i: number): string {
  let base: string;
  if (spec.startsWith("stdio:")) {
    const rest = spec.slice("stdio:".length).trim();
    base = rest.split(/\s+/)[0]?.split(/[\\/]/).pop() ?? `mcp${i + 1}`;
  } else {
    try {
      base = new URL(spec).host.replace(/^www\./, "");
    } catch {
      base = `mcp${i + 1}`;
    }
  }
  return base.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_") || `mcp${i + 1}`;
}

function buildMcpHandle(
  spec: string,
  i: number,
  mcp: RuntimeConfig["mcp"],
  debug: boolean,
): McpServerHandle {
  const trace = (line: string) => {
    if (debug) console.log(`\x1b[90m${line}\x1b[0m`);
  };
  // P3.6: 供应链防护参数来自 loadConfig（config.mcp），由 config.ts 集中解析
  // AGENT_MCP_HTTP_ALLOWLIST / AGENT_MCP_STDIO_TIMEOUT_MS / AGENT_MCP_ENV_*——
  // 宿主不再散落魔法 env 读取，stdio server 的凭据经 serverEnv 注入子进程。
  const httpAllowlist = mcp?.httpUrlAllowlist;
  const stdioTimeout = mcp?.stdioStartTimeoutMs;
  const serverEnv = mcp?.serverEnv;
  if (spec.startsWith("stdio:")) {
    const rest = spec.slice("stdio:".length).trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    if (!parts.length) throw new Error("stdio: 后需要命令");
    return new McpClient({
      name: mcpName(spec, i),
      transport: new StdioTransport({
        command: parts[0],
        args: parts.slice(1),
        logger: trace,
        ...(stdioTimeout ? { startTimeoutMs: stdioTimeout } : {}),
        ...(serverEnv ? { env: serverEnv } : {}),
      }),
      logger: trace,
    });
  }
  if (/^https?:\/\//.test(spec)) {
    return new McpClient({
      name: mcpName(spec, i),
      transport: new StreamableHttpTransport({
        url: spec,
        logger: trace,
        ...(httpAllowlist ? { urlAllowlist: httpAllowlist } : {}),
      }),
      logger: trace,
    });
  }
  throw new Error(`无法识别的 --mcp 规格：${spec}（支持 stdio:<命令...> 或 http(s)://...）`);
}

/** Demo-only write tool (M3): declares `kind: "write"` so the default policy
 *  gates it with an `ask`, and the sandbox keeps the write inside cwd. Lets the
 *  approval + sandbox-write surfaces be exercised end-to-end from the CLI. */
const demoWriteTool = defineTool({
  name: "demo_write_file",
  description:
    "把文本写入工作区内的一个文件（演示用：会触发人工授权，且沙箱写可见）。路径相对于当前工作目录，例如 .demo-out/note.txt。",
  meta: { kind: "write", pathArgs: ["path"] },
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的文件路径，如 .demo-out/note.txt" },
      content: { type: "string", description: "要写入的文本内容" },
    },
    required: ["path", "content"],
  },
  async execute(args: { path: string; content: string }) {
    const full = resolve(process.cwd(), args.path);
    await mkdir(dirname(full), { recursive: true });
    const text = String(args.content ?? "");
    await writeFile(full, text, "utf8");
    // M6 P2.4 加固：写文件落盘后登记为可引用 artifact，使 M4 artifact 能力
    // 在 demo 与 E2E 中真正被覆盖（此前从未登记，artifacts 恒为空）。
    try {
      if (managerRef && currentSessionId) {
        await managerRef.artifacts.save({
          sessionId: currentSessionId,
          kind: "file",
          name: args.path,
          content: text,
        });
      }
    } catch {
      /* artifact 登记失败不应影响写文件主流程 */
    }
    return { ok: true, path: full, bytes: Buffer.byteLength(text) };
  },
});

// 延迟引用：demo 工具需会话/管理器上下文，而它们在 main() 内创建，
// 故用模块级引用在运行时（而非定义时）读取最新值。
let managerRef: SessionManager | undefined;
let currentSessionId: string | undefined;

const argv = process.argv.slice(2);
const wantsOpenAI = argv.includes("--provider=openai") || argv.includes("--openai");
const wantsSqlite = argv.includes("--storage=sqlite");
const mcpSpecs = collectMcpSpecs(argv);

// P3.8: 集中、分层的运行时配置（密钥只经配置/环境注入，无散落 magic env 读取）。
const config = loadConfig({
  env: process.env,
  overrides: wantsOpenAI ? { provider: { kind: "openai" } } : {},
});

function nodeSupportsSqlite(): boolean {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return maj > 22 || (maj === 22 && (min ?? 0) >= 13);
}
if (wantsSqlite && !nodeSupportsSqlite()) {
  console.error(
    "⚠ --storage=sqlite 需要 Node >= 22.13（node:sqlite）。请升级 Node 或去掉该参数改用默认 FileStorage。",
  );
  process.exit(1);
}

function pickProvider(): ModelProvider {
  if (config.provider.kind === "openai") {
    return new OpenAIClientProvider({
      apiKey: config.provider.apiKey,
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
    });
  }
  return new MockProvider();
}

function describeEvent(e: RuntimeEvent): string {
  switch (e.type) {
    case "step:start":
      return `\n  \x1b[36m▶ 步骤 ${e.step}\x1b[0m`;
    case "model:response": {
      if (e.message.toolCalls?.length) {
        return `    \x1b[2m模型决策：调用 ${e.message.toolCalls.map((t) => t.name).join(", ")}\x1b[0m`;
      }
      return "";
    }
    case "tool:start": {
      const args = JSON.stringify(e.toolCall.arguments);
      return `    \x1b[33m⚙ ${e.toolCall.name}(${args.length > 90 ? args.slice(0, 90) + "…" : args})\x1b[0m`;
    }
    case "tool:end": {
      const state = e.ok ? "\x1b[32m✓" : "\x1b[31m✗";
      const result = e.result.length > 140 ? e.result.slice(0, 140) + "…" : e.result;
      return `      ${state}\x1b[0m (${e.durationMs}ms) ${result}`;
    }
    default:
      return "";
  }
}

function printOutcome(outcome: {
  run: {
    output: string;
    id: string;
    usage: { modelCalls: number; inputTokens: number; outputTokens: number };
  };
  task: { id: string };
}): void {
  console.log(`\n\x1b[1m助手\x1b[0m > ${outcome.run.output}`);
  console.log(
    `\x1b[90m(task=${outcome.task.id.slice(-6)} · run=${outcome.run.id.slice(-6)} · round-trips=${outcome.run.usage.modelCalls} · input=${outcome.run.usage.inputTokens} · output=${outcome.run.usage.outputTokens})\x1b[0m`,
  );
}

/** P3.1: 统一错误出口——按稳定错误码呈现，而不是把任意堆栈/文案甩给用户。 */
function printError(err: unknown): void {
  const info = errorPayload(err).error;
  console.error(`\x1b[31m出错 [${info.code}]\x1b[0m：${info.message}`);
}

async function main() {
  const provider = pickProvider();
  const debug = Boolean(process.env.AGENT_DEBUG) || config.logLevel === "debug";
  const logger = new ConsoleLogger({ level: (debug ? "debug" : config.logLevel) as LogLevel });
  const runtime = new AgentRuntime({
    provider,
    logger,
    // P3.4: 运行级预算（步数/时长/token/费用/工具速率）来自 config.limits。
    limits: config.limits,
  });
  // ---- Optional MCP servers: connect at startup and materialize their tools ----
  const mcpRegistry = new McpRegistry();
  const mcpTools: AnyTool[] = [];
  for (let i = 0; i < mcpSpecs.length; i++) {
    try {
      const handle = buildMcpHandle(mcpSpecs[i]!, i, config.mcp, debug);
      const reg = await mcpRegistry.register(handle);
      mcpTools.push(...reg.tools);
      console.log(`\x1b[36m[MCP] 已注册 ${reg.name}：${reg.tools.length} 个工具\x1b[0m`);
    } catch (err) {
      console.error(
        `\x1b[31m[MCP] 注册失败 ${mcpSpecs[i]}：${err instanceof Error ? err.message : err}\x1b[0m`,
      );
    }
  }

  const agent = new Agent({
    name: "assistant",
    instructions:
      "你是 Agent 运行时演示助手。需要精确计算/查询时先调用工具，再基于工具结果用简洁中文作答，不要编造数据。",
    tools: [...builtinTools, demoWriteTool, ...mcpTools],
  });

  const DATA_DIR = process.env.RUNTIME_DATA ?? ".runtime-data";
  const storage = wantsSqlite
    ? new SQLiteStorage({ file: process.env.SQLITE_FILE ?? join(DATA_DIR, "agent.db") })
    : new FileStorage(DATA_DIR);
  // P3.7: 生产默认——最小权限策略 + 锁定沙箱域（禁网、仅工作区内可写）。
  // P3.3: 不再手动 new PermissionManager——SessionManager 默认管理器会把审批
  // 审计与 always 白名单写入 approvalStore（本机 FileStorage/SQLite 持久化）。
  const prod = createProductionDefaults(process.cwd());
  const manager = new SessionManager({
    runtime,
    storage,
    agents: [agent],
    sandboxMode: prod.sandboxMode,
    scope: prod.scope,
    policy: prod.policy,
  });
  managerRef = manager;
  const rl = readline.createInterface({ input, output });

  // Resume the most recent open session if one exists.
  let current: Session | undefined = (await manager.listSessions())
    .filter((s) => s.status !== "closed")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  let busy = false;
  let lastTaskId: string | undefined;

  // ---- Governance events (M3): surface approval requests + writes ----
  runtime.events.on("permission:request", (e) => {
    console.log(`\n  \x1b[35m⚠ 需要授权：工具 ${e.toolName}\x1b[0m`);
    console.log(`    \x1b[2m(decisionId=${e.decisionId} · ${e.reason})\x1b[0m`);
    console.log(
      `    \x1b[2m↳ 输入 /approve ${e.decisionId} [always] 或 /deny ${e.decisionId}\x1b[0m`,
    );
    if (!busy) rl.prompt();
  });
  runtime.events.on("sandbox:write", (e) => {
    if (!e.ok) return;
    const diff = e.diff ? `\n${e.diff.split("\n").slice(0, 12).join("\n")}` : "";
    console.log(`    \x1b[32m✎ 沙箱写入 ${e.toolName} → ${e.paths.join(", ")}\x1b[0m${diff}`);
  });

  function promptText(): string {
    return `\x1b[1m你 [${current?.id.slice(-6) ?? "----"}]\x1b[0m > `;
  }

  async function startNewSession(): Promise<void> {
    current = await manager.createSession({ agentId: agent.name });
    console.log(`\n\x1b[36m新会话已创建：${current.id}\x1b[0m`);
    rl.setPrompt(promptText());
  }

  async function useSession(id: string): Promise<void> {
    const s = await manager.getSession(id);
    if (!s) {
      console.log(`\x1b[31m没有找到会话 ${id}（试试 /list）\x1b[0m`);
      return;
    }
    if (s.status === "closed") {
      console.log(`\x1b[31m会话 ${id} 已关闭，无法继续\x1b[0m`);
      return;
    }
    current = s;
    lastTaskId = undefined;
    const history = await manager.messages(s.id);
    console.log(`\x1b[36m已切换到会话 ${s.id}（历史 ${history.length} 条消息）\x1b[0m`);
    rl.setPrompt(promptText());
  }

  if (!current) {
    await startNewSession();
  }

  // Subscribe to the run-event stream for one run, return an unsubscribe fn.
  function streamRun(): () => void {
    return runtime.subscribe((e) => {
      const line = describeEvent(e);
      if (line) console.log(line);
    });
  }

  async function handleLine(raw: string): Promise<void> {
    const text = raw.trim();
    currentSessionId = current?.id;
    if (!text) {
      if (!busy) rl.prompt();
      return;
    }

    // ---- Approval commands: answerable even while a run is blocked on ask ----
    const app = text.match(/^\/(approve|a)\s+(\S+)(?:\s+(always))?$/i);
    if (app) {
      const ok = manager.approve(app[2]!, { always: Boolean(app[3]) });
      console.log(ok ? `\x1b[32m已授权 ${app[2]}\x1b[0m` : `\x1b[31m无此待授权项 ${app[2]}\x1b[0m`);
      if (!busy) rl.prompt();
      return;
    }
    const den = text.match(/^\/(deny|d)\s+(\S+)(?:\s+([\s\S]*))?$/i);
    if (den) {
      const ok = manager.deny(den[2]!, den[3] || undefined);
      console.log(ok ? `\x1b[31m已拒绝 ${den[2]}\x1b[0m` : `\x1b[31m无此待授权项 ${den[2]}\x1b[0m`);
      if (!busy) rl.prompt();
      return;
    }

    if (text === "/new") {
      await startNewSession();
      return;
    }
    if (text === "/list") {
      const sessions = await manager.listSessions();
      if (!sessions.length) {
        console.log("（暂无会话）");
      } else {
        for (const s of sessions) {
          const msgs = (await manager.messages(s.id)).length;
          const mark = s.id === current?.id ? "  \x1b[36m← 当前\x1b[0m" : "";
          console.log(
            `  ${s.id}  \x1b[2m${s.title || "(无标题)"} · ${s.status} · ${msgs} msgs\x1b[0m${mark}`,
          );
        }
      }
      if (!busy) rl.prompt();
      return;
    }
    // ---- P3.3 approval audit trail + grants (persisted across restarts) ----
    if (text === "/audit") {
      const rows = await manager.approvals();
      if (!rows.length) {
        console.log("（暂无审批审计记录）");
      } else {
        console.log(`\x1b[36m最近 ${rows.length} 条治理决策：\x1b[0m`);
        for (const r of rows.slice(-12)) {
          const at = new Date(r.decidedAt).toISOString().slice(11, 19);
          const verdictColor = r.verdict === "approved" ? "\x1b[32m" : "\x1b[31m";
          console.log(
            `  ${at}  \x1b[2m${r.source.padEnd(12)}\x1b[0m ${r.toolName} → ${verdictColor}${r.verdict}\x1b[0m  ${r.reason ?? ""}${r.argumentsFingerprint ? `  \x1b[2m(fp=${r.argumentsFingerprint})\x1b[0m` : ""}`,
          );
        }
      }
      if (!busy) rl.prompt();
      return;
    }
    if (text === "/grants") {
      const g = await manager.grants();
      if (!g.length) {
        console.log("（暂无 always 白名单授权，用 /approve <id> always 添加）");
      } else {
        console.log(`\x1b[36m${g.length} 个 always 授权（持久化）：\x1b[0m`);
        for (const x of g) console.log(`  ${x.toolName}  \x1b[2m${new Date(x.grantedAt).toISOString()}\x1b[0m`);
      }
      if (!busy) rl.prompt();
      return;
    }
    const revokeMatch = text.match(/^\/revoke\s+(\S+)$/);
    if (revokeMatch) {
      manager.revokeGrant(revokeMatch[1]!);
      console.log(`已撤销 always 授权：${revokeMatch[1]}`);
      if (!busy) rl.prompt();
      return;
    }

    const useMatch = text.match(/^\/use\s+(\S+)$/);
    if (useMatch) {
      await useSession(useMatch[1]!);
      return;
    }

    if (text === "/checkpoints") {
      if (!lastTaskId) {
        console.log("（当前会话还没有任务/checkpoint，先聊一句）");
      } else {
        const ck = await manager.listCheckpoints(lastTaskId);
        if (!ck.length) {
          console.log("（暂无 checkpoint）");
        } else {
          console.log(`\x1b[36m当前任务的 ${ck.length} 个 checkpoint（最新在末）：\x1b[0m`);
          for (const c of ck) {
            console.log(`  ${c.id}  \x1b[2mstep ${c.step}\x1b[0m`);
          }
          console.log(`\x1b[2m用 /resume <id> [续跑说明] 续跑\x1b[0m`);
        }
      }
      if (!busy) rl.prompt();
      return;
    }

    const resumeMatch = text.match(/^\/resume\s+(\S+)(?:\s+([\s\S]*))?$/);
    if (resumeMatch) {
      if (busy) {
        console.log("(上一条还在跑，请稍候)");
        return;
      }
      busy = true;
      const unsub = streamRun();
      try {
        const outcome = await manager.resume(resumeMatch[1]!, resumeMatch[2]);
        lastTaskId = outcome.task.id;
        printOutcome(outcome);
      } catch (err) {
        printError(err);
      } finally {
        unsub();
        busy = false;
      }
      rl.prompt();
      return;
    }

    if (text === "/artifacts") {
      const list = await manager.artifacts.list(current!.id);
      if (!list.length) {
        console.log("（当前会话暂无 artifact）");
      } else {
        console.log(`\x1b[36m${list.length} 个 artifact：\x1b[0m`);
        for (const a of list) {
          console.log(`  ${a.id}  \x1b[2m${a.kind} · ${a.name} · ${a.mime}\x1b[0m`);
        }
      }
      if (!busy) rl.prompt();
      return;
    }
    const artMatch = text.match(/^\/artifact\s+(\S+)$/);
    if (artMatch) {
      const a = await manager.artifacts.get(artMatch[1]!);
      if (!a) {
        console.log(`\x1b[31m没有该 artifact\x1b[0m`);
      } else if (a.kind === "url") {
        console.log(`\x1b[36m${a.name}\x1b[0m → ${a.locator}`);
      } else {
        const payload = await manager.artifacts.readText(a.id);
        console.log(`\x1b[36m${a.name}\x1b[0m (\x1b[2m${a.mime}\x1b[0m):`);
        console.log(payload ?? "(无文本内容)");
      }
      if (!busy) rl.prompt();
      return;
    }

    if (text.startsWith("/")) {
      console.log(
        "未知命令。可用：/new  /list  /use <id>  /checkpoints  /resume <id>  /approve <id>  /deny <id>  /artifacts  /artifact <id>  /audit  /grants  /revoke <tool>  exit",
      );
      if (!busy) rl.prompt();
      return;
    }

    if (!current) await startNewSession();
    if (busy) {
      console.log("(上一条还在跑，请稍候)");
      return;
    }
    busy = true;
    const unsub = streamRun();
    try {
      const outcome = await manager.chat(current!.id, text);
      lastTaskId = outcome.task.id;
      printOutcome(outcome);
    } catch (err) {
      printError(err);
    } finally {
      unsub();
      busy = false;
    }
    rl.prompt();
  }

  console.log(
    `\x1b[1mAgent Runtime · CLI demo (Session 化 · M1~M4)\x1b[0m\n` +
      `Provider : \x1b[36m${provider.label}\x1b[0m\n` +
      `MCP      : \x1b[36m${mcpSpecs.length ? `${mcpTools.length} 工具 / ${mcpRegistry.list().length} server` : "（未注册，用 --mcp 接入）"}\x1b[0m\n` +
      `Storage  : \x1b[36m${DATA_DIR}/\x1b[0m\n` +
      `Session  : \x1b[36m${current!.id}\x1b[0m${current!.title ? ` · “${current!.title}”` : ""}\n` +
      `试试     : 3.5 + 2 * 4 = ?  /  把结论写入 demo.txt（会触发授权）  /  现在几点了？\n` +
      `命令     : /new  /list  /use <id>  /checkpoints  /resume <id>  /approve <id>  /deny <id>  /artifacts  /artifact <id>  /audit  /grants  /revoke <tool>  exit\n`,
  );
  rl.setPrompt(promptText());
  rl.prompt();

  let closing = false;
  const doExit = async () => {
    console.log("bye");
    await mcpRegistry.closeAll().catch(() => {});
    process.exitCode = 0;
  };

  rl.on("line", async (raw) => {
    await handleLine(raw);
    if (closing && !busy) doExit();
  });
  rl.on("close", () => {
    closing = true;
    if (!busy) doExit();
  });
  rl.on("SIGINT", () => {
    rl.close();
  });
}

main().catch((err) => {
  printError(err);
  process.exitCode = 1;
});
