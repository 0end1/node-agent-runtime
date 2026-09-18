#!/usr/bin/env node
/**
 * `create-node-agent-runtime` —— 生成第一个受治理的 Agent 项目（M8-1 生态入口）。
 *
 *   npx create-node-agent-runtime my-agent
 *
 * 取舍：
 *  - **零运行时依赖**（只用 node: 内置）—— 脚手架是别人 `npx` 拉的第一个包，
 *    依赖越少、装得越快，「5 分钟跑通」才成立；
 *  - **交互只在 TTY 下进行**，非 TTY（CI / 管道）一律取默认值 —— 脚手架必须
 *    在自动化里也能跑（`--yes` 与非交互默认等价）；
 *  - **绝不覆盖已有文件**（见 `scaffold.ts`）—— 在非空目录误跑时不该毁文件。
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { basename, resolve } from "node:path";

import { toPackageName } from "./name.js";
import { scaffold } from "./scaffold.js";

const DEFAULT_DIR = "my-agent";

const HELP = `create-node-agent-runtime — 生成第一个受治理的 Agent 项目

用法：
  npx create-node-agent-runtime [目录] [选项]

选项：
  --name <name>   指定 package.json 的 name（默认取目录名）
  --yes           全部取默认值，不提问
  -h, --help     显示本帮助

生成后：
  cd <目录> && npm install && npm start
`;

interface CliOptions {
  dir?: string;
  name?: string;
  yes: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--name" || arg.startsWith("--name=")) {
      options.name = arg.includes("=") ? arg.slice("--name=".length) : argv[++i];
    } else if (!arg.startsWith("-") && !options.dir) options.dir = arg;
  }
  return options;
}

async function ask(question: string, fallback: string): Promise<string> {
  if (!input.isTTY) return fallback;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question}（${fallback}）：`)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    output.write(HELP);
    return;
  }

  const dir = options.dir ?? (await ask("项目目录", DEFAULT_DIR));
  const target = resolve(process.cwd(), dir);
  const name = toPackageName(options.name ?? basename(target));

  const result = await scaffold({ dir: target, name });

  output.write(`\n✅ 已生成 ${result.files.length} 个文件 → ${result.dir}\n`);
  for (const file of result.files) output.write(`   ${file}\n`);
  output.write(`\n下一步：\n   cd ${dir}\n   npm install\n   npm start\n\n`);
}

main().catch((error: unknown) => {
  output.write(`\n❌ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
