/**
 * P5.6 · Web 部署形态冒烟：启动控制台并探活 `:8787`。
 *
 * 同一脚本既可在本地跑（验证 `deploy/` 的配置是否可用），也可作为容器内
 * `HEALTHCHECK` 之外的构建期验证。
 *
 * Usage:
 *   node scripts/smoke-web.mjs [--port=8787]
 *
 * 退出码：0 = 探活成功；1 = 超时或返回体不符合预期。
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const portArg = process.argv.find((a) => a.startsWith("--port="));
const PORT = Number(portArg ? portArg.split("=")[1] : (process.env.PORT ?? 8787));
const DEADLINE_MS = 30_000;

const child = spawn(process.execPath, ["--import", "tsx", "examples/web/server.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    AGENT_LOG_LEVEL: process.env.AGENT_LOG_LEVEL ?? "warn",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

let healthy = false;
let body = "";
const deadline = Date.now() + DEADLINE_MS;
while (Date.now() < deadline) {
  if (child.exitCode !== null) break;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
    body = await res.text();
    if (res.ok && JSON.parse(body)?.ok === true) {
      healthy = true;
      break;
    }
  } catch {
    // 端口尚未就绪
  }
  await sleep(300);
}

child.kill("SIGTERM");
await sleep(200);
if (child.exitCode === null) child.kill("SIGKILL");

if (healthy) {
  console.log(`✅ Web 控制台探活通过：http://127.0.0.1:${PORT}/healthz → ${body}`);
  process.exit(0);
}

console.error(`❌ Web 控制台探活失败（${DEADLINE_MS}ms 内未就绪）\n--- server log ---\n${log}`);
process.exit(1);
