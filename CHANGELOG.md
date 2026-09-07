# Changelog

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

本文件记录 **Agent Runtime（nodeRuntimes）** 的重要变更。

> **维护约定**：每次代码提交（commit）时，请同步在 [Unreleased] 或对应版本段落追加条目，并将 CHANGELOG 更新与代码放入**同一个 commit**。分类参考 Conventional Commits：`Added` 新增 / `Changed` 变更 / `Fixed` 修复 / `Docs` 文档 / `Security` 安全。

## [Unreleased]

**M5-5 · 刷新产品化可前置清单状态**（2026-09-07，dev 分支）：同步 `docs/m5-productization.md` 现状与清单状态——#3 Desktop 壳由 🟡 改为 ✅（壳 + sidecar + 图标已建、`cargo check` 通过，生产 externalBin 二进制打包归入 #5）；§1 现状补 `desktop-tauri/` 并标注 M2~M4 操作面缺口已通过 #1/#2/#3 补齐；§6 Desktop 验收细化 dev（`npm run tauri dev`）/ 生产（`tauri build` + sidecar 二进制）两条路径。

### Docs（M5-5）
- `docs/m5-productization.md`：§1 现状 + #3 状态 + §6 Desktop 验收刷新

---

**M5-4 · Desktop 壳（Tauri v2，含 sidecar + 图标）**（2026-09-07，dev 分支）：为 M5 交付物补 Desktop 壳，技术栈定为 **Tauri v2**。窗口加载 `examples/web` 控制台——`devUrl=http://localhost:8787`，`beforeDevCommand` 启 `npm run demo:web`（Node server 提供 API + 静态）。仅依赖 `core` 公共 API，未来 C8 host 不白做。release 构建以 Tauri sidecar 拉起 `agent-server`（窗口 `url` 固定 8787），dev/生产共用同一控制台；`bundle.externalBin` 待打包二进制后启用。已生成 `src-tauri/icons/`（tauri icon）。环境 `cargo 1.98`+`node v22`+Xcode CLI+@tauri-apps/cli 齐备，`cargo check` 通过。`docs/m5-productization.md` #3 状态由待定改为 Tauri 已定。

### Added（M5-4 · Desktop 壳 Tauri）
- `examples/desktop-tauri/package.json`：Tauri CLI 脚本（dev/build/tauri）
- `examples/desktop-tauri/src-tauri/Cargo.toml` `build.rs` `src/main.rs` `tauri.conf.json`：Tauri v2 应用骨架（窗口 label/url/尺寸、csp 放开 demo）
- `examples/desktop-tauri/src-tauri/src/lib.rs`：release 构建以 sidecar 启 agent-server，窗口加载控制台地址
- `examples/desktop-tauri/src-tauri/icons/`（tauri icon 多尺寸）+ `icon-source.png`：桌面图标资源

### Fixed（M5-4 · 验证）
- `examples/desktop-tauri/src-tauri/tauri.conf.json`：`beforeDevCommand` 由 `npm run demo:web` 改为 `npm --prefix ../../ run demo:web`（`demo:web` 脚本在根 package.json，Tauri 在 `examples/desktop-tauri/` 查找会 `Missing script: "demo:web"`）；`tauri dev` 现可正常拉起 `:8787` 控制台并创建窗口（2026-09-07 验证通过：`cargo` 编译 Tauri 运行时 → `Running target/debug/desktop-tauri` → `GET :8787` 200）。

### Docs（M5-4）
- `docs/m5-productization.md`：#3 状态改 Tauri 已定（骨架已建 + sidecar 接入），§5 技术栈待定点改为已定 Tauri，新增 #3 明细

---

**M5-3 · 产品化示例补齐（Web 演示面 + 存储后端演示 + 文档子系统化）**（2026-09-07，dev 分支）：为 `examples/web/` 控制台暴露 M1~M4 完整操作面——新增常驻 SSE 治理事件流 `/api/events`（`permission:request|approved|denied`、`sandbox:write`），前端渲染「需要授权」卡片（批准/始终允许/拒绝）与沙箱写入 diff；新增会话/artifact/checkpoint/resume 端点并配右侧栏承载。examples 支持 `--storage=sqlite`，验证 M5-1 外置包 `store-sqlite` 可即插即用（含 Node ≥ 22.13 校验）。README 补 M3/M2 事件与「能力参考（M1~M4）」小节。`npm run typecheck` 全绿，Web 端点 curl 验证通过。

