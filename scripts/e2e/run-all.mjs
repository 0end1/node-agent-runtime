#!/usr/bin/env node
/**
 * 跨形态 E2E 入口（M6 P2.4）
 *
 *   npm run e2e                 # 默认跑 CLI + Web + ACP
 *   npm run e2e -- --only=web   # 只跑 Web
 *
 * 退出码：任一形态失败 → 1。
 *
 * 注：Desktop 形态（Tauri 壳）已于 2026-09-17 随桌面端整体从仓库移除，
 *     相关 runner（scripts/e2e/desktop.mjs）与 --with-desktop 开关一并删除。
 *     ACP 形态（M8-2/M8-3）于 2026-09-17 加入：真实 agent 子进程 + 协议级
 *     客户端，覆盖审批往返、模式切换与取消。
 */
import { runAcp } from "./acp.mjs";
import { runCli } from "./cli.mjs";
import { runWeb } from "./web.mjs";

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const targets = only ? [only] : ["cli", "web", "acp"];

const runners = { cli: runCli, web: runWeb, acp: runAcp };

let failed = 0;
for (const target of targets) {
  console.log(`\n=== E2E · ${target} 形态 ===`);
  const runner = runners[target];
  if (!runner) {
    console.log(`  ❌ 未知形态：${target}（可选 cli / web）`);
    failed += 1;
    continue;
  }
  try {
    await runner();
  } catch (err) {
    failed += 1;
    console.log(`  ❌ ${target} 形态失败：${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\nE2E 未通过（${failed} 个形态失败）`);
  process.exit(1);
}
console.log("\nE2E 全部通过");
