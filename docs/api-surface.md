# 公共 API 冻结快照（M6 · P1.6）

> 记录时间：2026-09-07（split 分支）
> 定位：M6 **P1 的 Gate 1 退出项** —— 冻结 9 个 workspace 包的对外导出面，作为后续兼容性评审的基线。
> 提取方式：TypeScript 编译器解析各包构建产物 `dist/index.d.ts`（`npm run build` 后）与 `packages/types/dist/*.d.ts`，符号按字母序排列。

## 0. 总览

| 包 | 版本 | 导出符号数 | 角色 |
|---|---|---|---|
| `@agent-runtime/types` | 0.2.0 | 7 个子模块聚合（展开见 §1） | C1 契约叶子包（零依赖） |
| `@agent-runtime/memory` | 0.2.0 | 13 | C3 会话记忆 + 产物 |
| `@agent-runtime/sandbox` | 0.2.0 | 14 | C4 执行域 |
| `@agent-runtime/policy` | 0.2.0 | 15 | C5 授权决策 |
| `@agent-runtime/core` | 0.2.0 | 61（+ 4 个 `export *` 转发） | C2 引擎 + facade |
| `@agent-runtime/host` | 0.2.0 | 10 | C8 会话/任务生命周期 |
| `@agent-runtime/mcp` | 0.2.0 | 28 | C6 MCP 适配 |
| `@agent-runtime/provider-openai` | 0.2.0 | 2 | C7 模型后端 |
| `@agent-runtime/store-sqlite` | 0.2.0 | 2 | C9 存储后端 |

> 依赖方向（单向无环）：`types ← {memory, sandbox, policy} ← core ← {host, mcp, provider-openai, store-sqlite}`。
> `core` 以 facade 方式 `export *` 转发 memory / policy / sandbox / types；**mcp 与 host 不被 core 反向 re-export**（二者依赖 core，反向会成环），宿主须直接从对应包导入。

---

## 1. `@agent-runtime/types`（C1 · 契约）

| 子模块 | 导出 |
|---|---|
| `artifacts` | `Artifact`、`ArtifactInput`、`ArtifactKind` |
| `events` | `RuntimeEvent` + `RunStartEvent`、`UserMessageEvent`、`StepStartEvent`、`ModelResponseEvent`、`ToolStartEvent`、`ToolEndEvent`、`RunEndEvent`、`RunErrorEvent`、`SessionCreatedEvent`、`SessionUpdatedEvent`、`SessionClosedEvent`、`TaskCreatedEvent`、`TaskStatusEvent`、`CheckpointSavedEvent`、`CheckpointRestoredEvent`、`PermissionRequestEvent`、`PermissionApprovedEvent`、`PermissionDeniedEvent`、`SandboxWriteEvent`、`EventEmitter` |
| `schema` | `JsonSchema`、`JsonSchemaType`、`validate` |
| `storage` | `Storage`、`DocDomain`、`StreamDomain` |
| `tools` | `ToolDefinition`、`AnyTool`、`ToolExecutionContext`、`ToolKind`、`ToolMeta` |
| `types` | `ChatMessage`、`UserMessage`、`AssistantMessage`、`SystemMessage`、`ToolCall`、`ToolResultMessage`、`RunUsage` |
| `util` | `newId`、`stringifyResult`、`fmtNumber` |

## 2. `@agent-runtime/core`（C2 · 引擎 + facade）

**引擎与运行时**：`AgentRuntime`、`RunAbortedError`、`AgentRuntimeOptions`、`RunOptions`、`RunResult`、`StepSnapshot`、`EventBus`
**Agent**：`Agent`、`defineAgent`、`DEFAULT_AGENT_INSTRUCTIONS`、`AgentOptions`
**Context**：`buildRunContext`、`RunContext`、`RunContextSeed`
**Checkpoint**：`CheckpointStore`、`CheckpointMismatchError`、`computeToolsHash`、`assertResumable`、`Checkpoint`、`AgentSnapshot`、`CheckpointSeed`
**Storage 实现**：`MemoryStorage`、`FileStorage`
**工具**：`defineTool`、`findDuplicateToolNames`、`builtinTools`、`evaluate`、`CURRENCY_ALIASES`、`CurrencyCode`、`ToolDefinition`、`AnyTool`、`ToolExecutionContext`、`ToolKind`、`ToolMeta`
**模型**：`ModelProvider`、`ModelRequest`、`ModelResponse`、`RawToolCall`、`FinishReason`、`ModelRequestError`、`MockProvider`
**事件类型（转发自 C1）**：`RuntimeEvent` 及 §1 `events` 全部事件接口
**facade 转发**：`export *` → `@agent-runtime/types`、`@agent-runtime/memory`、`@agent-runtime/sandbox`、`@agent-runtime/policy`

