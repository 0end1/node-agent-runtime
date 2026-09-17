# Changelog

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

本文件记录 **Agent Runtime（nodeRuntimes）** 的重要变更。M5/M6/M7 的完整执行与评审记录已归档至 `docs/historical/`，本文件自此只保留「版本级摘要」。

> **维护约定**：每次代码提交（commit）时，请同步在 [Unreleased] 或对应版本段落追加条目，并将 CHANGELOG 更新与代码放入**同一个 commit**。分类参考 Conventional Commits：`Added` 新增 / `Changed` 变更 / `Fixed` 修复 / `Docs` 文档 / `Security` 安全。

## [Unreleased]

### Added

- **M8-3 落地（ACP 权限桥接 + 模式协商）**：`packages/acp` 新增 `AcpPermissionBridge` 与 `modes.ts`。① **权限**：把 `PermissionManager` 挂起的审批决策变成 `session/request_permission` —— 桥接**保留** `ask` 判定（替换 M8-2 的 `NoAskPolicy` 兜底，后者仍可通过 `permissions: "deny"` 使用），四个标准选项映射为 `approve()` / `approve({ always: true })`（落 P3 grant 持久化）/ `deny()` / `deny()`+会话内记住；请求携带**真实 `toolCallId`**（`tool:start` 先于 `gate()` 发出）、参数过 `redact()`，客户端回 `-32601` 时**降级为拒绝**而非空等 60s 审批超时。② **模式**：`session/set_mode` ↔ `SandboxMode`，并按规范「set_mode 将被移除」**双轨**提供 `session/set_config_option`；`session/new` 同时返回 `modes` 与 `configOptions`（同表生成、取值恒一致）。③ **底座增量（additive）**：`host` 的 `SessionManager` 新增模式切换 API（见下一条）。测试 21 → 33 例（新增权限 7 例 + 模式 5 例，含「切 `read-only` 后写工具被策略直接拒绝、不再弹审批」的行为验证）。
- **`host`：新增 `SessionManager.setSandboxMode()` / `getSandboxMode()`**（随 M8-3，additive）：`sandboxMode` 由构造期只读改为可运行时切换。因 `sandbox.begin()` 在每次 run 开始时重读模式，**切换自下一次 run 生效** —— 不在已授权的工具执行中悄悄移动沙箱边界；既有构造签名与行为不变，**非破坏**。发布时 `host` 按 **minor** bump（新增公开 API 面）。
- **M8-2 / M8-3 协议级 E2E 与真机入口（2026-09-17）**：新增 `scripts/e2e/acp.mjs`（`npm run e2e -- --only=acp`，已并入默认 `npm run e2e`）。做法是 spawn **真实 agent 子进程**（`packages/acp/test/fixtures/stdio-agent-governed.ts`，带 write 类工具），用一个**自写的协议级客户端**（自己解帧、自己应答 `session/request_permission`）经真实 stdio 走完 9 步：握手 → `session/new`（`modes` / `configOptions` 同值）→ 审批往返（`pending` → 批准 → `completed`，参数已脱敏）→ `session/load` 回放 → `set_config_option` 切 `read-only`（含 `current_mode_update` 回显）→ 只读下写工具被策略**直接拒绝、不再弹审批** → 飞行中 `session/cancel` 回 `cancelled` → 关闭后拒绝服务 → stdout 无协议外输出。与单测分工：单测走内存传输（验逻辑），E2E 走真实进程（验帧与语义一起成立）。另新增真机联调入口 `examples/acp-agent.ts`（`npm run demo:acp`，有 `OPENAI_API_KEY` 接真实模型、否则退 `MockProvider`）。**GUI 客户端（Zed / DeepChat）联调仍待人工** —— 不在 CI 内，可自动验证的部分已全部覆盖。
- **M8-2 补测（真实传输链路）**：新增 `packages/acp/test/stdio.test.ts` 与子进程固件，用**真实 stdio 子进程**（而非内存传输）验证握手、半帧写入重组、stdout 纯净性 —— 补上 M8-2 唯一未验证的传输链路。

### Changed

- 底座收敛：`mock` / `tools-basic` 两个示例外置包改为 `private`（不再发布到 npm scope）；历史 M5/M6/M7 执行与评审文档统一归档至 `docs/historical/`；根 CHANGELOG 精简为版本摘要。
- **CI 触发分支收敛为 `main`**：`.github/workflows/ci.yml` 的 `push` / `pull_request` 由 `[main, dev, apps]` 收敛为仅 `main`（`apps` 分支已不存在，一并清理）。日常开发在 `dev` 完成、不触发远端门禁，`dev → main` 的 PR 或 push `main` 时才跑完整质量门；`CONTRIBUTING.md` 同步更新分支与本地收口口径。

