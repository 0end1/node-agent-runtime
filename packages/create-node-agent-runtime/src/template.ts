/**
 * 新项目模板（M8-1 生态入口）。
 *
 * 模板以字符串常量内联在包里，而不是放在 `templates/` 目录随包复制 ——
 * 脚手架是**发布到 npm 的 CLI**，走 `files: ["dist"]` 发布；把模板编译进
 * `dist` 就没有「资源没被打进去」这一整类发布事故。
 *
 * 约束：本文件里的模板字符串**不得**包含未转义的 `${`（那会被当成插值）；
 * 生成物中若需要 shell/JS 插值，一律写成 `\${`。
 */
export interface TemplateOptions {
  /** 项目名（同时是生成物 package.json 的 name，必须 npm 合法）。 */
  name: string;
}

export interface TemplateFile {
  /** 相对目标目录的路径。 */
  path: string;
  contents: string;
}

const RUNTIME_VERSION = "^0.4.2";

function packageJson(name: string): string {
  return `${JSON.stringify(
    {
      name,
      version: "0.1.0",
      private: true,
      type: "module",
      description: "A governed agent built on node-agent-runtime.",
      scripts: {
        start: "tsx src/main.ts",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "@node-agent-runtime/core": RUNTIME_VERSION,
        "@node-agent-runtime/host": RUNTIME_VERSION,
        "@node-agent-runtime/mock": RUNTIME_VERSION,
        "@node-agent-runtime/policy": RUNTIME_VERSION,
        "@node-agent-runtime/tools-basic": RUNTIME_VERSION,
      },
      devDependencies: {
        "@types/node": "^22.10.2",
        tsx: "^4.19.2",
        typescript: "^5.7.2",
      },
      engines: { node: ">=22.13.0" },
    },
    null,
    2,
  )}\n`;
}

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      types: ["node"],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      noEmit: true,
    },
    include: ["src"],
  },
  null,
  2,
)}\n`;

const GITIGNORE = `node_modules/
dist/
.runtime-data/
workspace/
.env
`;

const ENV_EXAMPLE = `# 想接真实模型时填入（并 npm i @node-agent-runtime/provider-openai）
# OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=gpt-4o-mini
`;

const MAIN = `/**
 * 第一个受治理的 Agent —— 由 create-node-agent-runtime 生成。
 *
 *   npm install
 *   npm start
 *
 * 下面这三件事是**默认开启**的，不是演示开关：
 *   1. 工具要过策略 —— 写工具会触发审批，下方把决策点打印出来再批准
 *   2. 写入只在沙箱域内 —— scope.workspace = ./workspace，越界路径直接拒绝
 *   3. 过程可观测 —— permission:request / sandbox:write / 工具与用量事件
 *
 * 不需要任何 API Key：默认用 MockProvider（规则式、不联网）。
 */
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Agent, AgentRuntime, FileStorage, defineTool } from "@node-agent-runtime/core";
import { SessionManager } from "@node-agent-runtime/host";
import { createProductionDefaults } from "@node-agent-runtime/policy";
import { builtinTools } from "@node-agent-runtime/tools-basic";
import { MockProvider } from "@node-agent-runtime/mock";

// 接真实模型：npm i @node-agent-runtime/provider-openai，然后
//   import { OpenAIClientProvider } from "@node-agent-runtime/provider-openai";
//   const provider = new OpenAIClientProvider();  // 读 OPENAI_API_KEY
//
// MockProvider 是**规则式**的：只认计算 / 时间 / 天气 / 汇率这几种意图，
// 所以第一轮（计算）它一定会调工具，第二轮（写文件）它不会 —— 想看到
// write_note 触发审批，请换成上面的真实模型。
const provider = new MockProvider();

const workspace = resolve(process.cwd(), "workspace");
mkdirSync(workspace, { recursive: true });