> 已从 core 移出（破坏性变更）：`SessionManager` / `SessionError` / Session·Task 类型 → `@agent-runtime/host`；MCP 全部符号 → `@agent-runtime/mcp`。

## 3. `@agent-runtime/memory`（C3）

`SessionMemory`、`Memory`、`MemoryFact`、`MemoryRecall`、`SessionMemoryOptions`、`ArtifactManager`、`ArtifactManagerOptions`、`ArtifactError`、`MIME_BY_KIND`、`blobKeyOf`、`Artifact`、`ArtifactKind`、`ArtifactInput`（后三者 re-export 自 C1）

## 4. `@agent-runtime/sandbox`（C4）

`LocalSandbox`、`LocalSandboxOptions`、`Sandbox`、`SandboxHandle`、`SandboxMode`、`SandboxScope`、`SandboxRunContext`、`SandboxWriteInfo`、`SandboxViolationError`、`SandboxTimeoutError`、`classifyToolName`、`toolKind`、`isPathAllowed`、`simpleDiff`

## 5. `@agent-runtime/policy`（C5）

`PermissionManager`、`PermissionManagerOptions`、`PermissionPolicy`、`DefaultPermissionPolicy`、`DefaultPermissionPolicyOptions`、`StaticPolicy`、`combinePolicies`、`toolListPolicy`、`Verdict`、`Decision`、`DecisionMatrix`、`PermissionContext`、`PermissionCall`、`GateResult`、`PendingDecision`

## 6. `@agent-runtime/host`（C8）

`SessionManager`、`SessionManagerOptions`、`SessionError`、`Session`、`SessionStatus`、`Task`、`TaskStatus`、`RunRecord`、`RunStatus`、`ChatOutcome`

## 7. `@agent-runtime/mcp`（C6）

`McpClient`、`McpClientOptions`、`McpRegistry`、`McpRegistryOptions`、`RegisteredServer`、`StdioTransport`、`StdioTransportOptions`、`StreamableHttpTransport`、`StreamableHttpTransportOptions`、`McpTransport`、`McpError`、`McpTimeoutError`、`McpConnectionError`、`MCP_PROTOCOL_VERSION`、`MCP_TOOL_PREFIX`、`mcpToolName`、`parseMcpToolName`、`normalizeSchema`、`pathArgKeysOf`、`parseSse`、`McpServerHandle`、`McpToolMeta`、`McpToolRef`、`McpCallToolResult`、`McpServerInfo`、`McpServerCapabilities`、`McpInitializeResult`、`McpTextContent`

## 8. `@agent-runtime/provider-openai`（C7）

`OpenAIClientProvider`、`OpenAIClientOptions`

## 9. `@agent-runtime/store-sqlite`（C9）

`SQLiteStorage`、`SQLiteStorageOptions`

---

## 10. 变更规则（冻结后生效）

| 变更类型 | 判定 | 处理 |
|---|---|---|
| **新增**导出（新符号 / 新可选字段） | 兼容 | 追加本表 + CHANGELOG（`Added`），minor |
| **删除 / 重命名**导出 | **破坏性** | break-change 评审；1.0 前 minor 并显著提示，1.0 后 major |
| **收窄**参数/返回值类型、必填化可选字段、改默认值 | **破坏性** | 同上 |
| 仅内部实现变更（导出面不变） | 兼容 | 常规 patch/minor |

**评审流程**：提出变更 → 在 PR 中标注 `BREAKING` 并说明影响面与迁移方式 → 更新本表对应行 + `CHANGELOG.md` → 合并。

**快照复核**：每次发布前用同一提取方式重新生成并与本表比对（差异即为待评审项）。复核命令思路：解析各包 `dist/index.d.ts` 的导出声明并按包比对符号集合（可脚本化后纳入 P2 的 CI 作业 `api-surface`）。
