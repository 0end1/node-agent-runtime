# 最终审查与封板核对（七 + 一主题总表）

> 记录时间：2026-09-08（split 分支，M6-9 ~ M6-11 审查整改闭环后）
> 定位：把散落各文档的 **7 项架构审查主题 + MCP-as-Tools 合理性**结论汇聚为**发布（Gate 4）前置的单一核对入口**，评审时可逐项引用并勾选，避免在多份文档间翻找。
> 方法与口径：以代码事实（包结构 / 导出面 / 调用点）为准、以 `docs/` 决策记录为据；API 口径与 `docs/api-surface.md` 一致（各包 `dist/index.d.ts` = 消费者入口）。
> 归档缺口闭合：① `architecture.md` §13 回填 v1.9（12 包视图 + M6-10/11）；② `api-surface.md` §1 补 types 防腐红线明示；③ 本总表即「单一核对入口」。

---

## 1. 结论总览

| # | 主题 | 结论 | 决策 / 证据主档 | 复核 |
|---|---|---|---|---|
| 1 | Core 最小核心 | ✅ 通过 | `docs/p1-review.md`（core 1804 → **1005 行**，引擎本体 ≈819 行）；`docs/api-surface.md` §2 | `npm test -w @node-agent-runtime/core`、`npm run check:api` |
| 2 | Agent Loop 所有权冻结 | ✅ 冻结于 core 引擎 | `docs/architecture.md` §4.3 / §12-1；`docs/p1-review.md` Q3 | `npm run typecheck` |
| 3 | Runtime Event / Host Event 边界 | ✅ 同一契约、总线可注入 | `architecture.md` §7；`docs/crate-architecture.md` §5-4；`api-surface.md` §2 注记 | — |
| 4 | Context / Memory / Checkpoint / Storage 边界 | ✅ 结构独立 | `architecture.md` §3.1/§8/§9；`api-surface.md` §2~§4/§12 | `npm test`（全仓） |
| 5 | Tool Contract 最终冻结 | ✅ 已稳定 + 门禁 | `architecture.md` §5.1；`api-surface.md` §1/§2/§13 | `npm run check:api` |
| 6 | types 防腐规则 | ✅ 红线成文 | `crate-architecture.md` C1 行 + §5；`p1-review.md` Q8③；`api-surface.md` §1（本轮明示） | `npm run typecheck -w @node-agent-runtime/types` |
| 7 | 用户视角 Public API 检查 | ✅ 以消费入口为准并脚本化 | `api-surface.md` §0/§13（M6-11 基线） | `npm run check:api` |
| 8 | MCP-as-Tools 合理性 + 后续落点 | ✅ 合理；后续在 §3.2 / M7+ | `architecture.md` §5.3 / §3.2；`docs/development-checklist.md` §3.3 | — |

---

## 2. 逐项核验

### 2.1 Core 最小核心（审查主题 1）—— 通过

- **体量**：`@node-agent-runtime/core` = 引擎 + facade，**1005 行 / 49 符号 + 5 个 `export *` 转发**（api-surface §2）。
- **瘦身轨迹**：1804 行（M6-8）→ 1146（M6-9 演示资产外置 `tools-basic`/`mock`）→ **1005**（M6-10 Checkpoint 归位 C3、事件可注入）；演进证据见 CHANGELOG M6-9/M6-10 与 p1-review §1、Q1/Q2。
- **最小核心判据**：引擎只保留 `AgentRuntime.run` 主循环、`Agent` 配方、`Context` 门面、事件总线、工具/模型契约与注册；Memory / Sandbox / Policy / Host 均以注入实现出现，core 不承载具体后端。

### 2.2 Agent Loop 所有权冻结（审查主题 2）—— 归属 core，已冻结