### Added（M5-3 · Web 演示面 + 存储后端演示）
- `examples/web/server.ts`：新增 `/api/events` 常驻治理 SSE + `/api/approve` `/api/deny`；新增 `/api/sessions` `/api/new` `/api/artifacts` `/api/artifact/:id` `/api/checkpoints` `/api/resume`；storage 可选 `SQLiteStorage`（`--storage=sqlite`，Node ≥ 22.13 校验）；Web agent 并入 `demo_write_file`
- `examples/web/public/index.html`：审批卡片 + 沙箱写入渲染、侧栏（会话列表/切换、artifact 面板、续跑入口）、`EventSource` 常驻治理流与 `fetch` 驱动 resume
- `examples/cli.ts`：支持 `--storage=sqlite`（同款 Node ≥ 22.13 校验），验证外置 `store-sqlite` 包

### Docs（M5-3 · 文档子系统化）
- `README.md`：事件表补 `permission:*` / `sandbox:write` / `checkpoint:*`；新增「能力参考（M1~M4）」小节
- `docs/m5-productization.md`：#2 #4 #6 状态勾选完成，明细同步进度

---

**M5-2 · 产品化示例补齐（CLI 演示面）**（2026-09-07，dev 分支）：为 CLI demo 暴露 M3 治理面——新增演示写工具 `demo_write_file`（`kind: "write"`），让 M3 审批/沙箱在 demo 中可见。零侵入 core：工具经 `defineTool` 声明写类，由默认策略 gate 为 ask，沙箱校验路径并 emit `sandbox:write`（含 diff）；CLI 订阅 `permission:request` 与 `sandbox:write` 两条事件，run 阻塞等待授权时仍可接收 `/approve` `/deny`（事件驱动，不挂起）。`npm run typecheck` 全绿。

### Added（M5-2 · CLI 演示面）
- `examples/cli.ts`：新增 `demo_write_file`（`meta: { kind: "write", pathArgs: ["path"] }`）并入 agent 工具集，相对工作区写入文件；订阅 `sandbox:write` 展示工具名/路径/最佳努力 diff；启动提示加入「把结论写入 demo.txt（会触发授权）」

### Docs（M5-2 · CLI 演示面）
- `docs/m5-productization.md`：#1 状态勾选为「✅（CLI 完成）」，#1 明细补演示写工具，#5 注意点更新为「审批挂起风险已解除（CLI）」
- `docs/crate-split-todo.md`：新增 M5 拆包执行清单（C3~C6/C8/facade 跟踪，与 `docs/crate-architecture.md` §6 并行参考）

---

**M5-1 · 拆包收口 C7/C9**（2026-09-07，dev 分支）：`provider-openai` 与 `store-sqlite` 两个「接缝包」从 core 外置为独立 workspace 包。core 继续只留接缝（`ModelProvider` trait 与 `MockProvider`、`Storage` trait），不 import 具体后端——HTTP/IO（fetch）与 SQLite（`node:sqlite`，engine ≥22.13）不再拖累 core 的零依赖定位。examples 已切到新包导入。`npm run typecheck` + `npm test` 全绿。

### Added（M5-1 · 外置包）

- **C7 `@agent-runtime/provider-openai`**（`packages/provider-openai/`）：`OpenAIClientProvider`/`OpenAIClientOptions` 从 core 迁出（`packages/core/src/providers/openai-compatible.ts` 删除），core `providers/` 仅留 `MockProvider`；`examples/cli.ts`、`examples/web/server.ts` 改用新包导入
- **C9 `@agent-runtime/store-sqlite`**（`packages/store-sqlite/`）：`SQLiteStorage`（`node:sqlite` `DatabaseSync`，docs/blobs/streams 三表）按 `Storage` trait 实现，作为可选存储后端（`engines: node >=22.13.0`）

