// 生产打包：准备 Tauri sidecar 所需的两个文件
//   1) agent-server.js —— examples/web/server.ts 打成的自包含 CJS 单文件（作为 resource 进 app）
//   2) node-<triple>   —— 当前 Node 运行时副本（作为 externalBin，app 自带运行时，不依赖目标机装 Node）
// 路径基于本文件位置解析，不依赖 cwd（Tauri 在 examples/desktop-tauri/ 执行 beforeBuildCommand）。
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../.."); // 仓库根
const binaries = resolve(here, "src-tauri/binaries");

mkdirSync(binaries, { recursive: true });

// 目标三元组（与 Rust target triple 对齐），externalBin 按 `<name>-<triple>` 查找。
const archMap = { x64: "x86_64", arm64: "aarch64" };
const osMap = { darwin: "apple-darwin", linux: "unknown-linux-gnu", win32: "pc-windows-msvc" };
const triple = `${archMap[process.arch] ?? process.arch}-${osMap[process.platform] ?? process.platform}`;

// 1) server bundle：CJS 单文件。
//    CJS 下 `import.meta.url` 不可用（依赖链用它定位路径），故 define 替换为 __metaUrl，
//    并由 banner 注入等价的 CommonJS 实现（file:// 形式的当前模块 URL）。
const jsOut = join(binaries, "agent-server.js");
execSync(
  `${root}/node_modules/.bin/esbuild ${root}/examples/web/server.ts ` +
    `--bundle --platform=node --format=cjs ` +
    `--define:import.meta.url=__metaUrl ` +
    `--banner:js="var __metaUrl=require('node:url').pathToFileURL(__filename).href;" ` +
    `--outfile=${jsOut}`,
  { stdio: "inherit" },
);

// 2) Node 运行时副本（app 自带，避免依赖目标机 PATH 中的 node）。
const nodeOut = join(binaries, `node-${triple}`);
copyFileSync(process.execPath, nodeOut);
execSync(`chmod +x ${nodeOut}`);

// 3) 静态控制台（examples/web/public）：复制到 binaries/public，
//    以便与 server bundle 一起以 resource 平铺进 app（避免 frontendDist 上越路径不被复制）。
const publicOut = join(binaries, "public");
execSync(
  `rm -rf ${publicOut} && cp -R ${join(root, "examples/web/public")} ${publicOut}`,
  { stdio: "inherit" },
);

console.log(`[build-server] server bundle -> ${jsOut}`);
console.log(`[build-server] node runtime  -> ${nodeOut}`);
console.log(`[build-server] static assets -> ${publicOut}`);
