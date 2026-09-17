# Agent Runtime 架构设计（v1 草案）

> 本文档把「单机 Agent 实验原型」演进为可承载**桌面产品（Desktop / Product Host）**（历史表述；项目投入口径已于 2026-09-10 收敛为「底座优先」，见下方注记）的完整 Agent 运行时：既保留零依赖、事件驱动、可测试的内核哲学，又按目标架构补齐 Session、Task、Context、Memory、Permission、Sandbox、Checkpoint、MCP、Artifact、Persistence 等模块。
>
> 状态：草稿 · 文档作者：wangzhiyong（GitHub：[0end1](https://github.com/0end1)）· 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com) · 关联代码版本：`v0.2.0`（M0 基线 + M1 · Session/Task/Run + Storage + Context，2026-09-04）
>
> **项目口径（2026-09-10，底座收敛）**：本文档 §1 描述的是**运行时分层**（Desktop → Product Host → Runtime core），用于说明依赖方向与边界，仍然成立；但项目的**投入分层**已收敛为「**底座（`packages/*` 12 包）→ 验证载体（`examples/cli.ts` · `examples/web/` · `deploy/`）**」，且**桌面端（`examples/desktop-tauri/` · `.github/workflows/desktop.yml` · P5.1~P5.4）已整体移出至产品侧**——Desktop 既不是底座也不是验证载体，底座侧不再投入、也不再判定其立项与否。判定规则、口径与验收见 `docs/base-convergence.md` §2.3；产品侧承接见 `docs/product-direction.md` §4。两者是不同维度的口径，不得互相引用。

---

## 1. 架构总览（对应图 1：整体分层）

```
┌─────────────────────────────────────────────────────────────┐
│  Desktop 壳层                                                │
│  Electron / Tauri：窗口、渲染进程、系统集成、应用生命周期      │
│  通过 IPC / localhost 桥接，展示事件流，不可直接触碰核心       │
└──────────────────────────────┬──────────────────────────────┘
                               │  Product Host API（进程内 or 子进程）
┌──────────────────────────────▼──────────────────────────────┐
│  Product Host（宿主层：策略与编排，属于"产品"而非"引擎"）      │
│  · 多 Agent 路由 / 子任务拆分与汇总                            │
│  · 用户意图 → Task 创建；对话线程（Session）管理               │
│  · 权限策略、审核日志、资源配额的唯一入口                     │
│  · 会话语义化：标题、摘要、分类                               │
└───────┬───────────────────────────────┬─────────────────────┘
        │                              │
┌───────▼─────────┐        ┌───────────▼──────────┐
│  Runtime 核心    │        │  Storage             │
│  （本设计主体）   │        │  Session / Run /     │
│  事件循环引擎     │        │  Checkpoint /        │
│  见第 3、4 节     │        │  Artifact / Memory   │
└───────┬─────────┘        └───────────────────────┘
        │
┌───────▼──────────────────────────────────────────┐
│ 能力接入层                                        │
│  Model API（OpenAI 兼容） · Tool · MCP Server      │
│  外部世界：HTTP / 文件 / shell（受 Sandbox 约束）   │
└───────────────────────────────────────────────────┘
```

| 层 | 职责 | 约束 / 边界 |
| --- | --- | --- |
| **Desktop** | 原生壳（Electron/Tauri），负责窗口、系统菜单、快捷键、托盘、启动驻留 | 只通过 Product Host API 通信；不 import `core/`；UI 订阅事件流 |
| **Product Host** | 产品策略与编排：Task/Session 语义、权限决策、路由、额度、审计 | 可依赖 `core/`；是核心的唯一"客户"；同一 host 可服务多桌面窗口 |
| **Runtime core** | 引擎：模型往返、工具执行、事件、状态记录 | 零外部依赖、纯函数友好、可在 Node/Worker/测试中运行 |
| **Storage** | 状态持久化抽象 | 由接口 + 多实现组成（内存 / 文件 / 可选 SQLite） |
| **接入层** | Model API、Tool、MCP 的适配边界 | 每个 adapter 只做协议翻译 |

**关键决策**
1. `core`（引擎）与 `host`（产品策略）分层隔离——引擎不感知"审批弹窗""会话标题"这类产品概念，只暴露可编排的原语与事件。
2. Storage 作为 `core` 依赖注入的接口存在；`core` 自带内存实现，文件/SQLite 由宿主管道化。
3. 事件流是唯一的进程内观察通道（延续现状 `EventBus` 设计），也是跨进程/跨设备（SSE）的传输单元。

---

## 2. Runtime 模块地图（对应图 2：模块树）

目标模块树按四个职责域分组：

```
                    ┌──────────────────────────┐
                    │   Session  Agent         │  ← 编排：会话与配方
                    │   Task    Run   Step     │  ← 编排：执行生命周期
                    └──────────────────────────┘
                    ┌──────────────┬───────────┐
                    │  Context     │  Memory   │
                    │  Model Tool  │  Artifact │
                    │  MCP         │           │
                    └──────┬───────┴─────┬─────┘
                           │             │
                 ┌─────────▼─────┐ ┌─────▼────────────┐
                 │ Permission    │ │ Event            │
                 │ Sandbox       │ │ Checkpoint       │
                 │               │ │ Persistence      │
                 └───────────────┘ └──────────────────┘
```

| 组 | 模块 | 一句话职责 | 现状 |
| --- | --- | --- | --- |
| 编排 | `Session` | 一次用户可见的对话线程：消息流、内存、所属 Agent | ✅ M1：`SessionManager` 已实现（create/list/close/delete，可外部指定 id，消息流持久化） |
| 编排 | `Agent` | 静态配方：指令 + 工具集 + 模型采样参数（已是现状） | 已有，微调 |
| 编排 | `Task` | 会话内一个目标导向的请求，可跨多次 Run（中断/续推） | ✅ M1：Task 状态机（created→running→done/failed/cancelled）+ runIds/result 已落地 |
| 编排 | `Run` | 引擎一次独立执行（现有 `run()`），自动落 Checkpoint | ✅ M1：提升为持久实体 `RunRecord`（Run doc 落 storage） |
| 编排 | `Step` | Run 内一次模型往返 + 其工具调用组 | 已有（循环体） |
| 依赖 | `Context` | Run/Step 内可见的运行上下文与能力门面 | ✅ M1：`context.ts` 门面已建（`buildRunContext`），runtime 注入 session/task/run |
| 依赖 | `Model` | 模型后端抽象（`ModelProvider`） | 已有 |
| 依赖 | `Tool` | 具名、带 Schema 的可调用能力 | 已有 |
| 依赖 | `MCP` | 远端 MCP Server → 本地 Tool 的适配器 | ✅ M4：`mcp/`（`McpClient` + `StdioTransport`/`StreamableHttpTransport` + `McpRegistry` 物化本地 ToolDefinition）已落地 |
| 治理 | `Permission` | 工具/资源访问的授权决策（allow/deny/ask） | ✅ M3：`permission.ts` 的 `DefaultPermissionPolicy`（决策矩阵）+ `PermissionManager.gate/approve/deny`（审批流 + 超时）已落地 |
| 治理 | `Sandbox` | 运行层执行域边界：`SandboxMode` 三档 + `SandboxScope` 声明域 + 资源限制 | ✅ M3：`sandbox.ts` 的 `LocalSandbox`（read-only 拦副作用 / 禁网开关 / 路径越界拒绝 / 每调用超时 / `sandbox:write` 含 diff）已落地 |
| 状态 | `Event` | 生命周期事件总线 | 已有（M1 追加 session/task 事件） |
| 状态 | `Memory` | 会话记忆（消息流）+ 长期事实记忆 | ✅ M2：`memory.ts` 的 `SessionMemory`（消息流 + 每会话 KV 事实层 `remember/recall`）已落地 |
| 状态 | `Artifact` | 可展示/可引用的产物（文本、文件、图表） | ✅ M4：`artifact.ts` 的 `ArtifactManager`（元数据入 KV `artifact` 域、payload 入 Blob / url locator）已落地 |
| 状态 | `Checkpoint` | Run/Step 级可恢复快照 | ✅ M2：`checkpoint.ts`（步级快照 + `toolsHash` 校验）与 `SessionManager.resume()` 已落地 |
| 状态 | `Persistence` | 上述全部实体的存取接口与实现 | ✅ M1：`Storage` 接口 + `MemoryStorage`/`FileStorage` 已落地 |

---

## 3. 生命周期语义（Session → Agent → Task → Run → Step）

四层实体使用**严格包含关系**，与既有心智一致：

```
Session (1) ── contains many ─▶ Task (n)
  · 唯一持久的对话上下文      · goal: 用户一次请求 / 一段自动任务
  · 固定的 agent + memory     · 状态机：created → running → done/failed/cancelled
                                    · 可多次调度 Run（追问 / 续推 / 恢复）
Agent (recipe)                Run (1) ── contains many ─▶ Step (n)
  · 静态，可被多个 Session 复用 · 引擎一次 run() 的执行记录     · 1 次模型往返
  · 编译时校验（工具名查重等）  · 从 Task 继承 messages 起点   · 往返含 0..k 工具调用
```

关键状态机：

```
Session: idle ─▶ busy ─▶ idle        （busy 期间锁定写入；可同时多个 Task 排队的场景由 host 仲裁）
Task   : created ─▶ running ─┬─▶ done
                             ├─▶ failed
                             └─▶ cancelled          （cancelled 可 ——▶ resumed）
Run    : queued ─▶ running ─┬─▶ succeeded ─▶（task 未完 → 再次 run）
                            ├─▶ stopped(maxSteps)
                            ├─▶ aborted(信号)
                            └─▶ failed
Step   : 仅在 Run 内存在，无独立生命周期；结束后写入 checkpoint
```

### 3.1 接口草案

```ts
// ── 编排 ──────────────────────────────────────────────

interface Session {
  readonly id: string;
  agentId: string;                 // 引用 Agent 配方（未来可用快照版本号）
  title: string;                   // host 可自动生成
  status: "idle" | "busy" | "closed";
  meta: Record<string, unknown>;   // 宿主自定义（标签、目录、图标…）
  createdAt: number; updatedAt: number;
}

interface Task {
  readonly id: string;
  sessionId: string;
  goal: string;                    // 本次请求的输入
  status: "created" | "running" | "done" | "failed" | "cancelled";
  runIds: string[];                // 该 task 历次 run
  result?: string;                 // done 时的最终答复
  createdAt: number; updatedAt: number;
}

// Run 提升为持久实体（现状 RunResult 是纯内存返回）
interface Run extends RunResult {          // 复用现有字段 runId/steps/messages/usage…
  readonly id: string;                     // = runId
  taskId: string;
  status: "running" | "succeeded" | "stopped" | "aborted" | "failed";
  parentCheckpointId?: string;             // resume 时的来源
  startedAt: number; finishedAt?: number;
}

interface SessionManager {
  create(opts: { agentId: string; title?: string }): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
  list(): Promise<Session[]>;
  close(id: string): Promise<void>;
}
```

> 现状对应：`runtime.run()` 内的 `runId/newId`、`conversationId`、`history` 参数即为 Run/Session 的最简形态；目标是把隐式概念显式化并落盘。

### 3.2 Agent 演进

`Agent` 保持静态配方不变（v0.1 已正确建模），仅补充：
- `agentId` 显式版本/快照：Session 引用创建时刻的配方快照，避免配方改动破坏历史会话。
- 工具来源扩展：本地 `ToolDefinition[]` 或 `McpToolRef[]`（见 §5）延迟解析。
- 新增编译期校验函数：`compileAgent()` → 校验重名、MCP 可达性、Schema 合法性，产物可缓存。
  - **实现注记（M7-5，2026-09-15）**：已落地于 `packages/core/src/compile.ts` —— `compileAgent(input, { resolveMcp })` 返回 `CompiledAgent`（`tools` / `toolsHash` / `instructionsHash` / `warnings`），错误一次性汇总为 `AgentCompileError.issues`；`Agent` 增可选 `mcpTools?` 以承载 `McpToolRef[]` 延迟解析（§5 的 `McpRegistry.resolve()` 以注入方式接入，core 不依赖 `mcp` 包）。配方快照侧：`memory` 的 `AgentSnapshot` 增可选 `instructionsHash?`，与既有 `toolsHash` 构成「硬 / 软」两级续跑护栏。执行清单与决策见 `docs/historical/m7-base-governance.md` §9 与 §8-9~12。

---

## 4. 数据流

### 4.1 现状：无状态 Run（已实现）

```
调用方 ── runtime.run({ agent, input, history })
   └─ 循环 { provider.chat → 解析 → 校验 → executeTool → 回填 } → RunResult
   └─ 全部生命周期发布 EventBus；调用方自行持久化 history
```

### 4.2 目标：宿主驱动的 Task 流水线

```
┌ host/user ────── Session.create() ────────────────────────────────┐
│                                                                   │
│  user msg ─▶ session.createTask(goal) ─▶ task = running           │
│                                                                   │
│      task.scheduleRun()                                          │
│        ─▶ runtime.run({ taskCtx })                                │
│            每 Step 结束 ──▶ store.checkpoint.save(run,step)       │
│            每 Step 结束 ──▶ memory.append(messages)               │
│            工具执行前 ──▶ permission.decide() ──▶ 允许则执行        │
│            ask 决策 ──▶ emit(permission:request) ── 宿主批准/拒绝   │
│            执行环境 ──▶ sandbox.wrap(tool)                       │
│        run 结束 ──▶ task.result 写入；task = done                  │
│                                                                   │
│  中断恢复：host 重启 ─▶ store 载入 session/task ─▶ resume last      │
│            checkpoint ─▶ runtime.run(resumeCheckpointId)          │
└───────────────────────────────────────────────────────────────────┘
```

### 4.3 Run 循环（引擎内部，v1 保留现状主循环并外挂扩展点）

```
sandbox = sandbox.begin(run.mode, run.scope)          [S]   ← 运行层执行域（每次 run）
for step in 1..maxSteps:
  decision = model.chat(messages + tools)            [M]
  if no toolCalls: break                             [回答完成]
  for each toolCall:
    permission = policy.decide(toolCall, sandbox)    [P]   ← 新增
      ask → emit + await 宿主审批（可超时/拒绝）
    execute = sandbox.wrap(tool)                     [S]   ← 越界先 deny
    result = execute(args, ctx)                      [ctx 含 Context 门面]
    memory.append(tool result)                       [E]
    events.emit(tool:end)
  checkpoint.save(step)                              [E]   ← 新增
```

---

## 5. 能力接入：Tool、Model、MCP

### 5.1 Tool（保持现状接口，v0.1 已稳定）

```ts
interface ToolDefinition<Args, Result> {
  name: string; description: string;
  parameters?: JsonSchema;                 // 本地校验 + 模型提示双用
  execute(args: Args, ctx: ToolExecutionContext): Result | Promise<Result>;
}
```

### 5.2 Model（保持现状接口）

```ts
interface ModelProvider {
  readonly id: string; readonly label: string;
  chat(req: ModelRequest): Promise<ModelResponse>;
}
```

### 5.3 MCP（新增适配层，接缝在 Tool）

设计原则：**MCP Server 的唯一产物是「动态 Tool 集合」**，注册后引擎路径完全复用本地工具路径。

```ts
interface McpServerHandle {
  readonly name: string;                       // 唯一，作为工具名前缀作用域
  connect(): Promise<void>;                    // stdio / Streamable HTTP / SSE
  listTools(): Promise<McpToolMeta[]>;         // { name, description, inputSchema }
  callTool(name: string, args: unknown): Promise<McpToolResult>;
  close(): Promise<void>;
}

// 注册器：把远端工具物化为本地 ToolDefinition（带前缀防碰撞）
interface McpRegistry {
  register(server: McpServerHandle): Promise<void>;   // 拉取 → 缓存
  unregister(name: string): Promise<void>;
  resolve(ref: McpToolRef): ToolDefinition | undefined; // Agent 配方延迟解析
  list(): McpServerHandle[];
}
```

协议翻译注意点：
- 参数：MCP `inputSchema`（JSON Schema）可直接复用现有 `validate()`。
- 命名空间：远程工具以 `serverName::toolName`（或前缀 `mcp__server__tool`）注册，避免与本地工具冲突；错误回填格式与本地工具一致，模型可自纠。
- 产物：MCP 的文本/二进制资源映射为 `Artifact`（§8）。

> 实现注记（M4，2026-09-07）：`McpClient` 与 `McpRegistry` 已落地于 C2 `packages/core/src/mcp/`——`jsonrpc.ts`（JSON-RPC 2.0 消息 + `McpError`/`McpTimeoutError`/`McpConnectionError`）、`transport.ts`（`StdioTransport` spawn 子进程行式协议；`StreamableHttpTransport` fetch POST，兼容 `text/event-stream` 与纯 JSON 两种响应）、`client.ts`（握手 `initialize` + `notifications/initialized`、`tools/list` 分页、`tools/call`）、`registry.ts`（物化 `mcp__server__tool` 前缀本地 `ToolDefinition`，`normalizeSchema` 归一化远端 schema 到引擎 JsonSchema 子集、敏感类由远端工具名推断、`isError` 时 execute 抛错让模型自纠）。「注册即枚举」的时序意味着：只要先 `await registry.register(handle)` 再把 `registry.tools()` 合入 Agent 配方，远端工具与本地工具后续 100% 同路径。C6 `@node-agent-runtime/mcp` 拆包随 M5。（**2026-09-08 追注**：已于 M6-2 拆为独立包 `@node-agent-runtime/mcp`，不再位于 `packages/core/src/mcp/`；core 不反向 re-export，请从子包导入。见 §10 现状注记与 §13 v1.8/v1.9）

> **M7-6b 追注（2026-09-15）：只读资源**。MCP 的 `resources/list` / `resources/read` 已落地：`McpClient` 依 `initialize` 协商的 `capabilities` 暴露 `resourcesSupported`（未声明能力 ⇒ `listResources()` 返回 `[]`，无资源 ≠ 故障），`McpRegistry` 在 `register()` 时列取资源并物化为只读工具 `mcp__<server>__resource__<slug>_<fnv1a8>`（URI 在闭包内固定，模型无法在调用期改写），并新增 `listResources()` / `readResource(uri, server?)` / `searchTools(query)`。两个护栏值得记住：**资源只认「已声明 URI」**（`resources/list` 的输出即该 server 的声明域，越权读取在 registry 层被拒且不转发 —— URI 由远端给出，提示注入可能指向 `file:///etc/shadow`），**敏感度一律取保守值 `network-read`**（URI 长得像本地文件不代表读取发生在本地），因此资源读取与远程工具同走 §6 的 gate 矩阵与沙箱禁网判定，无旁路。物化数量按 server 上限 50（`maxResourceTools`，与 M7-6a `maxDeclared` 对齐），超出的资源不物化但**仍可按 URI 读取**；资源文本经 `resourceText()` 摊平（二进制不进上下文、按 `maxResourceChars` 截断）。取舍见 `m7-base-governance.md` §8-8。

---

## 6. 治理：Permission 与 Sandbox

> **执行边界模型（v1.2，对齐 Codex 三档模式）**：Sandbox 不再是"工具装饰器"，而是**运行层的执行域边界**——每次 Run 启动即绑定一个 `SandboxMode`，文件/网络/命令访问全部在该边界内判据。引擎不亲自实现 OS 级隔离（容器/VM 仍由 host 注入），但**边界语义由运行时强制下发**：工具拿到的 `scope` 来自运行时，而非工具自行声明。

### 6.0.1 SandboxMode（运行层三档）

| 档位 | 语义 | 放行示例 | 典型工具 |
| --- | --- | --- | --- |
| `read-only` | 只读、无副作用 | 计算/时钟/只读查询 | calculator、now、只读网络工具 |
| `workspace-write` | **默认档**：仅可写声明的 workspace，写操作以 diff 可见 | 改项目文件、跑项目内测试 | edit_file、run(test) |
| `full-access` | 放开边界，仅 host 显式启用（建议隔离 VM/容器） | 任意命令/任意路径 | danger（--yolo 等价） |

运行层约束（workspace-write 及以上）：
- **网络默认禁网**：白名单由 host 注入（如 npm/pypi 镜像），越界直接 `deny`
- **文件访问走声明域**：Run 上下文携带 `SandboxScope { workspace, writablePaths, allowedReads }`，文件类工具先过 `gate()`
- **命令执行分级**：workspace 内的构建/测试命令 = workspace-write 自动放行；脱离 workspace 的高危命令 = ask/deny
- **写操作发布 `sandbox:write` 事件（含 diff）**，对齐 Codex 的"写即可见"

### 6.1 Permission（授权决策）

```
决策链（工具调用前）：policy.decide(ctx, call)
  → allow  : 放行，写入 audit
  → deny   : 拒绝并回填错误给模型（可给出拒绝原因）
  → ask    : emit(permission:request, {decisionId, call, reason})
             宿主展示 → approve/deny → resume 该 run
             超时（host 配置，默认如 60s）→ 视为 deny
```

```ts
export type Decision = { verdict: "allow" | "deny"; reason?: string }
                    | { verdict: "ask"; reason: string };

interface PermissionPolicy {
  decide(ctx: PermissionContext, call: { name: string; arguments: unknown }):
    Decision | Promise<Decision>;
  // ctx: sessionId / taskId / runId / userId / 敏感级别 /
  //      sandboxMode + scope（运行层边界） / 当前审批 handle
}

interface PermissionManager {
  setPolicy(p: PermissionPolicy): void;
  gate(call, ctx): Promise<{ ok: boolean; reason?: string }>; // run 主循环内调用
  events:  // permission:request | permission:approved | permission:denied
}
```

策略示例（内置 `FileAccessPolicy`、`NetworkPolicy` 未来按工具类别挂载）。敏感分类建议：`无害(计算/时钟)`、`只读网络(天气)`、`写文件`、`执行命令`、`访问凭据`；默认分级 allow / ask / deny。

> 实现注记（M3，2026-09-07）：`permission.ts` 已落地——`DefaultPermissionPolicy` 按 `ToolKind × SandboxMode` 决策矩阵（写文件/执行命令在 read-only 档直接 deny、可写档与 full-access 档 ask；凭据全档 deny；无害工具全档 allow）+ `PermissionManager.gate/approve/deny`，ask 挂起等待宿主（超时=按拒绝处理并触发 `permission:denied(timedOut)`）；`combinePolicies` 多策略命中取最严（对齐 codex execpolicy）。口径确认：**`network-read` 在可写/全权限档为 ask、read-only 档为 allow**——出网与否由 sandbox 的 `scope.network` 开关独立把关（能力与授权二维正交）；`approve({ always: true })` 把决定沉淀为会话级白名单，对齐 dsh 权限预设的"切档追加持久化事件"语义。敏感级别由 `ToolDefinition.meta.kind` 声明，缺省时按工具名启发式归类。（**2026-09-08 追注**：M6 起 `permission.ts` 已迁出至 `@node-agent-runtime/policy`，core 经 facade 转发仍可导入；工具分类纯函数 `classifyToolName`/`toolKind` 下沉 C1）

### 6.2 Sandbox（执行隔离）

引擎不假设工具在何处运行，由 host 注入 sandbox：

```ts
interface Sandbox {
  // 运行层（v1.2）：为一次 Run 建立执行域（模式 + 声明域 + 网络策略）
  begin(mode: SandboxMode, scope: SandboxScope): Promise<SandboxHandle>;
  // SandboxHandle.openTool(name) → 包裹后的工具：先 scope/gate 校验再执行

  wrap<T extends AnyTool>(tool: T): T;               // 装饰：限时/限流/隔离
  // 参考实现：
  //  - LocalSandbox     ：超时(AbortController) + 递归深度/大小上限 + 越界(scope)拒绝
  //  - WorkerSandbox    ：工具下沉 worker_threads / child_process，宿主可控
  //  - ContainerSandbox ：docker/VM 级隔离（full-access 与高危执行推荐）← 对齐 Codex
  //  - RemoteSandbox    ：本身就是 MCP 远端进程 → 自然边界
}

// v1.2：边界语义由运行时下发，工具不可自报 scope
interface SandboxScope {
  workspace: string;                 // 可写根目录（read-only 档为空）
  writablePaths: string[];           // 额外可写白名单（host 配置）
  network: "deny" | "allowlist";     // 默认 deny，白名单列表由 host 给
  env?: Record<string, string>;      // 精简环境变量（剥离敏感项）
}
```

> 实现注记（M3，2026-09-07）：`sandbox.ts` 已落地——`Sandbox.begin(mode, scope, ctx)` 建立一次 Run 的执行域，`LocalSandbox`（进程内，默认）对每个工具执行五点检查：① read-only 档拦截副作用类工具、② `scope.network === "deny"` 时拦只读网络类、③ 写工具的 path 参数解析后必须落在 workspace/writablePaths 声明域内、④ 每调用超时（默认 30s，超时抛 `SandboxTimeoutError`）、⑤ 写类工具执行后发 `sandbox:write`（尽力行级 diff，`simpleDiff`）——拦截一律抛 `SandboxViolationError`，由引擎回填给模型自纠。`SessionManager` 默认 `sandboxMode: workspace-write` + `workspace: cwd` + `network: deny`；策略层放行也过不了 read-only 沙箱（纵深防御）。OS 级 `WorkerSandbox`/`ContainerSandbox` 仍是宿主侧插口，接口不变。（**2026-09-08 追注**：M6 起 `sandbox.ts` 已迁出至 `@node-agent-runtime/sandbox`，`LocalSandbox` 请从子包导入）

---

## 7. Event（事件契约扩展）

保持「事件 = 类型判别联合 + 无侵入总线」的现状风格。扩展后全集：

| 域 | 事件 | 说明 |
| --- | --- | --- |
| run（已有） | `run:start` `step:start` `model:response` `tool:start` `tool:end` `run:end` `run:error` | 保持兼容 |
| session | `session:created` `session:updated` `session:closed` | 会话生命周期 |
| task | `task:created` `task:status` | 任务状态迁移 |
| permission | `permission:request` `permission:approved` `permission:denied` | 审批流（含 decisionId） |
| sandbox | `sandbox:write` | 写操作发生（含 diff），"写即可见"对齐 Codex |
| checkpoint | `checkpoint:created` `checkpoint:resumed` | 快照落盘/恢复 |
| artifact | `artifact:created` | 新产物可用（含可展示元数据） |
| memory | `memory:updated` | 记忆写入 |

约束：所有事件保持 JSON 可序列化（跨进程/SSE 传输前提）；`runtime.run()` 内的旧事件字段不回退删改。

---

## 8. Artifact 与 Memory

### 8.1 Artifact（产物）

工具或 Agent 可产出用户可见/可引用结果：

```ts
interface Artifact {
  readonly id: string;
  kind: "text" | "file" | "chart" | "mcp-resource" | "url";
  name: string;                       // 展示名
  mime: string;                       // 由 kind 归一化
  locator: string;                    // blobKey / path / url（透明由 store 解析）
  meta: Record<string, unknown>;
  sessionId: string; runId?: string;
  createdAt: number;
}
```

落点：小文本入 KV，大文件走 Blob store（`Storage` 见 §9）；UI 通过 `locator` 拉取，无需关心实现。

> 实现注记（M4，2026-09-07）：`ArtifactManager` 已落地于 C2 `packages/core/src/artifact.ts`——元数据行按 §9 文档域落 KV（`DocDomain` 新增 `artifact`），`text`/`file`/`chart`/`mcp-resource` 的 payload 统一入 Blob 域（`locator` = `blob:<key>`），`url` 类不落内容（`locator` = 目标 URL）；提供 `save`（同 id upsert）/`get`/`list(sessionId, runId?)`（新在前）/`readBytes`/`readText`/`remove`（幂等，级联删 blob）。宿主侧 `SessionManager` 暴露 `readonly artifacts`，`deleteSession` 一并清理该会话的 artifact 元数据与 payload。（**2026-09-08 追注**：M6-9 起 `ArtifactManager` 迁至独立包 `@node-agent-runtime/artifact`；`SessionManager` 门面由 `@node-agent-runtime/host` 提供）

### 8.2 Memory（记忆）

```ts
interface Memory {
  // 会话层（session 生命周期）
  append(message: ChatMessage): Promise<void>;
  messages(limit?: number): Promise<ChatMessage[]>;

  // 长期事实层（可选后端：KV / 向量化占位），供 Agent 配方注入"summary/facts"
  remember(key: string, value: unknown): Promise<void>;
  recall(query: string, limit?: number): Promise<Array<{ key: string; value: unknown; score: number }>>;
}
```

现状衔接：`runtime.run()` 的 `history` 参数由 Session 的 Memory 取代；引擎只读 `memory.messages()`。

> 实现注记（M2，2026-09-07）：`SessionMemory` 已落地——会话层复用 per-session 追加式消息流，事实层为每会话一个 KV 文档；`recall` 当前是零依赖词面 + CJK bigram 打分，向量后端可后续替换而引擎不动。（**2026-09-08 追注**：M6 起 `SessionMemory` 已迁至 `@node-agent-runtime/memory`，M6-10 起 checkpoint 亦归位该包）

---

## 9. Persistence 与 Storage

引擎需要持久化的实体域：`Session`、`Task`、`Run`、`Step`（随 Run 内嵌）、`Checkpoint`、`Message`（属 session）、`Artifact`、`Memory`。

```ts
// 统一存储门面（core 内置内存实现；host 可选文件 / SQLite 实现）
interface Storage {
  // 文档域：JSON 行式
  saveDoc<T>(domain: DocDomain, id: string, doc: T): Promise<void>;
  loadDoc<T>(domain: DocDomain, id: string): Promise<T | undefined>;
  listDocs<T>(domain: DocDomain, filter?: Partial<T>): Promise<T[]>;
  deleteDoc(domain: DocDomain, id: string): Promise<void>;

  // Blob 域：Artifact 大文件
  putBlob(key: string, data: Buffer | Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Buffer | undefined>;

  // 流域：消息追加 / 事件日志（追加式，天然适配 Run 记录）
  appendStream(domain: StreamDomain, id: string, line: string): Promise<void>;
  readStream(domain: StreamDomain, id: string): Promise<string[]>;
}
```

实现约定：
- `MemoryStorage`（core 内置）：Map 实现，供测试与无盘 demo。
- `FileStorage`：目录即 domain，JSON 文件即 doc；供单机桌面（默认）。
- `SQLiteStorage`（可选、不进入 core 依赖）：`better-sqlite3` 仅存在于独立包 `@node-agent-runtime/store-sqlite`，不影响"核心零依赖"。
- 原子性：单文档整体覆盖写；Checkpoint 单独成域，天然可回滚。

Checkpoint 结构：

```ts
interface Checkpoint {
  readonly id: string;
  runId: string; sessionId: string; taskId: string;
  step: number;                        // 已完成到第几步
  messages: ChatMessage[];             // 该步后的完整消息流（含工具结果）
  usage: RunUsage;                     // 累计
  agentSnapshot: { agentId: string; toolsHash: string };  // 恢复一致性校验
  createdAt: number;
}
```

恢复协议：`resume(checkpointId, continuation)` = 载入 messages + 校验 toolsHash → 以「用户追加消息」继续跑同一 run 语义（status 回到 running）。

> 实现注记（M2，2026-09-07）：`SessionManager.resume()` 以 checkpoint 为基线重放 transcript，工具指纹不一致时抛 `CheckpointMismatchError`；未提供 `continuation` 时不追加用户轮次（`RunOptions.appendUserMessage = false`），因此续跑 transcript 与一次性跑完逐条一致。步级快照由引擎的 `RunOptions.onStepEnd` 回调产出，宿主负责落盘——引擎自身不持有 checkpoint 状态。（**2026-09-08 追注**：M6-7 起 `SessionManager` 属 `@node-agent-runtime/host`；M6-10 起 checkpoint 以 `ToolSurface` 契约归位 `@node-agent-runtime/memory`）

---

## 10. 目标目录结构

```
src/
├── index.ts                     # 公共 API（保持向下兼容导出）
├── core/                        # ← 现有逻辑迁移，接口不动
│   ├── runtime.ts  events.ts  agent.ts  tool.ts
│   ├── provider.ts  types.ts  schema.ts  util.ts
│   ├── providers/   tools/
│   └── context.ts               # Context 门面（由 run 注入）
├── session.ts                   # SessionManager / Task
├── memory.ts
├── checkpoint.ts
├── permission.ts
├── sandbox.ts
├── artifact.ts
├── mcp/
│   ├── types.ts                 # McpServerHandle / McpToolMeta / McpToolRef
│   ├── registry.ts              # 物化到本地 ToolDefinition
│   ├── transport.ts             # stdio / http(sse) 客户端
│   └── client.ts                # JSON-RPC 2.0 协议实现
└── store/
    ├── types.ts                 # Storage 接口（本核心仓库内）
    ├── memory.ts                # 内存实现（内置）
    └── file.ts                  # 文件实现（内置，Node）
examples/
├── cli.ts                       # 演进：Session 化 + Permission ask 命令行审批
├── web/                         # 演进：读 Persistence、权限弹窗 SSE
└── desktop/                     # [未来] Electron/Tauri 壳示例
packages/                        # [未来，若拆包]
├── node-agent-runtime-core/          # 零依赖核心（上述 src/core + store/memory）
├── node-agent-runtime-store-sqlite/
├── node-agent-runtime-mcp/           # mcp/*（依赖 JSON-RPC 但对 core 零侵入）
└── node-agent-runtime-host/          # Session/Task/权限策略等产品面
```

拆分原则：**`core` + `store/memory` 永远零依赖**；IO 与协议翻译（MCP、SQLite）下沉独立包。

> 现状注记（v0.2，2026-09-05）：上表为**目标**目录结构。当前已按 `docs/historical/crate-architecture.md` §7.1 方案 A（npm workspaces）先行落地 C1 `@node-agent-runtime/types` 与 C2 `@node-agent-runtime/core`（`packages/types`、`packages/core`），引擎代码位于 C2 的 `src/`（runtime/agent/context/session/events/tool/provider/tools/providers/store），测试随包；其余包（store-sqlite/mcp/host/desktop）仍按里程碑逐步增补。
> **更新（v1.8，2026-09-07，M6 P1）**：目标结构已落地为 **9 个 workspace 包**——C1 `types`（契约：消息/工具/事件/Storage/Artifact）、C3 `memory`、C4 `sandbox`、C5 `policy`、C2 `core`（引擎 + facade）、C8 `host`（`SessionManager`）、C6 `mcp`、C7 `provider-openai`、C9 `store-sqlite`；依赖方向 `types ← {memory, sandbox, policy} ← core ← {host, mcp, provider-openai, store-sqlite}`，单向无环。`SessionManager` 已迁出 core（破坏性变更，见 §13 v1.8）。
> **更新（v1.9，2026-09-08，M6-9~M6-11 审查整改）**：实际落地为 **12 个 workspace 包**——v1.8 九包基础上，按 `docs/historical/p1-review.md` P0/P1 增补 `@node-agent-runtime/artifact`（产物管理，自 C3 拆出，一包一职责）、`@node-agent-runtime/tools-basic`（内置基础工具集，演示资产）、`@node-agent-runtime/mock`（MockProvider 演示桩）：`types / memory / artifact / sandbox / policy / core / tools-basic / mock / host / mcp / provider-openai / store-sqlite`；依赖方向 `types ← {memory, artifact, sandbox, policy} ← core ← {tools-basic, mock, host, mcp, provider-openai, store-sqlite}`，单向无环。`core` 收窄至 **1005 行**（引擎 + facade：`export *` 转发 types/memory/artifact/sandbox/policy；host 与 mcp 因方向为「子包 → core」不被反向 re-export）。工具分类纯函数 `classifyToolName`/`toolKind` 下沉 C1（sandbox re-export 保持 API 不变），`checkpoint.ts` 以 `ToolSurface` 契约解耦 `Agent` 后归位 C3 memory（core 经 facade 转发仍可导入）；事件总线支持宿主注入（`AgentRuntimeOptions.events` / `SessionManagerOptions.events`）。公共 API 面当日重新冻结（`docs/api-surface.md`，12 包）并脚本化复核（M6-11，`npm run check:api`）。详见 §13 v1.9 与 `docs/historical/m6-productization.md`、`docs/historical/p1-review.md`。

---

## 11. 演进路线图

| 里程碑 | 范围 | 交付物 | 验收 |
| --- | --- | --- | --- |
| **M0（现状 v0.1）** | 引擎主循环、事件、工具、双 provider | 现状 `src/` | `npm test`（14 用例）；v0.2 起代码迁入 `packages/core`（C2）与 `packages/types`（C1） |
| **M1 · 生命周期** | `Session`/`Task`/`Run` 实体化；`Storage` 接口 + memory/file 实现；`Context` 门面 | `session.ts` `store/` `context.ts` | ✅ dev 分支已完成（2026-09-04）：会话可重启恢复、`history` 不再由调用方维护；`npm test` 35 通过 |
| **M2 · 记忆与续跑** | ✅ dev 分支已完成（2026-09-07）：`Memory`、`Checkpoint`、resume | `memory.ts` `checkpoint.ts` | 中断（abort/崩溃）后从 checkpoint 续跑，transcript 与最终输出与一次性跑完一致；`npm test` types 4 + core 50 通过 |
| **M3 · 治理** | ✅ dev 分支已完成（2026-09-07）：`Permission` 策略 + ask 审批流；`Sandbox` 运行层执行域（`LocalSandbox`：`SandboxMode` 三档 + `SandboxScope` 声明域 + 网络默认禁网 + 超时） | `permission.ts` `sandbox.ts` | 危险工具默认 ask/deny、审批超时=拒绝（自动化）；read-only 档 exec/write 被拒并回填错误给模型自纠；write ask → 宿主 approve → 落盘且 `sandbox:write` 含 diff（自动化）；**策略 allow 也过不了 read-only 沙箱**（纵深防御，自动化）；网络默认 deny、路径越界拒绝；`npm test` types 4 + core 77 通过 |
| **M4 · 外部能力** | ✅ dev 分支已完成（2026-09-07）：MCP client（stdio + streamable HTTP）；`Artifact` | `mcp/` `artifact.ts` | 注册 mock MCP server → 其工具可被模型调用（自动化：stdio 子进程 + HTTP 双 mock server 端到端）；`npm test` types 4 + core 99 通过 |
| **M5 · 产品化** | 独立分包 + Desktop 壳 + Web 控制台全面 Session 化 | `packages/` `examples/desktop/` | 桌面 demo 全流程可用 |
| **M6 · 生产级改造** | demo → 生产级：包边界收口、审查整改（P0/P1/P2）、CI/质量门、可观测与安全、发布工程、分发矩阵、治理文档 | `packages/{types,memory,artifact,sandbox,policy,core,tools-basic,mock,host,mcp,provider-openai,store-sqlite}` | 🟡 **Gate 1~4 已关闭，P5/P6 收尾中（2026-09-09）**：Gate 1（2026-09-07）→ Gate 2（P2 质量门，M6-14~17）→ Gate 3（P3 可观测与安全，M6-18~M6-21，含 P3 评审 8 项发现全部修复，见 `docs/historical/p3-review.md`）→ Gate 4（P4 SDK 发布工程，M6-22：MIT LICENSE、12 包去 `private` 与发布元数据、`engines >=22.13` + `.nvmrc`/`packageManager`、changesets 编排、`core`/`types` peer 边界、包体积基线）；**P5 分发部署矩阵**：P5.5 生产存储基线（schema 版本化/索引/在线备份）与 P5.6 Web 部署样例（`deploy/` + `/healthz` 探活）已完成（M6-24），P5.1~P5.4 桌面形态补齐 sidecar 构建、脚本化验收与三平台 CI（M6-25），实机签名验收待 Developer ID 证书；**P6 治理文档**：P6.1/P6.2 已完成（M6-23）。**C8 host 为破坏性变更**（`SessionManager` 改从 `@node-agent-runtime/host` 导入）。逐项状态见 `docs/historical/m6-productization.md` |
| **M7 · 底座收敛与治理交付** | 以 **12 包为唯一一等公民**：成本与上下文治理、可观测与合规导出、策略工程化、工具规模治理；`examples/` 与 `deploy/` 降级为验证载体，桌面端移出至产品侧 | `packages/{types,core,policy,mcp,provider-openai}` 增量 + 文档口径收敛 | ✅ **已关闭（2026-09-17 收口）** —— M7-1 / M7-2 全量 / M7-3 / M7-6a / M7-6b / **M7-5 底座部分** 全部交付（2026-09-15），**无待做项**；立项口径与边界见 `docs/base-convergence.md`（只对底座立项）；候选与首批建议见 `docs/product-direction.md` §5（首批 M7-1/2/3/6a）；**执行清单见 `docs/historical/m7-base-governance.md`**（2026-09-10 立：各包落点 / API 变更分级 / 验收用例 / 顺序）；**已交付**：批次 A（版本 bump 到 0.3.0，未发布、未打 tag）与 **M7-2 的 traceId 贯穿**（19 个事件统一 `traceId?` + `emit()` 与 `redact()` 同点收口 + `Logger.child` + `run:start.startedAt` / `run:end.endedAt`，测试见 `packages/core/test/trace.test.ts`，`npm run ci` 全绿）；**已交付**：M7-6b（MCP 只读资源 `resources/list` / `resources/read` + `searchTools`，资源物化为只读工具、只认已声明 URI、敏感度保守取 `network-read`，见 §5.3 追注）；**已交付**：**M7-5 底座部分**（Agent 配方编译 `compileAgent()` + 配方快照 `instructionsHash`，2026-09-15 同日交付，执行清单见 `docs/historical/m7-base-governance.md` §9；并发调度按 `base-convergence.md` §6 需先论证，不进本批）—— 首批四项 + 6b + M7-5 底座部分全部落地，**无待做项**；P5.1~P5.4 已随桌面端移出至产品侧（不再是底座保留项），不进关键路径 |
| **M8 · 采纳闭环与协议接入** | 依 2026-09-17 两项拍板：**目标客户 = 先 (a) 开发者个体建生态、同步铺 (c) 企业合规交付物**；**形态路径 = 先走 D（ACP 适配包），不自建壳**。线①生态与交付：脚手架 `create-node-agent-runtime` + 示例库 + 文档站、`deploy/` 补 K8s/Helm 与升级回滚说明；线②协议接入：ACP 规范核对 → `@node-agent-runtime/acp` + 权限桥接 → 流式（条件前置）→ `tools-code`（延后） | `packages/acp`（新包）、`packages/core` / `provider-openai`（流式）、示例库与脚手架、`deploy/` | 🟡 **部分落地（2026-09-17）**：规范核对已完成（记录见 `docs/acp-spec-review.md`）—— 传输为 stdio（换行分隔 JSON-RPC，日志走 stderr）；**`session/update` 不要求 token 级分块，故流式非前置**。其中 **M8-2 已代码完成**：新包 `packages/acp`（第 13 个包），stdio 传输经真实子进程冒烟验证；**M8-3 已代码完成**：`session/request_permission` ↔ `PermissionManager` 桥接（客户端不实现该方法时降级为拒绝，不再空等审批超时）+ `session/set_mode` ↔ `SandboxMode` 并同时提供 `session/set_config_option`（官方明示 set_mode 将被移除，故双轨），共 33 例测试通过，待真机联调，执行清单见 `docs/m8-acp-adapter.md`；M8-4 流式未开工；排期与验收见 `docs/development-checklist.md` §3.4；决策依据 `docs/product-build-paths.md` §9；每项立项前须过 `docs/base-convergence.md` §3 三问准入 |

> M1~M5 均要求保持 `npm run typecheck` 与 `npm test` 全绿；每模块独立 `*.test.ts`，测试即规格。

---

## 12. 设计原则（延续并明确化）

1. **分层依赖单向**：Desktop → Host → Core →（Tool/Model/MCP）；禁止反向引用。
2. **事件即接口**：UI/审计/可观测都从事件流获取信息，不向引擎加回调专属 API。
3. **核心零依赖、可移植**：一切外部 IO（HTTP/MCP/SQLite）都藏在注入实现后面。
4. **接缝最小化**：MCP 的唯一接缝是 `ToolDefinition`；Persistence 的唯一接缝是 `Storage`；权限的唯一接缝是 Run 主循环里一个 `gate()` 调用点。
5. **失败可恢复**：任何一步都可通过 Checkpoint 重建；工具失败回填错误让模型自纠（现状已实现）。
6. **产品概念不进引擎**：Session 标题、审批弹窗、多窗口路由属于 host；引擎只保留通用原语。

---

## 13. 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v1 draft | 2026-09-04 | 依据产品架构图 1（分层）与图 2（Runtime 模块树）初稿；建立 M0~M5 路线 |
| v1.1 (M1) | 2026-09-04 | 落地 M1 生命周期：`Session`/`Task`/`Run` 实体化（`session.ts`）、`Storage` 接口 + `MemoryStorage`/`FileStorage`（`store/`）、`Context` 门面（`context.ts`）、session/task 事件；CLI/Web 会话化；模块表“现状”列更新 |
| v1.2 (M3 设计) | 2026-09-05 | Sandbox 由工具装饰器升格为**运行层执行域边界**：引入 `SandboxMode`（read-only / workspace-write / full-access，对齐 Codex 三档）与 `SandboxScope`（workspace 可写域、网络默认禁网、环境变量精简）；文件/命令访问先过 `gate()`、越界 deny；写操作发布 `sandbox:write`（含 diff）事件；`PermissionContext` 携带 sandbox 边界；§4.3 Run 循环增加 `sandbox.begin()`；模块表/事件表/路线图 M3 验收同步更新 |
| v1.3 (workspace 化) | 2026-09-05 | 代码按 `docs/historical/crate-architecture.md` §7.1 收敛为 npm workspaces：C1 `@node-agent-runtime/types` / C2 `@node-agent-runtime/core`（C2 re-export C1 保持公共 API 不变）；§10 目标结构下包形态落地注记；详见 crate-architecture.md v0.2 修订 |
| v1.4 (M2) | 2026-09-07 | 落地 M2 记忆与续跑：`memory.ts`（`SessionMemory`：消息流 + 事实层 `remember/recall`）、`checkpoint.ts`（步级快照 + `CheckpointStore` + `computeToolsHash`/`assertResumable`）、`SessionManager.resume()`；引擎新增 `RunOptions.onStepEnd` / `initialUsage` / `appendUserMessage` 与 `StepSnapshot`，新增 `checkpoint:saved` / `checkpoint:restored` 事件，`DocDomain` 扩展 `checkpoint` / `memory`；每步增量落盘取代 run 结束时一次性落盘；§2 模块表、§8.2、§9、§11 M2 行同步 |
| v1.5 (M3) | 2026-09-07 | 落地 M3 治理：`permission.ts`（`ToolKind` 敏感分类 + `DefaultPermissionPolicy` 决策矩阵 + `PermissionManager` ask 审批流/超时/`approve({always})`/`combinePolicies` 取最严）、`sandbox.ts`（`SandboxMode` 三档 + `SandboxScope` + `LocalSandbox`：read-only 拦副作用、禁网开关、路径越界拒绝、每调用超时、`sandbox:write` 含 diff）；`ToolDefinition` 增 `meta.kind`/`pathArgs`；引擎新增 `RunOptions.gate` 单一授权接缝，新增 `permission:request/approved/denied` 与 `sandbox:write` 事件（§7 v1.2 表已预留，命名一致）；`SessionManager` 默认注入 `LocalSandbox` + `PermissionManager` 并公开 `pendingApprovals/approve/deny`；§2 模块表、§6.1/§6.2 实现注记、§11 M3 行同步 |
| v1.6 (M4) | 2026-09-07 | 落地 M4 外部能力：`packages/core/src/mcp/`（`McpClient` + `StdioTransport`/`StreamableHttpTransport` + `McpRegistry` 物化 `mcp__server__tool` 本地工具、`normalizeSchema`/`classifyToolName` 推断）、`artifact.ts`（`ArtifactManager` + `DocDomain` 增 `artifact`，payload 入 Blob）；`SessionManager` 增 `artifacts` 门面并级联清理；§2 模块表 `MCP`/`Artifact`、§5.3 / §8.1 实现注记、§11 M4 行同步 |
| v1.8 (M6-P1) | 2026-09-07 | **包边界收口（M6 P1，split 分支）**：C3 `@node-agent-runtime/memory`（memory + artifact）、C4 `@node-agent-runtime/sandbox`、C5 `@node-agent-runtime/policy`、C6 `@node-agent-runtime/mcp`、C8 `@node-agent-runtime/host`（`session.ts`）依次外置为独立包，`core` 收窄为 facade（`export *` 转发 memory/sandbox/policy；mcp 与 host 因方向为「子包 → core」不反向 re-export）；共享契约下沉 C1：`Storage`/`DocDomain`/`StreamDomain`、`Artifact`/`ArtifactKind`/`ArtifactInput`、工具契约（`ToolDefinition`/`AnyTool`/`ToolKind`/`ToolMeta`/`ToolExecutionContext`）、事件契约（`RuntimeEvent` 等 + 新增 `EventEmitter<E>`）。**破坏性变更**：`SessionManager` 改从 `@node-agent-runtime/host` 导入。§10 现状注记更新为 9 个 workspace 包结构；§11 新增 M6 行。详见 `docs/historical/crate-architecture.md` v0.5~v0.10 与 `docs/historical/crate-split-todo.md` |
| v1.9 (M6 审查整改) | 2026-09-08 | **P1 审查整改闭环（M6-9~M6-11，split 分支）**：按 `docs/historical/p1-review.md` P0/P1/P2 整改——① 演示资产外置（`@node-agent-runtime/tools-basic` / `@node-agent-runtime/mock`）；② `artifact.ts` 自 C3 拆出为独立包 `@node-agent-runtime/artifact`（一包一职责）；③ 工具分类 `classifyToolName`/`toolKind` 下沉 C1（sandbox re-export 保兼容，mcp 去除对 sandbox 依赖）；④ `checkpoint.ts` 以 `ToolSurface` 契约解耦 `Agent` 后归位 C3 memory，core 由 **1804 → 1005 行**、收窄为引擎 + facade；⑤ 事件总线可注入（`AgentRuntimeOptions.events` / `SessionManagerOptions.events`，host 统一 `this.events`）；⑥ 公共 API 面按 **12 包**重新冻结（`docs/api-surface.md`），快照复核脚本化（M6-11：`scripts/check-api-surface.ts` + 基线 + `npm run check:api`）。§10 现状注记 / §11 M6 行同步更新。详见 `docs/historical/m6-productization.md`、`docs/api-surface.md` §13 |
| v1.10 (M6-P2~P6) | 2026-09-09 | **生产级改造收尾（M6-14~M6-25）**：P2 质量门（`npm run ci` 一键收口 typecheck → lint → test → coverage:gate → `check:api` → 体积门禁，CI 编排 + 跨形态 E2E）；P3 可观测与安全（结构化日志 + 稳定错误码、事件/日志脱敏、审批审计与 `always` 白名单持久化、成本与速率上限、Web 鉴权与防跨站、MCP 供应链防护（含重定向 SSRF 与子进程 env 最小化）、默认安全策略包、`loadConfig` 配置分层，评审与修复见 `docs/historical/p3-review.md`）；P4 SDK 发布工程（MIT LICENSE、12 包发布元数据、Node `>=22.13` 与 `.nvmrc`/`packageManager`、changesets + `release.yml`（`npm publish --provenance`）、`core`/`types` peer 边界、发布 d.ts 自包含（`ProcessEnv`）、包体积基线）；P5 分发部署（store-sqlite `SCHEMA_VERSION` 版本化迁移 + session/task/run 索引 + `VACUUM INTO` 在线备份、`deploy/` 部署样例与 `/healthz` 探活、桌面 sidecar 构建脚本与三平台构建矩阵）；P6 治理文档（`CONTRIBUTING.md`、`SECURITY.md`、README 生产用法与 badges）。§11 M6 行同步 |
| v1.11 (底座收敛) | 2026-09-10 | **项目口径收敛（判定事实源：`docs/base-convergence.md`）**：确立「**底座 = `packages/*` 12 包**」为唯一一等公民；`examples/cli.ts`、`examples/web/`、`deploy/`、`scripts/e2e/`、`scripts/smoke-web.mjs` 降级为**验证载体（只验证底座，不演进产品）**；`examples/desktop-tauri/`、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs` 及 P5.1~P5.4 标注**冻结**（保留代码与恢复条件，不进关键路径）；垂直应用 / 消费级桌面 / Rust 移植 / 多 Agent 协同明确不立项。§1 增补「运行时分层 ≠ 投入分层」口径注记（Desktop 不再是顶层投入对象）；§11 新增 M7 行（只对底座立项）。配套同步：`docs/product-direction.md`（控制台升级路径撤销、M7 候选重归类）、`README.md`、`docs/development-checklist.md`、`docs/historical/remaining-tasks.md` |
| v1.12 (桌面端移出) | 2026-09-10 | **底座收敛取消桌面端，方向移入产品侧**（判定事实源：`docs/base-convergence.md` §2.3）：`examples/desktop-tauri/`、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs` 与 **P5.1~P5.4 整体移出底座范围**——底座不再投入，也不再判定其立项与否；原 §2.4「消费级桌面助手 → 不立项」条目撤销。§1 口径注记与 §11 M7 行同步更新（投入分层 = 底座 → 验证载体，桌面端不属任何底座分类）。配套同步：`docs/historical/m6-productization.md` §5（「挂起决定」回填为「移出决定」、Gate 5 退出标准修订、P5.1~P5.4 状态改 ⏸）、`docs/product-direction.md`（§0/§3/§4/§6/§7/§8 承接桌面形态候选与决策项）、`docs/historical/remaining-tasks.md`、`docs/development-checklist.md`、`examples/desktop-tauri/README.md` 与 `.github/workflows/desktop.yml` 顶部注记（冻结 → 移出至产品侧） |
| v1.13 (M7 执行清单) | 2026-09-10 | **M7 首批执行清单立文**（`docs/historical/m7-base-governance.md`）：把 `product-direction.md` §5 的首批四项（M7-1 成本与上下文治理 / M7-2 可观测与合规导出 / M7-3 策略工程化 / M7-6 工具规模治理）拆到「包 / 文件 / API / 验收用例 / 量级」粒度，每项可直接开单。要点：**API 变更全部 additive（minor）**，无需 major；顺序为「版本 bump 到 0.3.0 并提交（**不发布、不打 tag**）→ traceId 横切面 + M7-1 → M7-3 → M7-6a → M7-6b（延后）」；**7 项决策全部已定**（实发时序改为**延后 + bump 前置**、compact 纯函数、OTEL 纯函数 + 宿主传输、审计导出归 `host`、`policy:test` 入 CI、`tool_search` 默认 50 且 opt-in、M7-6 拆 6a/6b）。**清单已无待拍板项，M7 状态维持 ☐ 未启动**。配套同步：`docs/product-direction.md`（§0 首批口径与 §5 对齐、§9 增链）、`docs/development-checklist.md`（§0 M7 行、§3.3 注记、§5 相关文档）、§11 M7 行增链 |
| v1.14 (M7-2 traceId) | 2026-09-11 | **M7 首批开工：批次 A + M7-2 横切面**。**批次 A**：消费 `.changeset/p4-sdk-publishing.md`，12 包 `0.2.0 → 0.3.0` 并同步 `package-lock.json`（**不发布、不打 tag**），使 M7 的 changeset 干净落在 0.3.0 → 0.4.0。**M7-2 traceId 贯穿**：`types` 的 19 个事件接口统一增可选 `traceId?`，`run:start` 增 `startedAt`、`run:end` 增 `endedAt`（epoch ms）；`core` 的 `RunOptions` 增 `traceId?`（缺省 `newId("trace")`）、`RunResult` 增 `traceId`，注入点收口在 `emit()`（与 `redact()` 同处）且以 **run 内闭包**传递而非实例字段，故同一 runtime 上并发 run 互不串扰；`Logger` 增可选 `child?(ctx: LogContext): Logger`（`ConsoleLogger` 实现，未绑定上下文时输出格式逐字不变）。全部 additive（minor），新增 `packages/core/test/trace.test.ts`（12 例），`npm run ci` 六门全绿（core 行覆盖 90.92%；体积 core +2.1% / types +0.4%）。配套同步：`docs/api-surface.md` §2（增 `LogContext` 与 M7-2 注记）、`docs/historical/m7-base-governance.md` §3、`docs/development-checklist.md` §0 M7 行、§11 M7 行（☐ 未启动 → 🟡 进行中） |
| v1.15 (项目改名) | 2026-09-12 | **项目全量改名 `agent-runtime` → `node-agent-runtime`**：12 个包的 npm scope `@agent-runtime/*` → `@node-agent-runtime/*`（711 处引用：源码 import、三类依赖、tsconfig paths、`.changeset` 的 `fixed` 组、`api-surface`/`size` 基线、`package-lock.json`）；根包名、日志前缀 `[node-agent-runtime]`、`deploy/systemd/node-agent-runtime.service` 与 `deploy/nginx/node-agent-runtime.conf` 同步；13 份 `package.json` 的仓库引用改指 `https://github.com/0end1/node-agent-runtime`。**刻意未改**：类名 `AgentRuntime`（公共 API，改动即破坏性变更）与 M5-8 的历史记述。验证：`npm install` 重建 workspace 软链后 `npm run ci` 六门全绿，无双重前缀残留。配套同步：`CHANGELOG.md`、`README.md`、`SECURITY.md`、`CONTRIBUTING.md`、`docs/*`、`scripts/*`、`examples/*` |
| v1.16 (许可证) | 2026-09-12 | **许可证 MIT → Apache-2.0**：13 份 `LICENSE` 换官方正本（含 `Copyright 2026 wangzhiyong`），13 份 `package.json` 的 `license` 字段改 `Apache-2.0`，`package-lock.json` 同步；`README.md` badge + 链接、`docs/product-direction.md` §8-2、`docs/historical/m7-base-governance.md` §6 口径对齐。**代价（固有）**：Apache-2.0 文本 ~11KB 经 `LICENSE` 打进每个包 tarball，12 包体积整体 +~10KB，已 `npm run size:update` 重冻基线。历史记录（CHANGELOG / §13 v1.10 / development-checklist P4 / m6）保留「MIT LICENSE」既成事实不改写。Apache-2.0 相对 MIT：增显式专利授权、下游义务更重（NOTICE/变更标注）、不兼容 GPLv2、无 copyleft（open-core 不受影响） |
| v1.17 (M7-5 立项) | 2026-09-15 | **M7 第二批立项：M7-5 底座部分（Agent 配方编译与快照）**。依据 `docs/base-convergence.md` §6（多任务并发调度需先论证，故只立底座部分），把 §3.2 自 M4 起「设计条目、未排期」的 `compileAgent()` 落为执行清单 `docs/historical/m7-base-governance.md` §9：`types`（新增 `validateSchema()` 校验 schema 自身 + `ErrorCode.AGENT_INVALID`）· `core`（新增 `src/compile.ts`：`compileAgent()` / `AgentCompileError` / `CompiledAgent`，重名与 Schema 编译期报错；MCP 可达性经**注入式** `resolveMcp` 校验，避免 core → mcp 反向依赖成环）· `memory`（`AgentSnapshot` 增可选 `instructionsHash?` + `computeInstructionsHash()` + `assertResumable()` 软校验分支）。§8 增 4 项决策：§8-9 只做底座部分 / §8-10 注入式 `resolveMcp` / §8-11 `validateSchema` 落 `types` / §8-12 配方指纹拆 `toolsHash`（硬，不可复现即失败）与 `instructionsHash`（软，可显式放行）两级 —— 旧快照无 `instructionsHash` 时退回既有校验，**零破坏**。API 变更全部 additive（minor）。配套同步：§11 M7 行 |
| v1.18 (桌面端出库) | 2026-09-17 | **桌面端资产从本仓库实际删除**（提交 `6cf5ebf`）：`examples/desktop-tauri/`（含 Tauri/Rust 壳与全套图标资源）、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs` 全部移除；`package.json` 的 `verify:desktop` / `e2e:desktop` 脚本项、`scripts/e2e/run-all.mjs` 的 desktop runner 与 `--with-desktop` 开关、`eslint.config.js` 与 `.gitignore` 中的相应条目同步清理（释放 ~4.4G，含 Rust 构建产物）。这是对 v1.12「移出至产品侧、保留代码作为产品侧资产」处置的**升级执行**：**方向判定不变**（仍归产品侧，底座不投入、不判定），但 `base-convergence.md` §2.3「移出 ≠ 删除：不删文件 / 不删 workflow / 不删脚本」的现状描述**自本日起失效**，相关表述仅作历史记录。产品侧承接实现请从 git 历史 `6cf5ebf^` 取回（Tauri updater 签名密钥 `console.key`/`.pub` 未入库，已另行备份，不在 git 内）。配套同步：`docs/base-convergence.md`（§0 追注、§2.3 处置表与目录树）、`docs/product-direction.md`（§0/§3-D/§4/§6/§8-3）、`docs/historical/m6-productization.md` §5、`docs/historical/remaining-tasks.md`、`docs/development-checklist.md`、`docs/product-build-paths.md`、`README.md` |
| v1.19 (M7 收口 + M8 立项) | 2026-09-17 | **M7 状态收口**：§11 M7 行由 🟡 进行中转 **✅ 已关闭** —— M7-1 / M7-2 全量 / M7-3 / M7-6a / M7-6b / M7-5 底座部分均于 2026-09-15 交付且 `docs/historical/m7-base-governance.md` 记为「无待做项」，原 🟡 系状态未回填。**M8 立项（草案，未开工）**：依本日两项拍板 —— ① 目标客户优先级按 `docs/product-direction.md` §8-1 推荐值定为「先 (a) 建生态、同步铺 (c) 交付物」；② 形态路径按 `docs/product-build-paths.md` §9 推荐值定为「先走 D（ACP 适配包）、不自建壳」。据此 §11 新增 M8 行（生态与交付 / 协议接入两条线），并勾除 §3.3 候选池中已由 M7-5 交付的 `compileAgent()`。**许可策略冲突消解**：`docs/product-direction.md` §6 表的「待决」改为「已定 open-core」，与 §8-2（2026-09-15 拍板）一致。配套同步：`docs/product-direction.md`、`docs/product-build-paths.md`、`docs/development-checklist.md`（§0 / §3.3 / 新增 §3.4）、`CHANGELOG.md`。**本条未动任何代码**
| v1.20 (M8-3 权限桥接与模式协商) | 2026-09-17 | **M8-3 代码完成**（M8-2 的遗留项一并收口）：`packages/acp` 新增 `AcpPermissionBridge`（`src/bridge.ts`）与 `src/modes.ts`。① **权限**：`session/request_permission` ↔ `PermissionManager` 的 pending decision —— 桥接保留 `ask` 判定（M8-2 的 `NoAskPolicy` 兜底退出默认路径，仍保留供 `permissions: "deny"` 使用），四个标准 option 映射为 `approve()` / `approve({always:true})` / `deny()` / `deny()`+会话内记住，请求携带真实 `toolCallId` 且参数过 `redact()`，客户端回 `-32601` 时降级为拒绝而非空等 60s；② **模式**：`session/set_mode` ↔ `SandboxMode`，并按规范「set_mode 将被 Session Config Options 取代」双轨提供 `session/set_config_option`，`session/new` 同时返回 `modes` 与 `configOptions`（同表生成、恒一致）；③ **底座增量（additive）**：`host` 的 `SessionManager` 新增 `setSandboxMode()` / `getSandboxMode()`（原 `readonly sandboxMode` 改为可变），因 `sandbox.begin()` 在每次 run 开始时重读模式，故切换自**下一次 run** 生效 —— 避免了在已授权的工具执行中悄悄移动沙箱边界。测试 21 → 33 例；全仓 `typecheck` / `test`（14 包）/ `eslint` 全绿。配套同步：`docs/m8-acp-adapter.md`、`docs/acp-spec-review.md` §6/§7、`docs/development-checklist.md` §3.4、§11 M8 行、`CHANGELOG.md` | |