### Docs

- README / CONTRIBUTING 同步标注 `mock` / `tools-basic` 为 **internal/demo**：两包已转 `private`、不再发布，「已发布包」口径由 12 个收敛为 10 个；README 四处（项目定位、安装示例、项目结构树、代码示例提示）与 CONTRIBUTING 包表同步，避免外部消费者照抄 import 失败。
- **M7 状态收口 + M8 立项（草案，未开工）**：`architecture.md` §11 的 M7 行由 🟡 转 **✅ 已关闭**（M7-1 / M7-2 全量 / M7-3 / M7-6a / M7-6b / M7-5 底座部分均于 09-15 交付、「无待做项」），新增 M8 行与 §13 v1.19 修订记录；`development-checklist.md` 勾除候选池中已由 M7-5 交付的 `compileAgent()`，并新增 §3.4 **M8 执行草案**（前置核对 / 三批 / 延后 / 随手 / 不做）。
- **两项拍板按推荐值落定（2026-09-17）**：① **目标客户优先级 = 先 (a) 开发者个体建生态、同步铺 (c) 企业合规交付物**（`product-direction.md` §8-1，落地为 M8-1 生态入口与 M8-5 K8s/Helm）；② **形态路径 = 先走 ACP 路径 D（协议适配包），不自建壳**（`product-build-paths.md` §9 五项结论表：走 D / `tools-code` 延后至 P2 / 流式视 token 级分块核对结果决定是否前置 / `tools-code` 按通用编码工具包 / 以「治理」为主叙事）。同时消解 `product-direction.md` §6 许可策略「待决」与 §8-2「已定 open-core」的口径冲突。**M8 本条未动任何代码**。
- **ACP v1 规范级核对完成（M8 前置项解除）**：新增 `docs/acp-spec-review.md`。结论 —— ① 传输 = **stdio**（换行分隔 JSON-RPC，stdout 只写 ACP 消息、日志走 stderr，与本项目既有纪律一致），Streamable HTTP 仍在草案；② **`session/update` 不要求 token 级分块**（全篇 MAY，唯一 MUST 是 turn 结束须回 `stopReason`）→ **流式非前置，不阻塞 ACP 包**；③ 方法名一律**斜杠**，据此修正 `product-build-paths.md` §8 与 `development-checklist.md` §3.4 的 `session.new` 点号笔误；④ **`session/set_mode` 官方明示将被 Session Config Options 取代**，M8-3 桥接须同时提供以免返工；⑤ `usage_update` 的 `used` / `size` / `cost` 可由 M7-1 的 token 计量直接填。核对前 M8 内部排序悬而未决，现已锁定：**M8-2 / M8-3 首批可开工，M8-4 流式维持第二批**。
- **M8-2 落地（ACP v1 适配包）**：新增第 13 个包 `packages/acp`（`@node-agent-runtime/acp`），把底座暴露为 ACP v1 agent（stdio 传输）。实现 `initialize` / `session/new` / `session/prompt` / `session/cancel`，另含 `session/load`（回放持久化 transcript）与 `session/close`；`session/update` 覆盖消息块、`tool_call`→`tool_call_update`（pending→completed/failed）与 `usage_update`（used/size/cost），`stopReason` 含 `end_turn` / `max_turn_requests` / `cancelled`。四条架构决策：① 每会话独立 runtime + EventBus（runtime 总线是进程级的，共享会让并发轮次串台）；② 取消不是错误路径 —— `RunAbortedError` 与 provider SDK 抛的 `AbortError` 都捕获并回 `cancelled`（规范点名要求，否则客户端把取消渲染成失败）；③ tool title 只附加路径类参数，避免把模型写入的敏感参数值渲染到客户端 UI；④ M8-2 阶段以 `NoAskPolicy` 把 `ask` 降级为 `deny`，避免无审批通道时 pending decision 空等 60s，M8-3 用 `session/request_permission` 真桥接替换（`AcpConnection.request()` 已就绪）。19 例测试通过；**待真机联调**（DeepChat / Zed）。新增 `docs/m8-acp-adapter.md` 执行清单，回填 `docs/development-checklist.md` §3.4 与 `docs/architecture.md` §11。

