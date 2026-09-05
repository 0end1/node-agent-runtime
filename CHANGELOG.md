# Changelog

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

本文件记录 **Agent Runtime（nodeRuntimes）** 的重要变更。

> **维护约定**：每次代码提交（commit）时，请同步在 [Unreleased] 或对应版本段落追加条目，并将 CHANGELOG 更新与代码放入**同一个 commit**。分类参考 Conventional Commits：`Added` 新增 / `Changed` 变更 / `Fixed` 修复 / `Docs` 文档 / `Security` 安全。

## [Unreleased]

（自 v0.2.0 起的新变更将记录于此；下一步见 `docs/architecture.md` §11 路线图 —— 计划 M2 · 恢复与记忆，或先回 `main` 发布 v0.2.0。）

### Docs

- `docs/architecture.md` §6/§7/§11 修订（v1.2，2026-09-05）：**Sandbox 由工具装饰器升格为运行层执行域边界**——引入 `SandboxMode` 三档（read-only / workspace-write / full-access，对齐 Codex）与 `SandboxScope`（workspace 可写域、网络默认禁网、环境变量精简），文件/命令访问先过 `gate()`、越界 deny，写操作发布 `sandbox:write`（含 diff）事件；`PermissionContext` 携带 sandbox 边界；Run 循环增加 `sandbox.begin()`；路线图 M3 验收更新
- 新增 `docs/codex-reference.md`（2026-09-05）：**Codex-rs 可借鉴实现清单**——按 nodeRuntimes 里程碑（M3 沙箱/审批、M2 持久化、M4 MCP、模型切换层、多 Agent 前瞻）映射 `codex-rs` 各 crate 的机制与关键源码落点；仅作独立参考，不并入 architecture.md
- 新增 `docs/crate-architecture.md`（v0.1，2026-09-05）：**crate 化边界与依赖图草案**——按 codex-rs workspace 形态把 `architecture.md` §2 模块树重排为 types 底座 + 单颗零依赖 core + 外置接缝包（memory/sandbox/policy/mcp/provider/store-sqlite）+ host + apps（C1~C9+A1 映射表、依赖图、边界规则、npm workspaces 与 Rust workspace 形态对比与待决清单）；纯设计研究，不改代码

## [v0.2.0] - 2026-09-04

M1 · 生命周期：完成 Session/Task/Run 实体化、统一持久化层与运行时上下文注入。dev 分支开发完成（commit `1df585b`），`npm test` 35 通过 0 失败。

### Added（M1 · 生命周期）

- **Storage 抽象** `src/store/`：统一持久化门面（文档域 `saveDoc/loadDoc/listDocs/deleteDoc`、Blob 域、追加式流域），内置 `MemoryStorage`（核心，零依赖）与 Node 版 `FileStorage`（按 domain 落目录，JSON/NDJSON 行式，写入走临时文件 + rename 原子化）
- **Session / Task / Run 实体化** `src/session.ts`：`SessionManager` 管理会话生命周期（create/list/close/delete，支持外部指定 id、首轮自动标题），`Task` 状态机 created→running→done/failed/cancelled，Run 落库为 `RunRecord` 实体
- **会话级持久化消息流**：每次对话自动把新产生的消息追加到 storage，`history` 不再由调用方手动维护；进程重启后基于同一 storage 恢复会话即可携带完整上下文继续
- **Context 门面** `src/context.ts`：`buildRunContext` 注入运行上下文（conversation/run/session/task + now），runtime 主循环与工具执行统一使用
- **事件契约扩展**：`session:created/updated/closed`、`task:created/status` 并入统一总线（新增事件均为追加，既有 run 级事件不变）
- **examples 演进**：CLI（会话持久化到 `.runtime-data/`，新增 `/new` `/list` `/use <id>`，重启自动续最近会话）；Web 控制台（RUNTIME_DATA 目录持久化，浏览器 localStorage 固定会话跨刷新/跨服务重启恢复）
- **测试**：新增 `store`（Storage 契约双实现 13+1 例）与 `session`（生命周期 / 重启恢复 / 并发锁 / 事件序）用例；全量 `npm test` 35 通过

### Changed

- 运行时版本升至 `v0.2.0`

### Docs

- 在 README / `docs/architecture.md` / CHANGELOG.md 中统一标注文档作者信息：wangzhiyong · GitHub：0end1 · 联系邮箱：y1378379002@gmail.com
- README：新增 `SessionManager` / `Storage` 概念、会话管理示例（M1）、事件表补充 session/task 事件、项目结构与提示更新
- `docs/architecture.md`：模块表"现状"列、路线图 M1 行标记为 ✅ 已完成；修订记录新增 v1.1 (M1)

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