- **所有权裁定**：主循环（模型往返 → 解析 → 工具执行 → 回填 → 步级快照）在引擎内部——`AgentRuntime.run()`，即 architecture §4.3「Run 循环（**引擎内部**，v1 保留现状主循环并外挂扩展点）」；分层约束见 §12-1（Desktop → Host → Core，单向）。
- **Host 仅编排不持有循环**：全仓库仅 1 处 `runtime.run()` 调用（p1-review Q3 核实 host 无工具执行、无模型调用逻辑）。
- **冻结对象**：`RunOptions` / `RunResult` / `RunContext` / `StepSnapshot` 属 core 公共面（api-surface §2），快照 + `check:api` 门禁 = 所有权冻结的机械保证。
- **不改变所有权的未来增强**：宿主驱动 Task 流水线（多任务 / 并发 / 重试）列 M7+ 候选（development-checklist §3.3），仅外挂扩展点不动主循环归属。

### 2.3 Runtime Event / Host Event 边界（审查主题 3）—— 单一契约

- **事件全集**即 C1 `types/events` 的 `RuntimeEvent` 判别联合（21 个具名事件 + `EventEmitter`），域划分见 architecture §7 事件表 ↔ api-surface §1；**不存在 host 私有事件杂烩**。
- **边界规则**：crate-architecture §5-4「事件类型进 C1、总线实现在 C2」；事件保持 JSON 可序列化（跨进程/SSE 前提，architecture §7）。
- **总线可注入（M6-10 P2-b）**：`AgentRuntimeOptions.events?` 与 `SessionManagerOptions.events?` 支持宿主创建/注入 `EventBus`（默认自建）；host 内部 11 处发布统一改走 `this.events`，不再借用 `runtime.events` 内部构件。宿主侧会话/任务状态同样以 `RuntimeEvent` 对外暴露 + 公开只读字段，边界闭合。

### 2.4 Context / Memory / Checkpoint / Storage 边界（审查主题 4）—— 已独立

| 关注点 | 归属 | 依据 |
|---|---|---|
| Context 门面 | core（`buildRunContext`/`RunContext`/`RunContextSeed`） | architecture §3.1；api-surface §2 |
| Memory（会话消息流 + 事实层） | `@node-agent-runtime/memory`（`SessionMemory`） | architecture §8.2；api-surface §3 |
| Checkpoint（步级快照 / 续跑校验） | `@node-agent-runtime/memory`（自 core 归位；`ToolSurface` 契约解耦 `Agent`） | CHANGELOG M6-10；api-surface §3 |
| Artifact | `@node-agent-runtime/artifact`（自 memory 拆出，一包一职责） | CHANGELOG M6-9（P1-b）；api-surface §4 |
| Storage 契约 | C1 `types/storage`（`Storage`/`DocDomain`/`StreamDomain`） | crate-architecture §5；api-surface §1 |
| Storage 实现 | core 内置 `MemoryStorage`/`FileStorage`（零依赖）；SQLite 外置 C9 `store-sqlite` | architecture §9；api-surface §2/§12 |

审查结论：p1-review Q4（五条接缝边界成立）、Q8①（「memory 装 artifact」名实不符已拆包修正）。

### 2.5 Tool Contract 最终冻结（审查主题 5）—— 已稳定

- architecture §5.1「Tool（**保持现状接口，v0.1 已稳定**）」；契约集中于 C1 `types/tools`（`ToolDefinition`/`AnyTool`/`ToolExecutionContext`/`ToolKind`/`ToolMeta`/`classifyToolName`/`toolKind`）。
- core 仅保留引擎面构造器：`defineTool` / `defineAgent` / `findDuplicateToolNames`。
- **冻结门禁**：api-surface §1/§2 快照 + §13「变更 → 破坏性评审」+ M6-11 `check:api` 脚本（差异即待评审项）。

### 2.6 types 防腐规则（审查主题 6）—— 红线已成文

- **规则源**：crate-architecture C1 行职责（契约、校验器、**零 IO 纯函数**；不 import 仓库内其他模块）+ §5 边界规则 2/4/6（契约下沉 C1、事件类型进 C1、IO 永远外置）。
- **审查确认**：p1-review Q8③ —— types 为干净叶子包（570 行 / 8 文件 / 零依赖），含 `validate`/`newId`/`fmtNumber` 属合理纯函数，但要求**明示边界**。
- **本轮闭合（2026-09-08）**：`api-surface.md` §1 补「防腐红线」注记（只许契约声明 + 零 IO 纯函数；禁止 IO / 有状态逻辑 / 运行时内部依赖）；`packages/types/package.json` 描述本已含 "zero-IO pure helpers. No internal dependencies."。

