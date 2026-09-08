# Agent Runtime

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

一个**零第三方运行时依赖**的 TypeScript/Node.js Agent 运行时：提供模型接入层、工具系统、事件总线与**多步推理（ReAct 式）事件循环**。同一套核心即可对接任意 OpenAI 兼容模型服务，也可使用内置的免密钥 Mock Provider 在离线环境完整演示「模型决策 → 工具调用 → 结果回填 → 继续推理 → 最终回答」闭环。

## 快速开始

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

## 核心概念

| 概念 | 说明 |
| --- | --- |
| `ModelProvider` | 模型后端抽象。自带 `OpenAIClientProvider`（fetch 实现）与 `MockProvider`（规则模型，免密钥）。实现该接口即可接入任意 LLM。 |
| `ToolDefinition` | 工具 = 名称 + 描述 + JSON Schema 参数 + `execute()`。参数在本地做类型校验，结果序列化回填给模型。 |
| `Agent` | 系统提示词 + 工具列表 + 步数/温度等运行参数。一个运行时可运行多个 Agent。 |
| `AgentRuntime` | 事件循环核心：`run()` 内循环调用模型，直到无工具调用或达到 `maxSteps`。 |
| `EventBus` | 每个生命周期节点（run / step / model / tool / 错误 / session / task）都会发事件，便于 CLI、Web、SDK 消费推理过程。 |
| `SessionManager` | （M1）Session → Task → Run 生命周期管理：创建/关闭/删除会话、自动调度任务、消息流自动落盘，调用方不再手管 `history`。 |
| `Storage` | （M1）统一持久化门面：core 内置 `MemoryStorage`（零依赖）与 `FileStorage`（按目录落盘）；`SQLiteStorage`（可选，`@agent-runtime/store-sqlite`，C9）等其它后端可注入替换。 |
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
  Agent, AgentRuntime, MockProvider,
  builtinTools, defineTool, type AnyTool,
} from "./src/index.js";

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
import {
  Agent, AgentRuntime, FileStorage,
  MockProvider, builtinTools,
} from "@agent-runtime/core";
import { SessionManager } from "@agent-runtime/host";

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
packages/
├── types/                   # C1 共享叶子包 @agent-runtime/types（零依赖：消息/工具/事件/Storage/Artifact 契约 + 校验器与纯函数）
├── memory/                  # C3 @agent-runtime/memory（SessionMemory 会话记忆，M6 外置）
├── artifact/                # @agent-runtime/artifact（产物管理 ArtifactManager，M6 自查后从 memory 拆出）
├── sandbox/                 # C4 @agent-runtime/sandbox（LocalSandbox 执行域，M6 外置）
├── policy/                  # C5 @agent-runtime/policy（PermissionManager 授权决策，M6 外置）
├── mcp/                     # C6 @agent-runtime/mcp（MCP 适配：client/transport/registry，M6 外置）
│   ├── src/
│   │   ├── types.ts         # 消息 / 工具调用 / RunUsage 等核心契约类型
│   │   ├── schema.ts        # JSON Schema 子集校验器（validate / JsonSchema）
│   │   └── util.ts          # 零 IO 纯函数（newId / stringifyResult 等）
│   └── test/                # node:test（schema 校验）
├── core/                    # C2 引擎实现包 @agent-runtime/core（仅依赖 C1）
│   ├── src/
│   │   ├── index.ts         # 公共 API（同时 re-export @agent-runtime/types 的全部导出）
│   │   ├── runtime.ts       # 多步推理事件循环（AgentRuntime）
│   │   ├── agent.ts         # Agent 定义
│   │   ├── context.ts       # Context 门面（M1：run 注入 session/task/run 上下文）
│   │   ├── session.ts       # SessionManager / Task / RunRecord（M1）
│   │   ├── events.ts        # 事件总线（含 session/task 事件，M1）
│   │   ├── tool.ts          # 工具抽象
│   │   ├── provider.ts      # ModelProvider 接口 + 错误类型
│   │   ├── tools/           # calculator（安全求值）· builtin（内置工具集）
│   │   ├── providers/       # mock（免密钥规则模型；openai-compatible 已外置，C7）
│   │   └── store/           # Storage 接口 + Memory/File 实现（M1）
│   └── test/                # node:test（runtime/session/store/calculator）
├── tools-basic/             # 内置基础工具集（calculator / builtinTools，演示友好，非引擎必需，M6 外置）
├── mock/                    # MockProvider 免密钥规则模型（演示/测试桩，M6 外置）
├── host/                    # C8 @agent-runtime/host（SessionManager 会话/任务生命周期，M6 外置）
├── provider-openai/         # C7 可插拔模型后端 @agent-runtime/provider-openai（OpenAI 兼容 fetch）
└── store-sqlite/            # C9 可选存储后端 @agent-runtime/store-sqlite（SQLiteStorage，node:sqlite）
examples/
├── cli.ts                   # 终端交互演示（会话持久化到 .runtime-data/，M1）
└── web/
    ├── server.ts            # SSE 服务器（会话持久化，跨重启恢复，M1）
    └── public/index.html    # 流式控制台前端
```

> 兼容：`@agent-runtime/core` re-export `@agent-runtime/types`，故从两包任意一处都可拿到消息类型 / `validate` / `newId` 等，公共导入面与拆包前一致。

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

`examples/` 已把这些能力暴露为操作面：`examples/cli.ts`（续跑 / 审批 / artifact / MCP 注册 + 演示写工具触发 M3）与 `examples/web/`（审批卡片、artifact 面板、续跑入口、会话切换，全部经 SSE 事件流）。

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

## 目录结构 & 设计取舍

- **零运行时依赖**：HTTP 全部走 Node 18+ 全局 fetch；解析器/校验器自研，无 eval。
- **Mock 免密钥演示**：`MockProvider` 用规则识别「数学 / 时间 / 天气 / 汇率」四类意图并按真实两段式流程（如 geocode → weather）推进，让离线也能看到完整多步推理。
- **前端友好**：运行时不接触 DOM/HTTP，所有过程以事件发布，Web 端通过 SSE 一行行还原。
- **健壮性**：工具参数本地校验失败会回填错误让模型自纠；未知工具 / 工具抛异常 / 模型调用中止均有明确事件与错误传播；`maxSteps` 上限防止死循环。

> 提示（M1）：CLI 与 Web demo 的会话记录持久化在 `.runtime-data/`（可经 `RUNTIME_DATA` 环境变量重定向）；Web 端浏览器固定会话 id 存于 localStorage，服务重启后同一浏览器刷新即可续聊。多端隔离可传不同 `session` 参数。