### Changed（M5-1 · 拆包）

- 根 `package.json` 的 build/test 纳入两新包；根 `tsconfig.json` paths 新增两包映射；`package-lock.json` 同步
- `packages/core/src/index.ts`：移除 `OpenAIClientProvider`/`OpenAIClientOptions` 导出，改注释说明外置（C7）

### Docs（M5-1 · 拆包）

- `docs/crate-architecture.md`：§6 里程碑表 M5 行标注「C7/C9 已落地、C8 host 与 facade 收窄待决」，§9 修订记录新增 v0.4
- README：`ModelProvider` / `Storage` 说明补充外置包来源；项目结构树新增 `provider-openai` / `store-sqlite` 两包

---

**M4 · 外部能力**（2026-09-07，dev 分支）：MCP client（stdio + streamable HTTP）+ `Artifact` 落地。沿用「引擎只留接缝、协议翻译在适配层」：MCP 的唯一接缝是 `ToolDefinition`——`McpRegistry` 把远端 server 物化为 `mcp__server__tool` 前缀的本地工具后，校验 / gate / sandbox / 错误回填与本地工具完全同路径；`mcp/` 与 `artifact.ts` 实现仍在 C2 内（C6 拆包随 M5，与 crate-architecture §6 一致）。`npm test` types 4 + core 99 通过 0 失败。

### Added（M4 · 外部能力）

- **MCP 适配层** `packages/core/src/mcp/`（architecture §5.3）：`jsonrpc.ts`（JSON-RPC 2.0 消息构造/解析 + `McpError`/`McpTimeoutError`/`McpConnectionError`）；`transport.ts`（`StdioTransport` spawn 子进程走行式协议、`StreamableHttpTransport` 用 fetch POST 并兼容 `text/event-stream` 与纯 JSON 两种响应解码）；`client.ts`（`McpClient` 实现 `McpServerHandle`：`initialize` 握手 + `notifications/initialized`、`tools/list`（含 cursor 分页）、`tools/call`、`close`，按请求超时拒绝）
- **McpRegistry 物化** `mcp/registry.ts`：注册即 connect + 枚举，把每个远端工具物化为本地 `ToolDefinition`（名字 `mcp__server__tool` 前缀防碰撞）；`normalizeSchema` 把 MCP inputSchema 归一化到引擎本地 JsonSchema 子集（剥掉 `$schema`/`title` 等）；敏感类由远端工具名 `classifyToolName` 推断、`pathArgs` 由 schema 中路径参数键识别；`execute` 透传 `tools/call` 并在远端 `isError` 时抛错让模型自纠；`unregister`/`resolve(ref)`/`closeAll`
- **测试基建**：独立实现的双 mock MCP server（stdio 子进程 fixture `test/fixtures/mock-mcp-server.mjs` + 进程内 HTTP server，均不与被测 client 共享协议代码），真实子进程与 HTTP 两条链路端到端
- **Artifact** `packages/core/src/artifact.ts`（architecture §8.1）：`Artifact`（kind `text`/`file`/`chart`/`mcp-resource`/`url`，mime 按 kind 归一化，`locator` = `blob:<key>` 或 url）；`ArtifactManager.save/get/list(sessionId, runId?)/readBytes/readText/remove` 全部基于 Storage；`DocDomain` 新增 `artifact`（元数据行入 KV，payload 入 Blob 域）
- **宿主集成**：`SessionManager` 新增 `artifacts` 门面（默认 over storage），`deleteSession` 级联清理会话的 artifact 元数据与 blob
- **测试**：新增 `mcp`（15 例：SSE/纯 JSON 双路径解码、远端错误透传、请求超时、协议版本协商拒绝、未连接拒绝、schema 归一化与路径参数键识别、前缀物化与 `resolve`、幂等注册、execute 透传、unregister 清理、真实子进程握手/枚举/调用、**runtime 端到端：模型调用物化 MCP 工具（§11 验收）**、SessionManager 默认治理放行无害 MCP 工具）与 `artifact`（8 例：文本/二进制往返、url 无 payload、mime 覆盖与 upsert、按 run 过滤、remove 幂等、输入校验、deleteSession 级联清理）用例

