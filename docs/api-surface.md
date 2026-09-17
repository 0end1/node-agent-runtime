# 公共 API 冻结快照（M6 · P1.6 + 审查整改）

> 记录时间：2026-09-08（split 分支；P1 审查整改 P0/P1/P2 后重新冻结）
> 定位：M6 **P1 的 Gate 1 退出项** —— 冻结各 workspace 包的对外导出面，作为后续兼容性评审基线。
> 提取方式：TypeScript 编译器解析各包 `dist/index.d.ts`（`npm run build` 后）与 `packages/types/dist/*.d.ts`，符号按字母序排列。
> 修订轨迹：2026-09-08 依 `docs/historical/p1-review.md` 完成整改（core 1804 → **1005 行**；演示资产外置、artifact 独立、工具分类下沉 C1、checkpoint 归位 C3、事件总线可注入）；2026-09-08 **M6-11 快照复核脚本化**（`scripts/check-api-surface.ts` + 基线 `scripts/api-surface.baseline.json`，见 §13）。

## 0. 总览

| 包 | 版本 | 导出符号数 | 角色 |
|---|---|---|---|
| `@node-agent-runtime/types` | 0.2.0 | 8 个子模块聚合（展开见 §1） | C1 契约叶子包（零依赖） |
| `@node-agent-runtime/memory` | 0.2.0 | 21 | C3 会话记忆 + Checkpoint（步级快照/续跑校验）+ M7-1 上下文压缩纯函数 + M7-5 配方指令指纹 |
| `@node-agent-runtime/artifact` | 0.2.0 | 8 | 产物管理 |
| `@node-agent-runtime/sandbox` | 0.2.0 | 14 | C4 执行域 |
| `@node-agent-runtime/policy` | 0.2.0 | 28 | C5 授权决策 + M7-3 声明式策略契约/编译/测试/预设 |
| `@node-agent-runtime/core` | 0.2.0 | 78（+ 5 个 `export *` 转发） | C2 引擎（`runtime.ts` **689 行**）+ facade + M7-5 配方编译 |
| `@node-agent-runtime/tools-basic` | 0.2.0 | 4 | 内置基础工具集（演示友好，非引擎必需） |
| `@node-agent-runtime/mock` | 0.2.0 | 1 | MockProvider（演示/测试桩） |
| `@node-agent-runtime/host` | 0.2.0 | 14 | C8 会话/任务生命周期 + 审批审计导出 |
| `@node-agent-runtime/mcp` | 0.2.0 | 40 | C6 MCP 适配 + M7-6b 只读资源 |
| `@node-agent-runtime/provider-openai` | 0.2.0 | 2 | C7 模型后端 |
| `@node-agent-runtime/store-sqlite` | 0.2.0 | 3 | C9 存储后端 |
| `@node-agent-runtime/acp` | 0.4.2 | 78 | C10 ACP agent（stdio 传输 + 权限桥接 + 执行模式，M8-2/M8-3） |

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

> **防腐红线（2026-09-08 审查整改明确）**：本包只允许两类内容——**契约声明**（消息/工具/事件/Storage/Artifact 类型与接口）与 **零 IO 纯函数**（`validate` / `newId` / `stringifyResult` / `fmtNumber` / `classifyToolName` / `toolKind`）。**禁止**：任何 IO（HTTP/文件/进程/SQLite）、有状态运行逻辑、引入本仓库其他运行时代码（TS type-only 除外）。超此范畴的能力须下沉实现包（`memory`/`artifact`/`sandbox`/`policy`/`core`…），不得塞入 C1——依据 `docs/historical/crate-architecture.md` §5 边界规则 2/4/6 与 C1 行职责；包描述已含对应表述（`packages/types/package.json`："zero-IO pure helpers. No internal dependencies."）。

## 2. `@node-agent-runtime/core`（C2 · 引擎 + facade，`runtime.ts` 689 行）

**引擎与运行时**：`AgentRuntime`、`AgentRuntimeOptions`、`RunAbortedError`、`RunOptions`、`RunResult`、`StepSnapshot`、`EventBus`
**Agent**：`Agent`、`AgentOptions`、`defineAgent`、`DEFAULT_AGENT_INSTRUCTIONS`
**Context**：`buildRunContext`、`RunContext`、`RunContextSeed`
**Storage 实现**：`MemoryStorage`、`FileStorage`
**工具契约**：`defineTool`、`findDuplicateToolNames`、`ToolDefinition`、`AnyTool`、`ToolExecutionContext`、`ToolKind`、`ToolMeta`
**模型**：`ModelProvider`、`ModelRequest`、`ModelResponse`、`RawToolCall`、`FinishReason`、`ModelRequestError`
**P3.1 日志 / P3.8 配置**：`Logger`、`LogLevel`、`LogContext`、`ConsoleLogger`、`toLogger`、`errorPayload`、`redact`、`loadConfig`、`ConfigError`、`RuntimeConfig`、`FeatureFlags`、`LoadConfigOptions`
**事件类型（转发自 C1）**：`RuntimeEvent` 及 §1 `events` 全部事件接口
**M7-2 OTEL 导出**：`toOtelSpans`、`OtelSpan`、`OtelSpanKind`、`OtelContext`
**M7-5 配方编译**：`compileAgent`、`agentSnapshotOf`、`AgentCompileError`、`CompiledAgent`、`AgentDiagnostic`、`AgentDiagnosticCode`、`CompileAgentOptions`、`McpToolRefLike`

