// E2E 公共设施（M6 P2.4）：临时工作区、进程驱动、SSE 读取、步骤报告。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// eslint-disable-next-line no-control-regex -- 需要匹配终端 ESC 控制字符以剥离 ANSI 颜色码
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (text) => String(text).replace(ANSI_RE, "");

export function makeWorkdir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function startProcess(cmd, args, { cwd, env = {} } = {}) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let raw = "";
  child.stdout.on("data", (chunk) => {
    raw += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    raw += chunk.toString("utf8");
  });
  return {
    child,
    get output() {
      return stripAnsi(raw);
    },
    send(line) {
      child.stdin.write(`${line}\n`);
    },
    /** 轮询进程输出直到命中谓词（返回命中值）或超时 */
    async waitFor(predicate, { timeoutMs = 30000, label = "条件" } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const text = stripAnsi(raw);
        const hit = predicate(text);
        if (hit) return hit;
        if (Date.now() > deadline) {
          throw new Error(`等待超时（${label}）。输出尾部：\n${text.slice(-500)}`);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    },
    stop() {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
  };
}

export async function waitForHttp(url, { timeoutMs = 40000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    if (Date.now() > deadline) throw new Error(`服务未就绪：${url}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** 轮询直到取值函数返回真值 */
export async function waitForValue(pick, { timeoutMs = 30000, label = "取值" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = pick();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等待超时（${label}）`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * 读取 SSE 流并按帧回调。帧格式：`data: {json}\n\n`。
 * 超时后取消读取（不抛错，交由调用方判定）。
 */
export async function readSSE(url, onEvent, { timeoutMs = 90000, init = {} } = {}) {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) throw new Error(`SSE 请求失败：${url}（${res.status}）`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timer = setTimeout(() => reader.cancel().catch(() => {}), timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            onEvent(JSON.parse(payload));
          } catch {
            /* ignore malformed frame */
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if (err?.name !== "AbortError" && err?.code !== "ERR_STREAM_PREMATURE_CLOSE") throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text } };
  }
}

export function assertIncludes(haystack, needle, label) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${label}：输出未包含「${needle}」`);
  }
}

export function createReporter(suite) {
  const steps = [];
  return {
    suite,
    async step(title, fn) {
      const started = Date.now();
      try {
        await fn();
        const ms = Date.now() - started;
        steps.push({ title, ok: true, ms });
        console.log(`  ✅ ${title}（${ms}ms）`);
      } catch (err) {
        steps.push({ title, ok: false, ms: Date.now() - started, error: err.message });
        console.log(`  ❌ ${title} — ${err.message}`);
        throw err;
      }
    },
    steps,
  };
}
