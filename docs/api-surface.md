# 公共 API 冻结快照（M6 · P1.6 + 审查整改）

> 记录时间：2026-09-08（split 分支；P1 审查整改 P0/P1/P2 后重新冻结）
> 定位：M6 **P1 的 Gate 1 退出项** —— 冻结各 workspace 包的对外导出面，作为后续兼容性评审基线。
> 提取方式：TypeScript 编译器解析各包 `dist/index.d.ts`（`npm run build` 后）与 `packages/types/dist/*.d.ts`，符号按字母序排列。
> 修订轨迹：2026-09-08 依 `docs/p1-review.md` 完成整改（core 1804 → **1005 行**；演示资产外置、artifact 独立、工具分类下沉 C1、checkpoint 归位 C3、事件总线可注入）；2026-09-08 **M6-11 快照复核脚本化**（`scripts/check-api-surface.ts` + 基线 `scripts/api-surface.baseline.json`，见 §13）。

## 0. 总览

| 包 | 版本 | 导出符号数 | 角色 |
|---|---|---|---|
| `@node-agent-runtime/types` | 0.2.0 | 8 个子模块聚合（展开见 §1） | C1 契约叶子包（零依赖） |
| `@node-agent-runtime/memory` | 0.2.0 | 19 | C3 会话记忆 + Checkpoint（步级快照/续跑校验）+ M7-1 上下文压缩纯函数 |
| `@node-agent-runtime/artifact` | 0.2.0 | 8 | 产物管理 |
| `@node-agent-runtime/sandbox` | 0.2.0 | 14 | C4 执行域 |
| `@node-agent-runtime/policy` | 0.2.0 | 28 | C5 授权决策 + M7-3 声明式策略契约/编译/测试/预设 |
| `@node-agent-runtime/core` | 0.2.0 | 60（+ 5 个 `export *` 转发） | C2 引擎（**1005 行**）+ facade |
| `@node-agent-runtime/tools-basic` | 0.2.0 | 4 | 内置基础工具集（演示友好，非引擎必需） |
| `@node-agent-runtime/mock` | 0.2.0 | 1 | MockProvider（演示/测试桩） |
| `@node-agent-runtime/host` | 0.2.0 | 10 | C8 会话/任务生命周期 |
| `@node-agent-runtime/mcp` | 0.2.0 | 29 | C6 MCP 适配 |
| `@node-agent-runtime/provider-openai` | 0.2.0 | 2 | C7 模型后端 |
| `@node-agent-runtime/store-sqlite` | 0.2.0 | 3 | C9 存储后端 |

**依赖方向（单向无环）**：

```
types ← {memory, artifact, sandbox, policy} ← core ← {tools-basic, mock, host, mcp, provider-openai, store-sqlite}
```

> `core` 以 facade 方式 `export *` 转发 types / memory / artifact / sandbox / policy；**host 与 mcp 不被 core 反向 re-export**（二者依赖 core，反向会成环），宿主须直接从对应包导入。
> `tools-basic` / `mock` 为**演示资产**（依赖 core，不被 core 依赖），已移出 core 以收窄引擎与公共面。

---

## 1. `@node-agent-runtime/types`（C1 · 契约，零依赖）

| 子模块 | 导出 |
|---|---|
| `artifacts` | `Artifact`、`ArtifactInput`、`ArtifactKind` |
| `events` | `RuntimeEvent` + `RunStartEvent`、`UserMessageEvent`、`StepStartEvent`、`ModelResponseEvent`、`ToolStartEvent`、`ToolEndEvent`、`RunEndEvent`、`RunErrorEvent`、`SessionCreatedEvent`、`SessionUpdatedEvent`、`SessionClosedEvent`、`TaskCreatedEvent`、`TaskStatusEvent`、`CheckpointSavedEvent`、`CheckpointRestoredEvent`、`PermissionRequestEvent`、`PermissionApprovedEvent`、`PermissionDeniedEvent`、`SandboxWriteEvent`、`EventEmitter` |
| `schema` | `JsonSchema`、`JsonSchemaType`、`validate` |
| `codes` | `ErrorCode`、`ErrorInfo`、`errorInfo` |
| `storage` | `Storage`、`DocDomain`、`StreamDomain` |
| `tools` | `ToolDefinition`、`AnyTool`、`ToolExecutionContext`、`ToolKind`、`ToolMeta`、`classifyToolName`、`toolKind` |
| `types` | `ChatMessage`、`UserMessage`、`AssistantMessage`、`SystemMessage`、`ToolCall`、`ToolResultMessage`、`RunUsage` |
| `util` | `newId`、`stringifyResult`、`fmtNumber`、`fingerprint`、`ProcessEnv` |

