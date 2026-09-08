#!/usr/bin/env node
/**
 * 跨形态 E2E 入口（M6 P2.4）
 *
 *   npm run e2e                 # 默认跑 CLI + Web
 *   npm run e2e -- --only=web   # 只跑 Web
 *   npm run e2e -- --with-desktop   # 追加 Desktop（需 Tauri/Rust，等价 E2E_DESKTOP=1）
 *
 * 退出码：任一形态失败 → 1。
 */
import { runCli } from "./cli.mjs";
import { runDesktop } from "./desktop.mjs";
import { runWeb } from "./web.mjs";

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const withDesktop = argv.includes("--with-desktop");
const targets = only ? [only] : withDesktop ? ["cli", "web", "desktop"] : ["cli", "web"];

const runners = { cli: runCli, web: runWeb, desktop: runDesktop };

let failed = 0;
for (const target of targets) {
  console.log(`\n=== E2E · ${target} 形态 ===`);
  const runner = runners[target];
  if (!runner) {
    console.log(`  ❌ 未知形态：${target}（可选 cli / web / desktop）`);
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
