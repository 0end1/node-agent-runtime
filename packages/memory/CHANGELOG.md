# @node-agent-runtime/memory

## 0.4.0

### Minor Changes

- 6d7d3ff: M7-1 成本与上下文治理（底座收敛首批）：

  - 内置计量：新增 `PriceTable` + `usageCost` 纯函数（`types`）；`RunUsage` 增 `cachedInputTokens?` / `costUsd?`；`core` 增加 `pricing?` 选项，优先级高于既有 `costUsd` 宿主钩子（钩子保留为回退）。
  - 上下文压缩：新增 `ContextBudget` + `compactMessages` 确定性纯函数（`memory`，零依赖、结构化折叠保留用户原始目标与工具结果关键字段）；`core` 在 step 循环内 provider 调用前执行压缩并发 `context:compacted`。
  - 事件与配置：新增 `usage:update` / `context:compacted` 事件；`core` 配置接入 `AGENT_CONTEXT_*` 环境变量；`provider-openai` 解析缓存命中 token。

  全部 additive（minor），provider-openai 为 patch 级解析增强。

- 3e93fe1: M7-5 底座部分：Agent 配方编译与快照。新增 `compileAgent(input, options?)`，把「工具重名 / 参数 schema 非法 / MCP 引用不可达」三类缺陷从运行时提前到**编译期一次性报错**（`AgentCompileError.issues` 汇总全部问题，非 fail-fast）；产物 `CompiledAgent` 含 `toolsHash` / `instructionsHash`，确定性故可缓存；`agentSnapshotOf(compiled)` 产出可直接写入 checkpoint 的配方快照。`Agent` 增可选 `mcpTools?`（结构化 `{ server, tool }`），经注入的 `resolveMcp` 解析后与本地工具同一命名空间参与重名检测 —— 依赖方向为 `mcp → core`，故刻意采用结构化参数而非 import `McpToolRef`，避免成环。新增纯函数 `validateSchema(schema)`（`types`）：校验 schema **自身**（未知 `type`、`required` 引用未定义属性、`minimum > maximum` 等，带字段路径），与既有 `validate(value, schema)` 的值校验互补 —— schema 写错在运行时不报错，只表现为模型一直调错参数。配方指纹拆两级：`toolsHash` 为硬校验（工具集变化即 transcript 无法复现），新增 `instructionsHash` 为软校验（语义漂移，可 `allowInstructionChange: true` 显式放行）；`AgentSnapshot` 增**可选** `instructionsHash?`，旧快照无此字段时退回既有校验，零破坏。`compileAgent()` **不是**授权检查 —— 编译通过的工具仍须逐次过 M3 审批与沙箱。全部 additive，无需 major。
- fa0b539: M7-6a 工具规模治理（检索式声明）：`core` 新增 `ToolIndex` / `createToolSearchTool` 与 `RunOptions.toolBudget`（opt-in 声明面裁剪 + `tool_search` 元工具，非权限收窄）；`StepSnapshot.toolSurface` / `StepStartEvent.declaredTools` 记录本步工具面，`Checkpoint.toolSurface` 同步落库（host 接入）。`StepStartEvent`/`StepSnapshot`/`Checkpoint` 均为 additive 字段，全部 minor。

### Patch Changes

- Updated dependencies [6d7d3ff]
- Updated dependencies [552076d]
- Updated dependencies [65743e8]
- Updated dependencies [3e93fe1]
- Updated dependencies [fa0b539]
  - @node-agent-runtime/types@0.4.0

## 0.3.0

### Minor Changes

- d19d5ae: P4 SDK 发布工程：MIT LICENSE；各包去 `private` 并补全发布元数据（`publishConfig.access=public`、`sideEffects:false`、仓库/关键词/作者）；`engines` 全仓统一 `>=22.13.0` 并以 `.nvmrc`/`packageManager` 对齐；`@node-agent-runtime/core` 与 `@node-agent-runtime/types` 提为插件包的 peer 依赖边界；新增包体积基线与 CI 门禁；引入 changesets 编排 0.2.0 → 0.3.0。

### Patch Changes

- Updated dependencies [d19d5ae]
  - @node-agent-runtime/types@0.3.0