### Changed（M4 · 外部能力）

- `Storage.DocDomain` 新增 `artifact`；`SessionManager` 增加 `readonly artifacts`

### Docs（M4 · 外部能力）

- `docs/architecture.md`：§2 模块表 `MCP`/`Artifact` 标 ✅ M4，§5.3 / §8.1 补实现注记，§11 M4 行标 ✅，§13 修订记录新增 v1.6 (M4)
- `docs/crate-architecture.md`：§6 里程碑表 M4 行标注「功能已在 C2 内落地，C6 拆包留待 M5」
- README：核心概念表新增 `MCP` / `Artifact` 说明

---

**M3 · 治理**（2026-09-07，dev 分支）：`Permission` 授权决策（allow/deny/ask 审批流）+ `Sandbox` 运行层执行域落地。沿用「引擎只留接缝、宿主注入策略与执行域」的分层：引擎新增 `RunOptions.gate` 单一授权调用点，`sandbox.ts`/`permission.ts` 实现仍在 C2 内（C4/C5 拆包随 M5，与 crate-architecture §6 一致）。`npm test` types 4 + core 77 通过 0 失败。

### Added（M3 · 治理）

- **Permission** `packages/core/src/permission.ts`（architecture §6.1）：`ToolKind` 敏感分类（无害 / 只读网络 / 写 / 执行 / 凭据，`ToolDefinition.meta.kind` 声明，缺省按工具名归类）；`DefaultPermissionPolicy` 按 `ToolKind × SandboxMode` 决策矩阵（写/执行在 read-only 档 deny、可写与全权限档 ask；凭据全档 deny）；`PermissionManager.gate/approve/deny` 审批流，ask 挂起等宿主、**超时=按拒绝处理**；`approve({ always: true })` 沉淀会话级白名单；`combinePolicies` 多策略命中取最严（对齐 codex execpolicy）；`StaticPolicy`/`toolListPolicy` 便捷策略
- **Sandbox** `packages/core/src/sandbox.ts`（architecture §6.2）：`Sandbox.begin(mode, scope, ctx)` 建立 Run 执行域；`LocalSandbox` 对每个工具执行：read-only 档拦截副作用类、`scope.network === "deny"` 拦网络类、写工具 path 越界拒绝（`isPathAllowed` + `pathArgsOf`）、每调用超时（默认 30s）、写类工具执行后发 **`sandbox:write`（含尽力行级 diff，`simpleDiff`）**——拦截抛 `SandboxViolationError`/`SandboxTimeoutError`，由引擎回填给模型自纠
- **引擎接缝** `runtime.ts`：`RunOptions.gate`（每次工具执行前调用，拒绝理由回填为工具错误）；新增 `permission:request/approved/denied`（§7 已预留的 `timedOut` 字段落地）与 `sandbox:write` 事件
- **宿主默认治理** `session.ts`：默认注入 `LocalSandbox`（`workspace: cwd`、`network: deny`、`sandboxMode: workspace-write`）与 `PermissionManager`（发布到统一总线）；每个 run 绑定一次执行域并把工具 wrap 后再交给引擎；公开 `pendingApprovals()` / `approve(decisionId, { always })` / `deny(decisionId)`
- **测试**：新增 `permission`（13 例：决策矩阵、ask 审批 / 拒绝 / **超时即拒**、`approve({always})` 记住白名单、迟到审批被忽略、`combinePolicies` 最严胜出）与 `sandbox`（13 例：分类、越界判定、三档边界、禁网与放行、路径逃逸拒绝且未落盘、超时、写 diff、集成：read-only 拒 exec 并回填模型、**write ask → approve → 落盘 + `sandbox:write` diff**、**策略 allow 过不了 read-only 沙箱**（纵深防御））用例

### Changed（M3 · 治理）

- `ToolDefinition` 新增可选 `meta: { kind?: ToolKind; pathArgs?: string[] }`；内置演示工具（weather/geocode/exchange）读本地静态数据，按 harmless 处理（修正 §6.2 旧"归入只读网络"表述）

### Docs（M3 · 治理）