## [0.4.2] - 2026-09-17

### Added

- 12 个 `@node-agent-runtime/*` 包全部以 `0.4.2` 上架 npm
- **OIDC Trusted Publishing**：免 `NPM_TOKEN` 发布，全部包带 provenance 签名
- 社区治理文件：ISSUE 模板（bug / feature / security）、PR 模板、`SECURITY.md`、`.github/dependabot.yml`（npm + github-actions 每周扫描）
- `main` 分支保护规则纳入 CI status checks（`ci.yml` 四个 gate）

### Removed

- `examples/desktop-tauri` 桌面壳（含 Tauri updater 签名）整体移出仓库，方向归产品侧；相关 CI 工作流与脚本一并移除

## [0.4.1] - 2026-09-16

**Fixed：补齐 workspace 内部依赖声明（首个真正可用的发布版）**

- **背景**：0.4.0 已于 2026-09-16 首次发布到 npm（12 包、带 provenance），但**构建产物实际 `import` 的 workspace 内部包并未写入 `package.json` 的 `dependencies`**。本地 monorepo 依靠符号链接让各包互相可见，该问题被完全掩盖；一旦发布，`npm install` 不会安装这些未声明的包，`import` 直接抛 `ERR_MODULE_NOT_FOUND`
- **典型症状**：`Cannot find package '@node-agent-runtime/artifact' imported from .../node_modules/@node-agent-runtime/core/dist/index.js`
- **修复范围（10 个包）**：`core`（+`artifact`、`sandbox`）、`host`（+`types`、`core`、`artifact`）、`mcp`（+`core`、`types`）、`tools-basic`（+`core`、`types`）、`provider-openai`（+`core`）、`artifact` / `memory` / `mock` / `policy` / `sandbox`（+`types`）。依赖方向为 `host → core → {types, memory, artifact, sandbox, policy}`，**无循环依赖**
- **修正一处误判**：`core` 源码注释中出现的 `@node-agent-runtime/host` / `mcp` / `mock` 等均为**说明性注释**（"已外置为 C8"），并非真实 import。首轮扫描未剔除注释，曾误报为循环依赖
- **验证**：补齐后 12 包依赖声明完整；0.4.1 经 `release.yml` 由 CI 发布（带 provenance）

**Changed：仓库可见性改为 Public**

- 仓库原为私有（Free 账户私有仓库 Actions 仅 2000 分钟/月），配额于 2026-09-08 耗尽后 **55 次连续失败、job 分配不到 runner（`steps` 数为 0）**。2026-09-15 改为 Public 后 Actions 免费无限，CI 四个 job 全部转绿
- 附带收益：npm provenance 此前对私有仓库无实际验证价值，改公开后证明可被验证

## [0.4.0] - 2026-09-16

### Added

- 首批发布到 npm（12 包、带 provenance）

### Deprecated

- 因缺 workspace 内部依赖声明，`npm install` 后包不可解析；已 `deprecate`，以 `0.4.1` 作为 `latest`

## [v0.2.0] - 2026-09-05

**M1 · 生命周期 + C1/C2 workspace 收敛**（正式发布，dev 合并 main，commit `06edd1a`）：M1 完成 Session/Task/Run 实体化、统一持久化层与运行时上下文注入；在此基础上把代码收敛为 npm workspaces monorepo（C1 `@node-agent-runtime/types` 叶子包 + C2 `@node-agent-runtime/core` 引擎包）。`npm test` 35 通过 0 失败。

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
- **C1/C2 收敛为 npm workspaces monorepo**（v0.2-with-workspaces，2026-09-05）：根包改 workspace 容器（`workspaces: ["packages/*"]`），按 `docs/crate-architecture.md` §7.1 方案 A 拆分——契约层（`schema/types/util`）入 C1 叶子包 `@node-agent-runtime/types`（零依赖），引擎实现（runtime/agent/context/events/session/tool/provider/tools/providers/store）入 C2 `@node-agent-runtime/core`（显式依赖 C1）；`packages/core/src/index.ts` 顶部 `export * from "@node-agent-runtime/types"` 保持公共 API 兼容；`examples` 与各包测试改为从包名导入；测试随包迁移（schema→types/test，runtime/session/store/calculator→core/test）；删除旧根 `test/`、`src/`、`tsconfig.examples.json`；`npm run typecheck` / `npm run build` / `npm test`（types 4 + core 31，1 有意 skip）全绿

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
