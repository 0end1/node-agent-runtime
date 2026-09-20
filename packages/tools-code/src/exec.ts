import { spawn } from "node:child_process";
import { defineTool, type AnyTool } from "@node-agent-runtime/core";
import { limitsOf, truncateBytes, workspaceRoot, type CodeToolOptions } from "./paths.js";

/** 默认超时；`0` 表示不限（不推荐，仅装配方显式要求时）。 */
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;

/** 判定为凭据类、不应传给子进程的环境变量（保守过滤，宁可多滤）。 */
const SECRET_ENV_KEY = /(token|secret|credential|password|apikey|api_key|private_key)/i;

export interface BashToolOptions extends CodeToolOptions {
  /** 追加给子进程的环境变量（叠在过滤后的宿主环境之上）。 */
  env?: Record<string, string>;
}

export interface BashArgs extends Record<string, unknown> {
  command: string;
  /** 超时毫秒数，默认 30000；上限 600000。 */
  timeoutMs?: number;
}

export interface BashResult {
  command: string;
  /** 退出码；被信号终止时为 null。 */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

/**
 * 子进程环境：继承宿主但剔除凭据类变量。
 *
 * 命令由模型给出，默认继承环境变量等于把宿主的 `OPENAI_API_KEY` 等拱手送上；
 * 真正需要的变量由装配方通过 `options.env` 显式注入。
 */
function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SECRET_ENV_KEY.test(key)) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * 终止整个进程树。
 *
 * 关键点：沙箱自带的 `withTimeout()` 只是**不再 await** 那个 Promise，子进程
 * 仍在跑 —— 超时后变成无人回收的孤儿，还可能继续写文件。所以这里在 spawn 时
 * 用 `detached` 让子进程自成进程组，超时后 kill 整个组（`process.kill(-pid)`）；
 * Windows 无进程组概念，退回 `taskkill /T`。
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // 进程已退出：kill 失败即说明目的已达成
  }
}

/** `bash` —— 在作用域根下执行一条 shell 命令。 */
export function createBashTool(options: BashToolOptions = {}): AnyTool {
  const limits = limitsOf(options);
  const cwd = workspaceRoot(options);

  return defineTool<BashArgs, BashResult>({
    name: "bash",
    description:
      "在作用域根目录下执行一条 shell 命令，返回退出码与 stdout/stderr。有超时（默认 30s，超时会终止整个进程树）；不提供交互式会话。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的 shell 命令" },
        timeoutMs: { type: "number", description: "超时毫秒数，默认 30000，上限 600000" },
      },
      required: ["command"],
    },
    // 刻意**不声明 pathArgs 也不接受 cwd**：cwd 一旦可由模型指定，就成了绕过
    // 路径校验的越界通道（`cd /etc && cat passwd` 的参数是相对路径，查不出来）。
    meta: { kind: "exec" },
    async execute(args) {
      const command = String(args.command ?? "");
      if (command.trim().length === 0) {
        throw new Error("command 不能为空");
      }
      const requested = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutMs = Math.min(Math.max(1, Math.trunc(requested)), MAX_TIMEOUT_MS);

      const startedAt = Date.now();
      const child = spawn(command, {
        shell: true,
        cwd,
        env: childEnv(options.env),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });

      let out = "";
      let err = "";
      let outTruncated = false;
      let errTruncated = false;

      child.stdout?.on("data", (chunk: Buffer | string) => {
        if (outTruncated) return; // 已超限：继续 drain 但不累积
        out += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (Buffer.byteLength(out, "utf8") > limits.outputBytes) {
          outTruncated = true;
          out = truncateBytes(out, limits.outputBytes).text;
        }
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        if (errTruncated) return;
        err += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (Buffer.byteLength(err, "utf8") > limits.outputBytes) {
          errTruncated = true;
          err = truncateBytes(err, limits.outputBytes).text;
        }
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          killTree(child.pid);
          reject(new Error(`命令超时（${timeoutMs}ms），已终止进程树：${command.slice(0, 120)}`));
        }, timeoutMs);

        child.on("error", (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(code);
        });
      });

      // 非 0 退出码**不是异常** —— 命令失败是给模型的信息，交给它判断即可。
      return {
        command,
        exitCode,
        stdout: out,
        stderr: err,
        durationMs: Date.now() - startedAt,
        truncated: outTruncated || errTruncated,
      };
    },
  });
}