- `docs/architecture.md`：§2 模块表 `Permission`/`Sandbox` 标 ✅ M3，§6.1/§6.2 补实现注记与口径确认，§11 M3 行标 ✅（验收全自动化），§13 修订记录新增 v1.5 (M3)
- `docs/crate-architecture.md`：§6 里程碑表 M3 行标注「功能已在 C2 内落地，C4/C5 拆包留待 M5」
- README：核心概念表新增 `Permission` / `Sandbox` 说明

---

**M2 · 记忆与续跑**（2026-09-07，dev 分支）：`Memory` 门面 + 步级 `Checkpoint` + `resume()` 续跑落地。引擎只新增「每步快照回调」一个扩展点，落盘与编排仍在宿主 `session.ts`（与 `docs/crate-architecture.md` §6「先做功能、后做拆包」一致：C3 拆包留待 M5）。`npm test` 54 通过（types 4 + core 50）0 失败。

### Added（M2 · 记忆与续跑）

- **Memory 门面** `packages/core/src/memory.ts`（architecture §8.2）：`SessionMemory` 同时提供会话层（对话流，复用 per-session 追加式消息流，跨实例/重启可读）与长期事实层 `remember/recall`（每会话一个 KV 文档，`recall` 为零依赖词面 + CJK bigram 打分，后续可换向量后端而不动引擎）
- **Checkpoint** `packages/core/src/checkpoint.ts`（architecture §9）：步级快照（`messages` + `usage` + `agentSnapshot{agentId, toolsHash}`）；`CheckpointStore` 提供 save/load/listByRun/listByTask/latest；`computeToolsHash` 生成与工具顺序无关的稳定指纹，`assertResumable` 在工具集漂移时抛 `CheckpointMismatchError`
- **宿主续跑** `SessionManager.resume(checkpointId, continuation?)`：载入 checkpoint → 校验 toolsHash → 重放 transcript 继续跑同一 task；新 run 记录 `parentCheckpointId`，无 `continuation` 时不追加用户轮次，保证续跑 transcript 与一次性跑完逐条一致
- **每步增量落盘**：run 每完成一步即把新增消息追加进消息流并写一份 checkpoint（M1 为 run 结束后一次性落盘），中断/崩溃至多丢失一步
- **引擎扩展点** `runtime.ts`：`RunOptions.onStepEnd`（步级快照回调，宿主据此落 checkpoint）、`initialUsage`（续跑累加用量）、`appendUserMessage`（续跑不重复插入用户轮次）；新增 `StepSnapshot` 类型
- **事件**：`checkpoint:saved`（每步）、`checkpoint:restored`（续跑起跑）并入统一总线
- **存储域扩展**：`DocDomain` 新增 `checkpoint`（步级快照文档）与 `memory`（每会话长期事实 KV）；`deleteSession` 一并清理二者
- **测试**：新增 `memory`（9 例：顺序 / `limit` / 跨实例 / 坏行容错 / 会话隔离 / 事实层读写覆盖）与 `checkpoint`（10 例：指纹稳定性与工具漂移、CheckpointStore 增删改查、每步 checkpoint、**中断后续跑等价新跑**（§11 M2 验收）、重启后由新 manager 续跑、continuation 追加、工具漂移拒绝续跑、删除清理）用例

### Changed

- `SessionManager` 的 run 编排重构为 `prepareRun` / `executeRun` / `finishTask`：事务准备（会话关闭/并发锁、置 running）与执行分离；`RunRecord` 新增 `checkpointId` / `parentCheckpointId`；`messages()` 与新增的 `memory(sessionId)` 统一由 Memory 门面提供

### Docs

- `docs/architecture.md`：§2 模块表 `Memory`/`Checkpoint` 现状标 ✅ M2，§8.2 / §9 补实现注记，§11 路线图 M2 行标 ✅，§13 修订记录新增 v1.4 (M2)
- README：核心概念表新增 `Memory` / `Checkpoint` / `resume` 说明
- `docs/crate-architecture.md`：§6 里程碑表 M2 行标注「功能已在 C2 内落地，C3 拆包留待 M5」

