// 跨形态 E2E · Desktop 形态（M6 P2.4）
//
// Desktop（Tauri v2）需要 Rust + WebKit 等系统依赖，CI 与多数本机环境不具备，
// 故默认跳过；设置 `E2E_DESKTOP=1` 后以 dev 模式拉起（会顺带启动 Web server），
// 探测壳内控制台 API 是否可用。
import { join } from "node:path";

import { REPO_ROOT, removeDir, startProcess, waitForHttp } from "./lib.mjs";

const DESKTOP_DIR = join(REPO_ROOT, "examples", "desktop-tauri");

export async function runDesktop({ port = 8787, timeoutMs = 300000 } = {}) {
  if (process.env.E2E_DESKTOP !== "1") {
    console.log("  ⏭  Desktop 形态跳过（需 Tauri/Rust 环境；设置 E2E_DESKTOP=1 启用）");
    return [];
  }
  const proc = startProcess("npm", ["run", "tauri", "dev"], { cwd: DESKTOP_DIR });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/sessions`, { timeoutMs });
    console.log(`  ✅ Desktop（Tauri dev）壳内控制台可用（:${port}）`);
    return [{ title: "Desktop（Tauri dev）控制台可用", ok: true }];
  } finally {
    proc.stop();
    removeDir(join(DESKTOP_DIR, "src-tauri", "binaries"));
  }
}