/** 一个写工具：路径受沙箱域约束，调用前会先要一次授权。 */
const writeNote = defineTool({
  name: "write_note",
  description: "Write a note into the workspace sandbox.",
  meta: { kind: "write", pathArgs: ["path"] },
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对工作区的路径，如 notes/hello.txt" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute(args: { path: string; content: string }) {
    const full = resolve(workspace, args.path);
    mkdirSync(dirname(full), { recursive: true });
    await writeFile(full, args.content, "utf8");
    return { ok: true, path: full };
  },
});

const runtime = new AgentRuntime({ provider });

// P3.7 生产默认：最小权限策略 + 锁定沙箱域（禁网、仅工作区内可写）。
const prod = createProductionDefaults(workspace);

const manager = new SessionManager({
  runtime,
  storage: new FileStorage(".runtime-data"),
  agents: [
    new Agent({
      name: "assistant",
      instructions: "需要计算/查询就调用内置工具，需要写文件就调用 write_note，然后简洁作答。",
      tools: [...builtinTools, writeNote],
    }),
  ],
  sandboxMode: prod.sandboxMode,
  scope: prod.scope,
  policy: prod.policy,
});

// 治理在这里显形：谁要授权、谁真的写了盘。
runtime.events.on("permission:request", (event) => {
  console.log("⚠ 需要授权：" + event.toolName + "（" + event.reason + "）");
  // 真实产品里这里会弹 UI；此处自动批准一次，只为证明决策点确实存在。
  void manager.approve(event.decisionId);
});
runtime.events.on("sandbox:write", (event) => {
  if (event.ok) console.log("✎ 沙箱写入 " + event.toolName + " → " + event.paths.join(", "));
});

const session = await manager.createSession({ agentId: "assistant" });

// 第一轮：MockProvider 一定会调内置工具（calculator），用来确认工具链路通了。
await manager.chat(session.id, "3.5 + 2 * 4 等于多少");
// 第二轮：换成真实模型后，write_note 会先要一次授权（见上面的事件订阅）。
await manager.chat(session.id, "把 hello runtime 写进 notes/hello.txt");

const messages = await manager.messages(session.id);
const last = [...messages].reverse().find((message) => message.role === "assistant");
console.log("\\n助手：" + (last?.content ?? "(无回答)"));
console.log("会话：" + session.id + " · 落盘目录：" + workspace);
`;

function readme(name: string): string {
  return `# ${name}

由 [create-node-agent-runtime](https://www.npmjs.com/package/create-node-agent-runtime) 生成的最小受治理 Agent。

\`\`\`bash
npm install
npm start
\`\`\`

## 里面有什么

- \`src/main.ts\` —— 建会话 → 跑一轮 → 写文件触发审批 → 落盘到 \`./workspace\`
- \`policy\` 的 \`createProductionDefaults()\` —— 最小权限策略 + 锁定沙箱域（禁网、仅工作区内可写）
- \`FileStorage\`（\`.runtime-data/\`）—— 会话 / checkpoint / 审批审计落盘，重启可续跑

## 三条主线

治理 / 续跑 / 审计的更多示例见官方示例库：
<https://github.com/0end1/node-agent-runtime/tree/dev/examples/cookbook>

## 换成真实模型

\`\`\`bash
npm i @node-agent-runtime/provider-openai
export OPENAI_API_KEY=sk-...
\`\`\`

然后把 \`src/main.ts\` 里的 \`MockProvider\` 换成 \`OpenAIClientProvider\`。
`;
}

export function templateFiles(options: TemplateOptions): TemplateFile[] {
  const { name } = options;
  return [
    { path: "package.json", contents: packageJson(name) },
    { path: "tsconfig.json", contents: TSCONFIG },
    { path: ".gitignore", contents: GITIGNORE },
    { path: ".env.example", contents: ENV_EXAMPLE },
    { path: "README.md", contents: readme(name) },
    { path: "src/main.ts", contents: MAIN },
  ];
}
