# Node Agent Runtime

[![CI](https://github.com/0end1/node-agent-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/0end1/node-agent-runtime/actions/workflows/ci.yml)
[![Release](https://github.com/0end1/node-agent-runtime/actions/workflows/release.yml/badge.svg)](https://github.com/0end1/node-agent-runtime/actions/workflows/release.yml)
![coverage](https://img.shields.io/badge/coverage-92%25-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D22.13.0-brightgreen)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)
[![npm version](https://img.shields.io/npm/v/@node-agent-runtime/core?label=npm)](https://www.npmjs.com/package/@node-agent-runtime/core)
[![npm downloads](https://img.shields.io/npm/dm/@node-agent-runtime/core?label=downloads)](https://www.npmjs.com/package/@node-agent-runtime/core)

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

一个**零第三方运行时依赖**的 TypeScript/Node.js Agent 运行时：提供模型接入层、工具系统、事件总线与**多步推理（ReAct 式）事件循环**。同一套核心即可对接任意 OpenAI 兼容模型服务，也可使用内置的免密钥 Mock Provider 在离线环境完整演示「模型决策 → 工具调用 → 结果回填 → 继续推理 → 最终回答」闭环。

> **项目定位（2026-09-10 底座收敛）**：本项目的交付物是 `packages/*` 下的 **12 个 `@node-agent-runtime/*` 包**（每个都可单独 `npm i` 消费）；`examples/`（CLI · Web）与 `deploy/` 是**验证载体**——用于演示治理链路与回归验证，不承诺接口稳定；桌面壳 `examples/desktop-tauri/` 与 P5.1~P5.4 已**整体移出底座、方向归产品侧**（底座不再投入与判定）。边界、纪律与立项口径见 `docs/base-convergence.md` §2.3，产品侧承接见 `docs/product-direction.md` §4。

## 快速开始

底座本身是**库**（见下节「安装」）；仓库内的 CLI 与 Web 是**验证载体**，用于最快看到治理链路（审批 → 沙箱 diff → 续跑 → artifact）：

```bash
npm install
npm run demo:cli     # 交互式终端演示（默认 Mock，免 API Key）
npm run demo:web     # Web 控制台（SSE 实时流），然后打开 http://127.0.0.1:8787
```

接入真实大模型（OpenAI 兼容端点，如 OpenAI / DeepSeek / 通义千问 / Ollama）：

```bash
OPENAI_API_KEY=sk-xxx npm run demo:web                    # OpenAI
OPENAI_BASE_URL=https://api.deepseek.com/v1 OPENAI_API_KEY=sk-xxx OPENAI_MODEL=deepseek-chat npm run demo:web
```

## 安装（作为依赖消费）

12 个包以 `@node-agent-runtime/*` 发布（P4，ESM-only）：

```bash
npm i @node-agent-runtime/core @node-agent-runtime/types     # 引擎 + 契约（core 依赖 types）
npm i @node-agent-runtime/host                          # 可选：SessionManager 会话编排
npm i @node-agent-runtime/provider-openai @node-agent-runtime/mock  # 可选：真实模型 / 免密钥 Mock
npm i @node-agent-runtime/tools-basic @node-agent-runtime/store-sqlite  # 可选：内置工具、SQLite 存储
```

- **运行环境**：Node `>=22.13.0`（`node:sqlite` 需要），`"type": "module"`。
- **peer 边界**：`@node-agent-runtime/core` 与 `@node-agent-runtime/types` 是插件包的 `peerDependencies`，npm 7+ 会自动安装；显式安装可锁定版本。
- **类型**：产物自带 `.d.ts`，无需安装 `@types/node` 也能 typecheck。
- **升级**：所有包统一版本号（changesets `fixed`），升级时保持版本一致：
  ```bash
  npm i @node-agent-runtime/core@latest @node-agent-runtime/host@latest   # 逐包对齐同一版本
  ```

## 核心概念

| 概念 | 说明 |
| --- | --- |
| `ModelProvider` | 模型后端抽象。官方实现：`@node-agent-runtime/provider-openai` 的 `OpenAIClientProvider`（fetch）与 `@node-agent-runtime/mock` 的 `MockProvider`（免密钥规则模型）。实现该接口即可接入任意 LLM。 |
| `ToolDefinition` | 工具 = 名称 + 描述 + JSON Schema 参数 + `execute()`。参数在本地做类型校验，结果序列化回填给模型。 |
| `Agent` | 系统提示词 + 工具列表 + 步数/温度等运行参数。一个运行时可运行多个 Agent。 |
| `AgentRuntime` | 事件循环核心：`run()` 内循环调用模型，直到无工具调用或达到 `maxSteps`。 |
| `EventBus` | 每个生命周期节点（run / step / model / tool / 错误 / session / task）都会发事件，便于 CLI、Web、SDK 消费推理过程。 |
| `SessionManager` | （M1，`@node-agent-runtime/host`）Session → Task → Run 生命周期管理：创建/关闭/删除会话、自动调度任务、消息流自动落盘，调用方不再手管 `history`。 |
| `Storage` | （M1）统一持久化门面：core 内置 `MemoryStorage`（零依赖）与 `FileStorage`（按目录落盘）；`SQLiteStorage`（可选，`@node-agent-runtime/store-sqlite`，C9）等其它后端可注入替换。 |
| `Memory` | （M2）记忆门面 `SessionMemory`：会话层=对话流（跨进程重启可读），事实层=`remember`/`recall` 长期事实 KV。 |
| `Checkpoint` | （M2）步级快照：每完成一步写入 messages + usage + 工具指纹（`toolsHash`），引擎只发快照、宿主负责落盘。 |
| `SessionManager.resume()` | （M2）从 checkpoint 校验工具指纹后续跑同一 task：`resume(ckptId, continuation?)`，输出与一次性跑完等价。 |
| `Permission` | （M3）授权决策 allow/deny/ask：`DefaultPermissionPolicy` 决策矩阵 + `PermissionManager.gate/approve/deny` 审批流，超时即拒，`approve({always})` 沉淀白名单。 |
| `Sandbox` | （M3）运行层执行域：`SandboxMode` 三档（read-only / workspace-write / full-access）+ 声明域 + 网络开关 + 每调用超时；`sandbox:write` 事件让"写操作可见"。 |
| `MCP` | （M4）远端 MCP Server → 本地工具适配：`McpClient`（stdio 子进程 / streamable HTTP 传输，JSON-RPC 2.0）+ `McpRegistry` 把工具物化为 `mcp__server__tool` 本地定义，之后与内置工具同路径过校验/审批/沙箱。 |
| `Artifact` | （M4）产物管理 `ArtifactManager`：`text`/`file`/`chart` 内容存 Blob、`url` 走直链 locator；按 session/run 列表、读字节/文本、删除随会话级联清理。 |

运行时主循环：

```
while steps < maxSteps:
    response = provider.chat({ history + agent.instructions + tools })
    if response.toolCalls:
        for each call:
            validate(arguments)          # 本地 JSON Schema 校验
            result = tool.execute(...)   # 执行
            history.push(tool result)    # 回填给模型继续推理
        continue
    else:
        break                            # 模型给出最终回答
```

## 代码示例

```ts
import {
  Agent, AgentRuntime, defineTool, type AnyTool,
} from "@node-agent-runtime/core";                  // 引擎 + types/memory 等聚合出口
import { MockProvider } from "@node-agent-runtime/mock";        // 免密钥规则模型（演示/测试）
import { builtinTools } from "@node-agent-runtime/tools-basic"; // 内置工具集（可选）
// 真实模型：import { OpenAIClientProvider } from "@node-agent-runtime/provider-openai";

// 1. 模型（免密钥）或 new OpenAIClientProvider({ model: "gpt-4o-mini" })
const runtime = new AgentRuntime({ provider: new MockProvider() });

// 2. 自定义工具
const temperatureTool = defineTool({
  name: "celsius_to_fahrenheit",
  description: "摄氏温度转华氏温度",
  parameters: { type: "object", properties: { c: { type: "number" } }, required: ["c"] },
  execute(args) { return { f: Math.round((args.c * 9) / 5 + 32) }; },
});

// 3. Agent 装配（内置 calculator/now/geocode/weather/exchange 可直接用）
const agent = new Agent({
  name: "assistant",
  tools: [...builtinTools, temperatureTool] as AnyTool[],
  maxSteps: 6,
});

// 4. 订阅事件流（UI/CLI 都从这里拿过程）
runtime.subscribe((e) => console.log(e.type, e));

// 5. 多轮会话：把上一轮 result.messages 作为 history 传入即可
const result = await runtime.run({ agent, input: "把 18°C 转成华氏温度，然后算出它乘以 2 的结果" });
console.log(result.output);   // 最终自然语言答案
```

### 会话管理（M1：`SessionManager`）

```ts
import { Agent, AgentRuntime, FileStorage } from "@node-agent-runtime/core";
import { MockProvider } from "@node-agent-runtime/mock";
import { builtinTools } from "@node-agent-runtime/tools-basic";
import { SessionManager } from "@node-agent-runtime/host";

const manager = new SessionManager({
  runtime: new AgentRuntime({ provider: new MockProvider() }),
  storage: new FileStorage(".runtime-data"),   // 或 new MemoryStorage()
  agents: [new Agent({ name: "assistant", tools: builtinTools })],
});

const s = await manager.createSession({ agentId: "assistant" });
await manager.chat(s.id, "2 + 2 = ?");
// 进程重启后，用同一 storage 重建 manager 即可带完整上下文继续对话：
const out2 = await manager.chat(s.id, "那 4 + 5 呢？");
```

## 项目结构

npm workspaces monorepo（根包为容器，`packages/*` 为独立包）：

```
packages/                   # 12 个 npm workspace 包（P4 起均可发布）；目录名即 scoped 包名，如 core → @node-agent-runtime/core
├── types/                  # C1 共享叶子包 @node-agent-runtime/types（零依赖）：消息/工具/事件/Storage/Artifact 契约 + schema 校验器 + 零 IO 纯函数
│                           #   src/: artifacts · events · schema · storage · tools · types · util
├── memory/                 # C3 @node-agent-runtime/memory（依赖 types）：SessionMemory 会话记忆 + Checkpoint 步级快照（M6 外置；checkpoint M6-10 归位）
├── artifact/               #    @node-agent-runtime/artifact（依赖 types）：ArtifactManager 产物管理（M6-9 自查后自 memory 拆为独立包）
├── sandbox/                # C4 @node-agent-runtime/sandbox（依赖 types）：LocalSandbox 三档执行域（M6 外置）
├── policy/                 # C5 @node-agent-runtime/policy（依赖 types）：PermissionManager/DefaultPermissionPolicy 授权决策（M6 外置）
├── core/                   # C2 引擎 @node-agent-runtime/core（1005 行，依赖 C1 + 上述 facade 包）：run loop/agent/context/事件总线/tool 与 provider 契约
│   └── src/                #   agent · context · events · index · provider · runtime · tool
│                           #   store/（MemoryStorage · FileStorage，零依赖实现）
├── tools-basic/            # 内置工具集 @node-agent-runtime/tools-basic（builtinTools：calculator 等 5 个，M6 外置，非引擎必需）
├── mock/                   # MockProvider 免密钥规则模型 @node-agent-runtime/mock（演示/测试桩，M6 外置）
├── host/                   # C8 @node-agent-runtime/host（SessionManager 会话/任务生命周期，M6 外置，host 层）
├── mcp/                    # C6 @node-agent-runtime/mcp（MCP 适配：client/jsonrpc/registry/transport/types，M6 外置）
├── provider-openai/        # C7 @node-agent-runtime/provider-openai（OpenAI 兼容 fetch 模型后端）
└── store-sqlite/           # C9 @node-agent-runtime/store-sqlite（SQLiteStorage 可选存储后端，node:sqlite）
examples/                   # 验证载体（不随 npm 发布，接口不承诺稳定）
├── cli.ts                  # 最小消费者：终端交互（会话持久化到 .runtime-data/，M1）
├── web/                    # 可视化验收面：SSE 事件流 + 审批卡片 + sandbox diff + artifact
│   ├── server.ts           #   SSE 服务器（含鉴权/CORS/CSRF，跨重启恢复会话）
│   └── public/index.html   #   控制台前端
└── desktop-tauri/          # 【移出至产品侧 HANDOFF · 2026-09-10】桌面壳（P5.1~P5.4 随其移出底座，方向归产品侧）

deploy/                     # 验证载体：容器化交付样例（Dockerfile · compose · systemd · nginx · env 分层）
```

> 兼容：`@node-agent-runtime/core` 聚合 re-export `types` / `memory` / `artifact` / `sandbox` / `policy`，从 core 单点可拿到与拆包前一致的公共导入面；推荐新代码按需直连子包。公共导出面以 `docs/api-surface.md` 冻结快照 + `npm run check:api` 为唯一事实源。

## 运行中的事件

| 事件 | 载荷要点 | 含义 |
| --- | --- | --- |
| `run:start` | agentName, input | 一次 run 开始 |
| `message:user` | message | 用户消息已入队 |
| `step:start` | step | 新一轮模型往返开始 |
| `model:response` | message{content, toolCalls} | 模型的决策（文字/工具调用） |
| `tool:start` | toolCall | 开始执行工具 |
| `tool:end` | result, ok, durationMs | 工具执行结果 |
| `run:end` | output, usage, steps | run 完成（output 为最终回答） |
| `run:error` | error | 发生错误（含 Abort） |
| `session:created/updated/closed` | sessionId 等 | 会话生命周期（M1，`SessionManager` 发出） |
| `task:created` / `task:status` | taskId, sessionId, status | 任务创建与状态迁移（M1） |
| `permission:request` | decisionId, toolName, reason, arguments | 工具需宿主确认（M3：写/凭据/exec 类在默认策略下 ask） |
| `permission:approved` / `permission:denied` | decisionId, toolName, always? | 宿主批准/拒绝（含 `always` 沉淀白名单） |
| `sandbox:write` | toolName, paths, diff | 写类工具执行后的变更（含尽力行级 diff，M3） |
| `checkpoint:saved` / `checkpoint:restored` | checkpointId, taskId, step | 步级快照写入/续跑加载（M2） |

## 能力参考（M1~M4）

每个能力都是 `SessionManager` 之上的独立子系统，可单独接入宿主应用：

- **M1 生命周期**：`SessionManager.create/list/get/close/delete` + `chat()`；消息流与 checkpoint 自动落盘（`Storage`），重启后同一 storage 恢复上下文。详见 `docs/architecture.md` §8.2 / §9。
- **M2 记忆与续跑**：`SessionMemory`（会话流 + 事实层 `remember`/`recall`）、`Checkpoint` 步级快照、`SessionManager.resume(ckptId, continuation?)` 续跑同一 task。详见 §8.2 / §9。
- **M3 治理**：`DefaultPermissionPolicy`（`ToolKind × SandboxMode` 决策矩阵）+ `PermissionManager.gate/approve/deny`（`approve({ always })` 沉淀白名单、超时即拒）；`Sandbox`（`LocalSandbox`：三档模式 + 声明域 + 网络开关 + 每调用超时 + `sandbox:write` 写可见）。宿主订阅 `permission:request` 弹审批、监听 `sandbox:write` 看变更。详见 §6.1 / §6.2。
- **M4 外部能力**：`McpClient`（stdio / streamable HTTP）+ `McpRegistry`（远端工具物化为 `mcp__server__tool`，与本地工具同路径过校验/审批/沙箱）；`ArtifactManager`（按 session/run 存文本/文件/图表/url，随会话级联清理）。详见 §5.3 / §8.1。

`examples/`（**验证载体**，非产品线）把这些能力暴露为操作面：`examples/cli.ts`（最小消费者：续跑 / 审批 / artifact / MCP 注册 + 演示写工具触发 M3）与 `examples/web/`（可视化验收面：审批卡片、artifact 面板、续跑入口、会话切换，全部经 SSE 事件流）。

## 内置工具

- `calculator` — 安全数学表达式计算（支持 `+ - * / % ^`、括号、小数；Pratt 解析器，绝无 eval）
- `now` — 当前本地时间/日期
- `geocode` — 演示城市经纬度解析
- `weather` — 演示城市天气（确定性伪数据，可复现）
- `exchange` — 参考汇率换算

## 验证

```bash
npm run typecheck   # tsc --noEmit（packages + examples，经 paths 别名走源码）
npm run build       # 逐包产出 dist/（npm test 会自动先执行它）
npm test            # node:test（types + memory + artifact + sandbox + policy + core + tools-basic + mock + host + mcp + provider-openai + store-sqlite 逐包，覆盖事件循环/工具安全/Storage/Session/治理/产物/MCP/schema）
```

## 生产用法（配置 · 观测 · 安全）

### 配置：`loadConfig`

密钥与运行参数统一由 `loadConfig()` 解析（分层：overrides > env > 默认），业务代码里不要散落 `process.env` 读取：

```ts
import { loadConfig } from "@node-agent-runtime/core";

const cfg = loadConfig();                 // 或 loadConfig({ env, overrides })
// cfg.provider.kind / cfg.sandbox.network / cfg.limits / cfg.mcp / cfg.features
// 非法配置抛 ConfigError（code: config_invalid），不静默降级
```

| 环境变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | 模型端点；空串按配置错误处理，不静默回退 mock |
| `AGENT_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `AGENT_SANDBOX_NETWORK`（`deny`｜`allowlist`）+ `AGENT_SANDBOX_NETWORK_ALLOWLIST` | 沙箱网络开关与白名单 |
| `AGENT_LIMIT_MAX_STEPS` / `MAX_DURATION_MS` / `MAX_COST_USD` / `MAX_*_TOKENS` | 运行预算，超限产 `run:error`（P3.4） |
| `AGENT_RATE_TOOL_MAX_CALLS` + `AGENT_RATE_TOOL_WINDOW_MS` | 工具调用速率（滑动窗口） |
| `AGENT_MCP_HTTP_ALLOWLIST` / `AGENT_MCP_STDIO_TIMEOUT_MS` / `AGENT_MCP_ENV_<NAME>` | MCP 供应链防护（防 SSRF、启动超时、凭据注入，P3.6） |
| `AGENT_FEATURE_MCP` / `AGENT_FEATURE_SQLITE` / `AGENT_FEATURE_ARTIFACTS` | 特性开关 |
| `AGENT_API_TOKEN` / `AGENT_CORS_ALLOW_ORIGINS` | Web 控制台鉴权与跨站白名单（P3.5） |

### 观测：结构化日志 + 错误码 + 事件

```ts
import { AgentRuntime, ConsoleLogger } from "@node-agent-runtime/core";

const runtime = new AgentRuntime({
  provider,
  logger: new ConsoleLogger({ level: "info" }),   // 或注入自定义 Logger
});
runtime.subscribe((e) => { /* run:start / tool:end / run:error … */ });
```

- 日志与事件载荷统一经 `redact()` 脱敏，密钥永不进日志与事件流（P3.2）。
- 错误带稳定 `code`（`run_aborted`、`sandbox_violation`、`limit_exceeded`、`config_invalid`…），HTTP/CLI 用 `errorPayload(err)` 输出 `{ error: { code, message } }`（P3.1）。
- 预算越界抛 `LimitExceededError` 并发 `run:error`（`code: limit_exceeded`），不会静默收敛（P3.4）。

### 安全默认

```ts
import { createProductionDefaults } from "@node-agent-runtime/policy";

const { policy, sandboxMode, scope } = createProductionDefaults(process.cwd());
// 最小权限矩阵（写/exec 走 ask、credential 全域 deny）+ 锁域（禁网、仅工作区内可写）
```

- **Web 控制台**：非 loopback 监听且未设 `AGENT_API_TOKEN` 直接拒绝启动；跨站请求按白名单拦截（P3.5）。
- **MCP**：端点须在 `AGENT_MCP_HTTP_ALLOWLIST` 内并逐跳校验重定向（防 SSRF）；子进程默认不继承宿主 env（P3.6）。
- **审批留痕**：审批记录只存参数指纹，不复制原文；`always` 白名单可持久化（P3.3）。

### 发布与升级（维护者）

版本由 changesets 管理，所有包统一版本号：

```bash
npm run changeset           # 记录一次用户可见改动
npm run version-packages    # bump 版本 + 生成 CHANGELOG
npm run release             # 构建并发布（CI 由 release.yml 执行；tag v* 触发 provenance 发布）
```

## 目录结构 & 设计取舍

- **零运行时依赖**：HTTP 全部走 Node 18+ 全局 fetch；解析器/校验器自研，无 eval。
- **Mock 免密钥演示**：`MockProvider` 用规则识别「数学 / 时间 / 天气 / 汇率」四类意图并按真实两段式流程（如 geocode → weather）推进，让离线也能看到完整多步推理。
- **前端友好**：运行时不接触 DOM/HTTP，所有过程以事件发布，Web 端通过 SSE 一行行还原。
- **健壮性**：工具参数本地校验失败会回填错误让模型自纠；未知工具 / 工具抛异常 / 模型调用中止均有明确事件与错误传播；`maxSteps` 上限防止死循环。

> 提示（M1）：CLI 与 Web demo 的会话记录持久化在 `.runtime-data/`（可经 `RUNTIME_DATA` 环境变量重定向）；Web 端浏览器固定会话 id 存于 localStorage，服务重启后同一浏览器刷新即可续聊。多端隔离可传不同 `session` 参数。

## 参与贡献

- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md) —— 分支与提交约定、质量门口径、changeset 与 API 面冻结流程。
- 安全漏洞：[SECURITY.md](SECURITY.md) —— 请走 GitHub Security Advisories 或邮件等私密渠道，勿开公开 issue。
- 许可证：[Apache-2.0](LICENSE)