## [v0.2.0] - 2026-09-05

**M1 · 生命周期 + C1/C2 workspace 收敛**（正式发布，dev 合并 main，commit `06edd1a`）：M1 完成 Session/Task/Run 实体化、统一持久化层与运行时上下文注入；在此基础上把代码收敛为 npm workspaces monorepo（C1 `@agent-runtime/types` 叶子包 + C2 `@agent-runtime/core` 引擎包）。`npm test` 35 通过 0 失败。

### Added（M1 · 生命周期）

- **Storage 抽象** `store/`（随包迁入 C2 `packages/core/src/store/`）：统一持久化门面（文档域 `saveDoc/loadDoc/listDocs/deleteDoc`、Blob 域、追加式流域），内置 `MemoryStorage`（核心，零依赖）与 Node 版 `FileStorage`（按 domain 落目录，JSON/NDJSON 行式，写入走临时文件 + rename 原子化）
- **Session / Task / Run 实体化** `session.ts`（随包迁入 C2 `packages/core/src/session.ts`）：`SessionManager` 管理会话生命周期（create/list/close/delete，支持外部指定 id、首轮自动标题），`Task` 状态机 created→running→done/failed/cancelled，Run 落库为 `RunRecord` 实体
- **会话级持久化消息流**：每次对话自动把新产生的消息追加到 storage，`history` 不再由调用方手动维护；进程重启后基于同一 storage 恢复会话即可携带完整上下文继续
- **Context 门面** `context.ts`：`buildRunContext` 注入运行上下文（conversation/run/session/task + now），runtime 主循环与工具执行统一使用
- **事件契约扩展**：`session:created/updated/closed`、`task:created/status` 并入统一总线（新增事件均为追加，既有 run 级事件不变）
- **examples 演进**：CLI（会话持久化到 `.runtime-data/`，新增 `/new` `/list` `/use <id>`，重启自动续最近会话）；Web 控制台（RUNTIME_DATA 目录持久化，浏览器 localStorage 固定会话跨刷新/跨服务重启恢复）
- **测试**：新增 `store`（Storage 契约双实现 13+1 例）与 `session`（生命周期 / 重启恢复 / 并发锁 / 事件序）用例；全量 `npm test` 35 通过

### Changed

- 运行时版本升至 `v0.2.0`，代码迁移至 npm workspaces monorepo 包（C1/C2）
- `src/` 死代码清理（2026-09-05）：移除无消费方的 `prettyJson` 与演示工厂 `createDemoAgent`；`builtin.ts` 5 个内置工具改为模块私有常量（仅经 `builtinTools` 暴露）、`CURRENCY_ALIASES` 改 `export const` 消除重复导出；`schema.ts` 精简恒等三元判断；公共 API 其余导出不变
- **C1/C2 收敛为 npm workspaces monorepo**（v0.2-with-workspaces，2026-09-05）：根包改 workspace 容器（`workspaces: ["packages/*"]`），按 `docs/crate-architecture.md` §7.1 方案 A 拆分——契约层（`schema/types/util`）入 C1 叶子包 `@agent-runtime/types`（零依赖），引擎实现（runtime/agent/context/events/session/tool/provider/tools/providers/store）入 C2 `@agent-runtime/core`（显式依赖 C1）；`packages/core/src/index.ts` 顶部 `export * from "@agent-runtime/types"` 保持公共 API 兼容；`examples` 与各包测试改为从包名导入；测试随包迁移（schema→types/test，runtime/session/store/calculator→core/test）；删除旧根 `test/`、`src/`、`tsconfig.examples.json`；`npm run typecheck` / `npm run build` / `npm test`（types 4 + core 31，1 有意 skip）全绿

### Docs