> **M7-2（2026-09-11，additive/minor）**：19 个事件接口统一增可选 `traceId?`（由 `emit()` 与 `redact()` 同点注入）；`run:start` 增 `startedAt`、`run:end` 增 `endedAt`（epoch ms）；`RunOptions` 增可选 `traceId?`，`RunResult` 增 `traceId`；`Logger` 增可选 `child?(ctx: LogContext): Logger`（`ConsoleLogger` 已实现，未绑定上下文时输出格式逐字不变）。`LogContext` 为本次新增导出。

> **M7-2 收尾（2026-09-15，additive/minor）**：事件接口 `StepStartEvent` / `ToolStartEvent` / `ToolEndEvent` 增可选 `at?`（epoch ms，由 runtime 在发射点补齐），供 span 推导起止时间；新增 `toOtelSpans`（纯函数：确定性 id、`run→step→tool` 父子关系、`startTimeUnixNano` / `endTimeUnixNano` 单调递增）及类型 `OtelSpan`、`OtelSpanKind`、`OtelContext`。仅产出 span **数据形状**，不绑定任何 OTLP 传输/SDK、不引入运行时依赖。
> **M7-5 Agent 配方编译（2026-09-15，additive/minor）**：新增 `compileAgent(input, options?)` —— 把「工具重名 / 参数 schema 非法 / MCP 引用不可达」三类缺陷从「跑起来才发现（或永远发现不了，只表现为模型一直调错）」提前到**编译期一次性报错**（`AgentCompileError.issues` 给出全部问题，非 fail-fast）；产物 `CompiledAgent` 含 `toolsHash` 与 `instructionsHash`，**确定性**故可缓存。`AgentOptions` / `Agent` 增可选 `mcpTools?`（结构化 `{ server, tool }`，与 `McpRegistry.resolve()` 同形，避免 core → mcp 反向依赖成环），经注入的 `resolveMcp` 解析后与本地工具**同一命名空间**参与重名检测；`agentSnapshotOf(compiled)` 产出可直接写入 checkpoint 的 `AgentSnapshot`。**编译通过不代表授权** —— 工具仍须逐次过 M3 审批与沙箱。

**facade 转发**：`export *` → `@node-agent-runtime/types`、`@node-agent-runtime/memory`（含 Checkpoint）、`@node-agent-runtime/artifact`、`@node-agent-runtime/sandbox`、`@node-agent-runtime/policy`

> **事件总线可注入（2026-09-08）**：`AgentRuntimeOptions.events?: EventBus<RuntimeEvent>` —— 宿主可创建并注入总线（默认仍自建）。配合 `SessionManagerOptions.events`，host 不再需要借用 `runtime.events` 内部构件。
> 已移出：`SessionManager` / `SessionError` / Session·Task 类型 → `host`；MCP 全部 → `mcp`；`MockProvider` → `mock`；`builtinTools` / `evaluate` / `CURRENCY_ALIASES` / `CurrencyCode` → `tools-basic`；Checkpoint 全部 → `memory`（经 facade 转发，从 core 导入仍可用）。

## 3. `@node-agent-runtime/memory`（C3 · 记忆 + Checkpoint）

**会话记忆**：`SessionMemory`、`Memory`、`MemoryFact`、`MemoryRecall`、`SessionMemoryOptions`
**Checkpoint（M2）**：`CheckpointStore`、`CheckpointStoreOptions`、`CheckpointMismatchError`、`computeToolsHash`、`computeInstructionsHash`、`assertResumable`、`AssertResumableOptions`、`Checkpoint`、`CheckpointSeed`、`AgentSnapshot`、`ToolSurface`

> `ToolSurface`（`{ name, tools }` 结构化契约）取代原先对 `Agent` 类的依赖，使本包仅依赖 types。

> **M7-5 配方快照（2026-09-15，additive/minor）**：`AgentSnapshot` 增**可选** `instructionsHash?`（旧快照无此字段照常工作）；新增纯函数 `computeInstructionsHash({ instructions })`（与 `computeToolsHash` 同一 FNV-1a 实现）；`assertResumable(checkpoint, agent, options?)` 增第三参 `AssertResumableOptions{ allowInstructionChange? }` —— 工具集与 `agentId` 仍为**硬校验**，`instructionsHash` 为**软校验**（仅当快照与当前配方双方都有该字段时才比对）。`agent` 形参类型放宽为 `ToolSurface & { instructions?: string }`，既有调用点零改动。

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

