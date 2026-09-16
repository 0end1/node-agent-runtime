// 发布收尾：将已上架但有缺陷的 0.4.0 标记为 deprecated，引导升级到 0.4.1。
//
// 背景：0.4.0 缺少 workspace 内部依赖声明（core/host 等包 install 后无法被解析，
// 见 docs/m7-base-governance.md §6 复盘），0.4.1 已补齐并作为 latest。
//
// 用法（需本机已登录 npm，或注入 NPM_TOKEN）：
//   npm login            # 或在环境中 export NPM_TOKEN=<granular-or-session-token>
//   node scripts/deprecate-040.mjs
//
// 说明：deprecate 只写一条提示、可逆（之后可 un-deprecate），不影响 latest=0.4.1。

import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "packages");

const MSG =
  "Deprecated: 0.4.0 is missing workspace internal dependency declarations, so @node-agent-runtime/* packages are not resolvable after install. Upgrade to 0.4.1: npm i @node-agent-runtime/<pkg>@0.4.1";

const dirs = await readdir(pkgDir, { withFileTypes: true });
let failed = 0;

for (const d of dirs) {
  if (!d.isDirectory()) continue;
  const pjPath = path.join(pkgDir, d.name, "package.json");
  const pj = JSON.parse(await readFile(pjPath, "utf8"));
  const target = `${pj.name}@0.4.0`;
  process.stdout.write(`deprecating ${target} ... `);
  try {
    await execFileP("npm", ["deprecate", target, MSG], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
    });
    process.stdout.write("ok\n");
  } catch (e) {
    failed += 1;
    process.stdout.write(`FAILED (${e.message})\n`);
  }
}

process.exit(failed === 0 ? 0 : 1);