> `fingerprint`（P3.3 审批审计指纹）与 `ProcessEnv`（P4.5 让发布产物不依赖 `@types/node`）于 2026-09-08 加入本包。

> `classifyToolName` / `toolKind` 于 2026-09-08 由 sandbox 下沉至此（工具元数据推断，非执行域职责）；sandbox 仍 re-export 二者以保持其 API 不变。

> **防腐红线（2026-09-08 审查整改明确）**：本包只允许两类内容——**契约声明**（消息/工具/事件/Storage/Artifact 类型与接口）与 **零 IO 纯函数**（`validate` / `newId` / `stringifyResult` / `fmtNumber` / `classifyToolName` / `toolKind`）。**禁止**：任何 IO（HTTP/文件/进程/SQLite）、有状态运行逻辑、引入本仓库其他运行时代码（TS type-only 除外）。超此范畴的能力须下沉实现包（`memory`/`artifact`/`sandbox`/`policy`/`core`…），不得塞入 C1——依据 `docs/crate-architecture.md` §5 边界规则 2/4/6 与 C1 行职责；包描述已含对应表述（`packages/types/package.json`："zero-IO pure helpers. No internal dependencies."）。

## 2. `@node-agent-runtime/core`（C2 · 引擎 + facade，1005 行）

**引擎与运行时**：`AgentRuntime`、`AgentRuntimeOptions`、`RunAbortedError`、`RunOptions`、`RunResult`、`StepSnapshot`、`EventBus`
**Agent**：`Agent`、`AgentOptions`、`defineAgent`、`DEFAULT_AGENT_INSTRUCTIONS`
**Context**：`buildRunContext`、`RunContext`、`RunContextSeed`
**Storage 实现**：`MemoryStorage`、`FileStorage`
**工具契约**：`defineTool`、`findDuplicateToolNames`、`ToolDefinition`、`AnyTool`、`ToolExecutionContext`、`ToolKind`、`ToolMeta`
**模型**：`ModelProvider`、`ModelRequest`、`ModelResponse`、`RawToolCall`、`FinishReason`、`ModelRequestError`
**P3.1 日志 / P3.8 配置**：`Logger`、`LogLevel`、`LogContext`、`ConsoleLogger`、`toLogger`、`errorPayload`、`redact`、`loadConfig`、`ConfigError`、`RuntimeConfig`、`FeatureFlags`、`LoadConfigOptions`
**事件类型（转发自 C1）**：`RuntimeEvent` 及 §1 `events` 全部事件接口

> **M7-2（2026-09-11，additive/minor）**：19 个事件接口统一增可选 `traceId?`（由 `emit()` 与 `redact()` 同点注入）；`run:start` 增 `startedAt`、`run:end` 增 `endedAt`（epoch ms）；`RunOptions` 增可选 `traceId?`，`RunResult` 增 `traceId`；`Logger` 增可选 `child?(ctx: LogContext): Logger`（`ConsoleLogger` 已实现，未绑定上下文时输出格式逐字不变）。`LogContext` 为本次新增导出。
**facade 转发**：`export *` → `@node-agent-runtime/types`、`@node-agent-runtime/memory`（含 Checkpoint）、`@node-agent-runtime/artifact`、`@node-agent-runtime/sandbox`、`@node-agent-runtime/policy`

> **事件总线可注入（2026-09-08）**：`AgentRuntimeOptions.events?: EventBus<RuntimeEvent>` —— 宿主可创建并注入总线（默认仍自建）。配合 `SessionManagerOptions.events`，host 不再需要借用 `runtime.events` 内部构件。
> 已移出：`SessionManager` / `SessionError` / Session·Task 类型 → `host`；MCP 全部 → `mcp`；`MockProvider` → `mock`；`builtinTools` / `evaluate` / `CURRENCY_ALIASES` / `CurrencyCode` → `tools-basic`；Checkpoint 全部 → `memory`（经 facade 转发，从 core 导入仍可用）。

## 3. `@node-agent-runtime/memory`（C3 · 记忆 + Checkpoint）

**会话记忆**：`SessionMemory`、`Memory`、`MemoryFact`、`MemoryRecall`、`SessionMemoryOptions`
**Checkpoint（M2）**：`CheckpointStore`、`CheckpointStoreOptions`、`CheckpointMismatchError`、`computeToolsHash`、`assertResumable`、`Checkpoint`、`CheckpointSeed`、`AgentSnapshot`、`ToolSurface`

> `ToolSurface`（`{ name, tools }` 结构化契约）取代原先对 `Agent` 类的依赖，使本包仅依赖 types。

## 4. `@node-agent-runtime/artifact`