**P3.3 审批审计 + 授权持久化**：`StorageApprovalStore`

> **M7-2 审计导出（2026-09-15，additive/minor）**：`serializeAudit`（`ApprovalRecord[]` → CSV/JSON）、`exportAudit`（按 `ApprovalQuery` 从 `ApprovalStore` 拉取后序列化）、`AuditFormat`。固定列序仅含 `argumentsFingerprint`（不含工具参数原文），每条记录先过 `redact` 再落盘——导出物不得成为密钥的第二份副本（P3.2/P3.3 红线）。

## 10. `@node-agent-runtime/mcp`（C6）

`McpClient`、`McpClientOptions`、`McpRegistry`、`McpRegistryOptions`、`RegisteredServer`、`StdioTransport`、`StdioTransportOptions`、`StreamableHttpTransport`、`StreamableHttpTransportOptions`、`McpTransport`、`McpError`、`McpTimeoutError`、`McpConnectionError`、`MCP_PROTOCOL_VERSION`、`MCP_TOOL_PREFIX`、`mcpToolName`、`parseMcpToolName`、`normalizeSchema`、`pathArgKeysOf`、`parseSse`、`validateMcpServerUrl`、`McpServerHandle`、`McpToolMeta`、`McpToolRef`、`McpCallToolResult`、`McpServerInfo`、`McpServerCapabilities`、`McpInitializeResult`、`McpTextContent`

> **M7-6b 只读资源（2026-09-15，additive/minor）**：类型 `McpResourceMeta`、`McpResourceContent`、`McpReadResourceResult`、`RegistryResource`、`McpResourceRead`；`McpClient.listResources()` / `readResource(uri)` / `resourcesSupported`（`McpServerHandle` 上同名为**可选**方法，既有实现不受影响）；`McpRegistry.listResources()` / `readResource(uri)` / `searchTools(query)`；命名 `mcpResourceToolName`、`MCP_RESOURCE_MARKER`；纯函数 `resourceText`（blob 仅文本类 mime 才 base64 解码、结果按 `maxResourceChars` 截断）；常量 `DEFAULT_MAX_RESOURCE_CHARS` / `DEFAULT_MAX_RESOURCE_TOOLS`；错误 `McpResourceError`。资源按保守敏感度 `network-read` 物化，读取仅接受 `resources/list` **已声明**的 URI。

## 11. `@node-agent-runtime/provider-openai`（C7）

`OpenAIClientProvider`、`OpenAIClientOptions`

## 12. `@node-agent-runtime/store-sqlite`（C9）

`SQLiteStorage`、`SQLiteStorageOptions`、`SCHEMA_VERSION`

> `SCHEMA_VERSION`（P5.5）随 schema 版本化一起导出：数据库版本存于 `PRAGMA user_version`，启动时自动应用缺失迁移（幂等可重复），并新增 session/task/run 与审计排序的表达式索引。

---

## 12.1 `@node-agent-runtime/acp`（C10 · ACP agent，M8-2/M8-3）

78 个导出按职责分组（**完整符号清单以 `scripts/api-surface.baseline.json` 为唯一事实源**，本表只给分组与代表符号 —— 协议类型面很宽，逐条抄进文档只会让读者失去重点）：

| 分组 | 代表符号 | 说明 |
|---|---|---|
| **传输 / 帧** | `LineDecoder`、`encodeMessage`、`parseMessage`、`isRequest`、`isResponse`、`isError`、`handshake` | 换行分隔 JSON-RPC；stdout 只写 ACP 消息，日志走 stderr |
| **协议类型** | `SessionUpdate`、`ToolCallUpdate`、`PermissionOption`、`ConfigOption`、`SetConfigOptionResult`、`AgentCapabilities` | 与 ACP v1 对齐的类型面（多数是类型，编译后不占运行时体积） |
| **agent** | `AcpAgent`、`StorageAcpAgent`、`createDefaultAcpAgent` | `createDefaultAcpAgent({ provider, agents })` 即开箱入口 |
| **权限桥接** | `AcpPermissionBridge` | `session/request_permission` ↔ `PermissionManager`；客户端不实现该方法时降级为拒绝 |
| **执行模式** | `MODE_CONFIG_ID`、`toModeState`、`applyMode` | `session/set_mode` ↔ `SandboxMode`，并双轨提供 `session/set_config_option` |
| **错误码** | `METHOD_NOT_FOUND`、`INVALID_PARAMS`、`INTERNAL_ERROR` 等 | JSON-RPC 标准错误码 |

> 该包**不**被 `core` re-export（方向为 `acp → core`，反向成环），消费者须直接 `import ... from "@node-agent-runtime/acp"`。
> 脚手架 `create-node-agent-runtime` **不在本快照内**：它是 CLI，公共面是命令行与生成物，不是可 import 的库 API。

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
