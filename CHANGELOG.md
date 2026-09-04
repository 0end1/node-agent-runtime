# Changelog

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

本文件记录 **Agent Runtime（nodeRuntimes）** 的重要变更。

> **维护约定**：每次代码提交（commit）时，请同步在 [Unreleased] 或对应版本段落追加条目，并将 CHANGELOG 更新与代码放入**同一个 commit**。分类参考 Conventional Commits：`Added` 新增 / `Changed` 变更 / `Fixed` 修复 / `Docs` 文档 / `Security` 安全。

## [Unreleased]

### Docs

- 在 README / `docs/architecture.md` / CHANGELOG.md 中统一标注文档作者信息：wangzhiyong · GitHub：0end1 · 联系邮箱：y1378379002@gmail.com

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