### 2.7 用户视角 Public API 检查（审查主题 7）—— 以消费入口为准

- `api-surface.md` 提取口径 = 各包 **`dist/index.d.ts`（发布形态）**，`scripts/check-api-surface.ts` 与基线 `scripts/api-surface.baseline.json` 机械比对（M6-11），新增/删除即评审触发点。
- **双入口说明**：core 以 facade 转发 types/memory/artifact/sandbox/policy（兼容入口）；`host` 与 `mcp` 不被 core 反向 re-export，消费者必须从对应子包导入（api-surface §0）。推荐直连子包，文档已注明来源以消除歧义。
- **用户视角回归**：`examples/{cli,web,desktop}` 的导入源随整改同步切换（CHANGELOG M6-9/M6-10），三种形态即最小消费方验证。

---

## 3. MCP-as-Tools：合理性 + 后续落点

### 3.1 合理性结论 —— ✅ 成立（架构裁决）

- architecture §5.3 设计原则：**MCP Server 的唯一产物是「动态 Tool 集合」**——`McpRegistry` 将远端工具物化为 `mcp__server__tool` 前缀的本地 `ToolDefinition`，注册后与本地工具 **100% 同路径**。
- 因此 MCP 作为 tools 接入，可获得**统一治理面**：工具分类（`ToolKind`/`classifyToolName`）→ Permission `gate()` → Sandbox `wrap()` 对 MCP 工具与本地工具一视同仁，治理/沙箱无需旁路通道（纵深防御不变）。
- **依赖卫生**：P1-a 整改后 `classifyToolName`/`toolKind` 下沉 C1，`@node-agent-runtime/mcp` 只依赖 core + types（p1-review 表中该行由 ⚠️「扩展能力但依赖偏重」→ ✅）；api-surface §10 冻结其 28 个导出符号。

### 3.2 后续处理落点

| 待办（工具物化之外的增强） | 落点 | 状态 |
|---|---|---|
| Agent 配方引用 `McpToolRef[]` 延迟解析 + `compileAgent()` 校验（重名 / MCP 可达性 / Schema） | `architecture.md` §3.2 | 设计条目，未排期 |
| 排期归属 | `docs/development-checklist.md` §3.3 M7+ 候选池 | 未排期 |
| MCP 供应链防护（stdio 超时 / streamable HTTP URL 白名单防 SSRF / 凭据 env 注入） | M6 P3.6（`docs/m6-productionization.md`） | ☐ |

即：**MCP 本体（client/transport/registry，28 符号）已实现并冻结**；「作为 tools」的抽象已审查定案；配方级一等引用等后续在 M7+ 窗口、以 architecture §3.2 为准推进。

---

## 4. 复核命令（Gate 4 前一键）

```bash
npm run typecheck            # 全仓类型
npm test                     # 全仓测试（types/memory/artifact/sandbox/policy/core/tools-basic/mock/host/mcp/provider-openai/store-sqlite）
npm run build                # 产出 dist（check:api 前置）
npm run check:api            # 公共导出面 vs 基线，0 差异（差异按 api-surface §13 评审）
npm run ci                   # P2.6 质量门总闸（接入 CI 后）
```

---

## 5. 关联文档

- `docs/architecture.md` —— 架构设计 v1.9（§4.3 主循环、§5 Tool/MCP、§7 事件、§12 原则、§13 修订）
- `docs/crate-architecture.md` —— 模块边界图 C1~C9（§5 边界规则、C1 职责行）
- `docs/api-surface.md` —— 公共 API 冻结快照（12 包 + 防腐红线 + §13 变更/复核规则）
- `docs/p1-review.md` —— P1 审查（问题→P0/P1/P2 整改 → 状态回填）
- `docs/m6-productionization.md` —— M6 执行清单（P1 Gate1 关闭；P2~P6 逐项勾选）
- `docs/development-checklist.md` —— 里程碑与 M7+ 候选池
- `CHANGELOG.md` —— Unreleased M6-9 / M6-10 / M6-11 变更记录