- 在 README / `docs/architecture.md` / CHANGELOG.md 中统一标注文档作者信息：wangzhiyong · GitHub：0end1 · 联系邮箱：y1378379002@gmail.com
- README：新增 `SessionManager` / `Storage` 概念、会话管理示例（M1）、事件表补充 session/task 事件、项目结构与提示更新
- `docs/architecture.md`：模块表"现状"列、路线图 M1 行标记为 ✅ 已完成；修订记录新增 v1.1 (M1)
- `docs/architecture.md` §6/§7/§11 修订（v1.2，2026-09-05）：**Sandbox 由工具装饰器升格为运行层执行域边界**——引入 `SandboxMode` 三档（read-only / workspace-write / full-access，对齐 Codex）与 `SandboxScope`（workspace 可写域、网络默认禁网、环境变量精简），文件/命令访问先过 `gate()`、越界 deny，写操作发布 `sandbox:write`（含 diff）事件；`PermissionContext` 携带 sandbox 边界；Run 循环增加 `sandbox.begin()`；路线图 M3 验收更新
- 新增 `docs/codex-reference.md`（2026-09-05）：**Codex-rs 可借鉴实现清单**——按 nodeRuntimes 里程碑（M3 沙箱/审批、M2 持久化、M4 MCP、模型切换层、多 Agent 前瞻）映射 `codex-rs` 各 crate 的机制与关键源码落点；仅作独立参考，不并入 architecture.md
- 新增 `docs/crate-architecture.md`（v0.1，2026-09-05）：**crate 化边界与依赖图草案**——按 codex-rs workspace 形态把 `architecture.md` §2 模块树重排为 types 底座 + 单颗零依赖 core + 外置接缝包（memory/sandbox/policy/mcp/provider/store-sqlite）+ host + apps（C1~C9+A1 映射表、依赖图、边界规则、npm workspaces 与 Rust workspace 形态对比与待决清单）；纯设计研究，不改代码
- `docs/crate-architecture.md` 升 v0.2（2026-09-05）：标注 §7.1 方案 A 已落地（C1/C2 两包、C2 re-export C1、测试随包、paths 别名 typecheck + 逐包 build/test），§5.5 测试归属、§8 待决项 #1/#6 决策状态与修订记录同步更新
- `docs/architecture.md` 修订（v1.3，2026-09-05）：§10 目标目录结构下加 C1/C2 已落地现状注记，路线图 M0 行与修订记录补充 workspace 化说明

## [v0.1.0] - 2026-09-04

首个可运行版本：从零实现的最小 Agent 运行时（TypeScript / Node.js，零第三方运行时依赖），并附架构演进设计。

### Added

- **引擎核心**：ReAct 式多步推理事件循环（`AgentRuntime.run`），支持
  - 模型决策 → 工具调用 → 结果回填 → 继续推理 → 最终回答的完整闭环
  - 本地 JSON Schema 参数校验（工具失败自动回填错误，模型可自纠）
  - 未知工具 / 工具异常 / 重复工具名 的健壮处理
  - `maxSteps` 上限防死循环、`AbortSignal` 中止支持
- **事件总线**：类型化 `EventBus`，覆盖 run / step / model / tool / error 全生命周期事件，UI 与日志可流式还原推理过程
- **工具系统**：`ToolDefinition` 抽象（名称 + 描述 + JSON Schema + `execute`）
  - 内置 `calculator`（Pratt 解析安全求值，绝不使用 `eval`）
  - 演示工具集 `now` / `geocode` / `weather` / `exchange`
- **模型接入层**：`ModelProvider` 接口
  - `OpenAIClientProvider`：兼容任意 OpenAI 兼容端点（OpenAI / DeepSeek / 通义千问 / Ollama）
  - `MockProvider`：免密钥规则模型，离线可演示完整多步推理
- **演示**：交互式终端 CLI（`demo:cli`）、SSE 流式 Web 控制台（`demo:web`，内存会话）
- **Schema 校验器**：零依赖 JSON Schema 子集实现
- **测试**：node:test 自动化测试 14 例（事件循环 / 多步推理 / 工具安全 / 参数校验 / 中止）

### Docs

- **架构设计文档** `docs/architecture.md`：目标产品架构（Desktop / Product Host / Runtime / Storage 分层）与 Runtime 模块树（Session / Task / Run / Step、Context / Model / Tool / MCP、Permission / Sandbox、Event / Memory / Artifact / Checkpoint / Persistence）的接口草案与演进路线图 M0~M5
- README：快速开始、核心概念、事件表、运行验证指南
