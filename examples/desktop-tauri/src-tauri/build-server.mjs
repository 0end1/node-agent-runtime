/**
 * P5.3 · 把 Web 控制台打包成 Tauri sidecar 需要的资源。
 *
 * 由 `tauri.conf.json` 的 `beforeBuildCommand` 调用（cwd = `src-tauri/`），产物：
 *
 *   binaries/agent-server.js        esbuild bundle 后的控制台入口（自包含，无需 node_modules）
 *   binaries/public                 前端静态资源（随 resources 打进包）
 *   binaries/node-<target-triple>   sidecar Node（Tauri 按目标三元组查找 externalBin）
 *
 * 设计取舍：
 *   · 用 esbuild 把 TS 源码与 workspace 依赖一起 bundle，避免把整个 node_modules 塞进安装包；
 *   · sidecar Node **优先复用当前解释器**（同一 OS 构建同平台产物时最可靠），
 *     交叉编译时用 `NODE_BIN` 指向预先下载好的对应平台二进制。
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // src-tauri/
const APP_DIR = resolve(HERE, ".."); // examples/desktop-tauri
const REPO_ROOT = resolve(APP_DIR, "../.."); // 仓库根
const OUT = join(HERE, "binaries");

/** Tauri externalBin 的查找名：<name>-<target-triple>[.exe] */
function targetTriple() {
  const fromEnv = process.env.TAURI_ENV_TARGET_TRIPLE;
  if (fromEnv) return fromEnv;
  const arch =
    process.arch === "x64"
      ? "x86_64"
      : process.arch === "arm64"
        ? "aarch64"
        : process.arch;
  const os =
    process.platform === "darwin"
      ? "apple-darwin"
      : process.platform === "win32"
        ? "pc-windows-msvc"
        : "unknown-linux-gnu";
  return `${arch}-${os}`;
}

function ensureEsbuild() {
  try {
    return import("esbuild");
  } catch {
    throw new Error(
      "缺少 esbuild：请在 examples/desktop-tauri 下执行 `npm install`（已声明为 devDependency）",
    );
  }
}

async function bundleServer() {
  const esbuild = await ensureEsbuild();
  mkdirSync(OUT, { recursive: true });
  await esbuild.build({
    entryPoints: [join(REPO_ROOT, "examples", "web", "server.ts")],
    outfile: join(OUT, "agent-server.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Node 内置模块不打包；其余（含 @agent-runtime/*）全部内联
    external: ["node:*"],
    sourcemap: false,
    logLevel: "warning",
    // server.ts 会读 process.cwd() 下的 .runtime-data，bundle 后仍按运行目录解析
    define: { "process.env.NODE_ENV": '"production"' },
  });
  console.log("  ✓ agent-server.js");
}

/**
 * 让 sidecar 目录下的 `.js` 明确按 ESM 解析（不依赖 Node 的模块语法探测）。
 * 该 package.json 会随 resources 一起进 app，不含任何运行时依赖。
 */
function writeModuleMarker() {
  const marker = join(OUT, "package.json");
  writeFileSync(marker, `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`);
  console.log("  ✓ package.json（type: module）");
}

function copyPublic() {
  const src = join(REPO_ROOT, "examples", "web", "public");
  const dest = join(OUT, "public");
  if (!existsSync(src)) throw new Error(`缺少前端资源目录：${src}`);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log("  ✓ public/");
}

function prepareNode() {
  const triple = targetTriple();
  const ext = process.platform === "win32" ? ".exe" : "";
  const dest = join(OUT, `node-${triple}${ext}`);
  if (existsSync(dest)) {
    console.log(`  ✓ node-${triple}${ext}（已存在，跳过）`);
    return dest;
  }

  const candidate =
    process.env.NODE_BIN && existsSync(process.env.NODE_BIN)
      ? process.env.NODE_BIN
      : process.execPath;

  if (!existsSync(candidate)) {
    throw new Error(
      `未找到 sidecar Node：请设置 NODE_BIN 指向 ${triple} 的 node 二进制（可从 nodejs.org 下载对应平台分发包）`,
    );
  }
  mkdirSync(OUT, { recursive: true });
  copyFileSync(candidate, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);
  console.log(`  ✓ node-${triple}${ext} ← ${candidate}`);
  return dest;
}

console.log("build-server：准备 Tauri sidecar 资源");
await bundleServer();
writeModuleMarker();
copyPublic();
prepareNode();
console.log("build-server：完成");

// Cargo 需要知道资源是否变化（tauri-build 会读取），保持退出码 0
if (process.env.TAURI_ENV_DEBUG === "true") {
  try {
    execFileSync("node", ["--version"], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}