`ArtifactManager`、`ArtifactManagerOptions`、`ArtifactError`、`MIME_BY_KIND`、`blobKeyOf`、`Artifact`、`ArtifactKind`、`ArtifactInput`（后三者 re-export 自 C1）

## 5. `@node-agent-runtime/sandbox`（C4）

`LocalSandbox`、`LocalSandboxOptions`、`Sandbox`、`SandboxHandle`、`SandboxMode`、`SandboxScope`、`SandboxRunContext`、`SandboxWriteInfo`、`SandboxViolationError`、`SandboxTimeoutError`、`isPathAllowed`、`simpleDiff`、`classifyToolName`、`toolKind`（后二者 re-export 自 C1）

## 6. `@node-agent-runtime/policy`（C5）

`PermissionManager`、`PermissionManagerOptions`、`PermissionPolicy`、`DefaultPermissionPolicy`、`DefaultPermissionPolicyOptions`、`StaticPolicy`、`combinePolicies`、`toolListPolicy`、`Verdict`、`Decision`、`DecisionMatrix`、`PermissionContext`、`PermissionCall`、`GateResult`、`PendingDecision`、`createProductionPolicy`、`secureScope`、`createProductionDefaults`、`PRODUCTION_MATRIX`

## 7. `@node-agent-runtime/tools-basic`（演示资产）

`builtinTools`、`CURRENCY_ALIASES`、`CurrencyCode`、`evaluate`

## 8. `@node-agent-runtime/mock`（演示资产）

`MockProvider`

## 9. `@node-agent-runtime/host`（C8）

`SessionManager`、`SessionManagerOptions`、`SessionError`、`Session`、`SessionStatus`、`Task`、`TaskStatus`、`RunRecord`、`RunStatus`、`ChatOutcome`

> `SessionManager.events` 为公开只读字段（宿主注入或复用 runtime 总线）。

## 10. `@node-agent-runtime/mcp`（C6）

`McpClient`、`McpClientOptions`、`McpRegistry`、`McpRegistryOptions`、`RegisteredServer`、`StdioTransport`、`StdioTransportOptions`、`StreamableHttpTransport`、`StreamableHttpTransportOptions`、`McpTransport`、`McpError`、`McpTimeoutError`、`McpConnectionError`、`MCP_PROTOCOL_VERSION`、`MCP_TOOL_PREFIX`、`mcpToolName`、`parseMcpToolName`、`normalizeSchema`、`pathArgKeysOf`、`parseSse`、`validateMcpServerUrl`、`McpServerHandle`、`McpToolMeta`、`McpToolRef`、`McpCallToolResult`、`McpServerInfo`、`McpServerCapabilities`、`McpInitializeResult`、`McpTextContent`

## 11. `@node-agent-runtime/provider-openai`（C7）

`OpenAIClientProvider`、`OpenAIClientOptions`

## 12. `@node-agent-runtime/store-sqlite`（C9）

`SQLiteStorage`、`SQLiteStorageOptions`、`SCHEMA_VERSION`

> `SCHEMA_VERSION`（P5.5）随 schema 版本化一起导出：数据库版本存于 `PRAGMA user_version`，启动时自动应用缺失迁移（幂等可重复），并新增 session/task/run 与审计排序的表达式索引。

---

## 13. 变更规则（冻结后生效）

| 变更类型 | 判定 | 处理 |
|---|---|---|
| **新增**导出（新符号 / 新可选字段） | 兼容 | 追加本表 + CHANGELOG（`Added`），minor |
| **删除 / 重命名**导出 | **破坏性** | break-change 评审；1.0 前 minor 并显著提示，1.0 后 major |
| **收窄**参数/返回值类型、必填化可选字段、改默认值 | **破坏性** | 同上 |
| 仅内部实现变更（导出面不变） | 兼容 | 常规 patch/minor |

**评审流程**：提出变更 → 在 PR 中标注 `BREAKING` 并说明影响面与迁移方式 → 更新本表对应行 + `CHANGELOG.md` → 合并。

**快照复核（已脚本化，M6-11）**：每次发布前运行 `npm run check:api`（先 `npm run build`）——由 `scripts/check-api-surface.ts` 按上文口径重新提取各包 `dist/index.d.ts` 导出面，与基线 `scripts/api-surface.baseline.json` 比对，**差异即待评审项**（新增符号→追加本表 + CHANGELOG（`Added`）；删除/重命名→BREAKING 评审）。评审通过后运行 `npm run check:api:update` 重新冻结基线，并随本表一并提交。基线于 2026-09-08 冻结，与本表逐包符号全集核对一致；CI 作业 `api-surface`（P2.7）复用同一脚本，随 P2 总闸（`npm run ci`）接入。
