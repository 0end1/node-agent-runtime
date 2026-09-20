# Agent Runtime 拆包执行清单（Crate Split TODO）

> 记录时间：2026-09-07
> 依据：`crate-architecture.md` §3（模块边界主表）与 §8（决策项）
> 目标：把 `core` 内的宿主/外围模块逐步抽为独立 npm workspaces 包，最终 `core` 收窄为 facade（聚合出口）。
> **进度（2026-09-07）**：§5 四项阻塞决策已全部落定（见 `remaining-tasks.md` §3）；批次 1~4 于 M6 全部执行完毕。
>
> **归档注记（2026-09-08，M6-12）**：本清单拆包已全部落地，并经 M6-9~11 自查整改形成 **12 包终局**——
> - `artifact` 未并入 memory，而是自 memory **拆为独立包** `@node-agent-runtime/artifact`（M6-9，一包一职责）；
> - `checkpoint` 于 M6-10 借 **ToolSurface 契约**归位 memory，不再留 core；
> - 补充外置 `@node-agent-runtime/tools-basic`（内置工具）与 `@node-agent-runtime/mock`（MockProvider），`core` 收窄至 1005 行；
> - §5 决策按 `remaining-tasks.md` §3 修订：§8-5 由「不出」修订为「拆 host」（M6-7）；§8-4 由「实现并 C3」修订为「独立 artifact 包」（M6-9）；§8-2 的工具/事件契约随批次 3 下沉 C1，`classifyToolName` 于 M6-9/11 最终下沉 C1。
>
> 现状以 `docs/architecture.md` §10（v1.9）、`docs/api-surface.md`、`final-review.md` 为唯一事实源，本文归档存档。

## 1. 拆分前现状（历史快照，保留归档；当前 12 包布局以 README「项目结构」与 `architecture.md` v1.9 §10 为准）

- `packages/`：`core`、`types`、`mcp`（新增，C6）、`provider-openai`、`store-sqlite`
- `core/src/` 内待拆文件：`session.ts`(721 行)、`memory.ts`、`checkpoint.ts`、`sandbox.ts`、`permission.ts`、`artifact.ts`（当时归属：类型下沉 C1、实现并 C3 —— 后修订为独立包，见归档注记）
- `core/src/mcp/` 已外置为 `packages/mcp/`（client/jsonrpc/registry/transport/types + index），core `index.ts` 相应收窄
- 曾试行 C8 host 拆包后回滚；C1 决策曾定 Session/Task 留 core（后被修订为「拆」，见 `remaining-tasks.md` §3 C1）。

## 2. 已完成

- [x] C1 `@node-agent-runtime/types` —— v0.2
- [x] C2 `@node-agent-runtime/core` —— v0.2
- [x] C7 `@node-agent-runtime/provider-openai` —— M5-1
- [x] C9 `@node-agent-runtime/store-sqlite` —— M5-1
- [x] **C6 `@node-agent-runtime/mcp`** —— M6 批次 1（2026-09-07）：`core/src/mcp/` 5 文件 + `mcp.test.ts` + `fixtures/mock-mcp-server.mjs` 迁至 `packages/mcp/`；`registry.ts` 改从 `@node-agent-runtime/core` 取 `defineTool`/`ToolKind`/`classifyToolName`（C4 决策契约不下沉）；core index 移除 mcp 导出（避免 core↔mcp 循环）；根 tsconfig paths / build / test 接线；`examples/cli.ts` 改从新包导入。验收：typecheck 绿、全仓测试 0 fail（core 84 pass+1 skip、mcp 15 pass）
- [x] **C3 `@node-agent-runtime/memory`** —— M6 批次 3（2026-09-07）：`memory.ts` + `artifact.ts` 与 `memory/artifact.test.ts` 迁至 `packages/memory/`；`Artifact`/`ArtifactKind`/`ArtifactInput` 契约下沉 C1；`session.ts` 改从新包导入，core 收窄实现导出；**`checkpoint.ts` 暂留 core**（依赖 `Agent` 与工具契约，外置会形成包级循环，待契约下沉或 facade 收窄再迁）。验收：typecheck 绿、全仓测试 0 fail（memory 17 pass、core 67 pass+1 skip）
- [x] **C4 `@node-agent-runtime/sandbox` + C5 `@node-agent-runtime/policy`** —— M6 批次 3 收尾（2026-09-07）：`sandbox.ts` / `permission.ts` 与两个测试分别迁至 `packages/sandbox/`、`packages/policy/`（C2 决策：独立两包）；前置**触发 §8-2 下沉**：工具契约与事件契约下沉 C1（`types/src/tools.ts`、`events.ts`），core 改 re-export 类型 + 保留实现，`EventEmitter<E>` 入 C1 让 policy 不再依赖 core 的 `EventBus`；`mcp` 的 `classifyToolName` 改依赖 sandbox 包。验收：typecheck 绿、全仓测试 0 fail（sandbox 13 / policy 13 / core 41 pass+1 skip）

## 3. 待拆清单

| # | 包 | 迁移源 | 迁移测试 | 依赖 | 前置条件 | 批次 | 状态 |
|---|---|---|---|---|---|---|---|
| C6 | `@node-agent-runtime/mcp` | `core/src/mcp/`（client/jsonrpc/registry/transport/types） | `core/test/mcp.test.ts` + fixture | C1 + core 工具契约 | core 无反向 import；收窄 index 的 mcp 导出 | 1 | ✅ |
| C8 | `@node-agent-runtime/host` | `core/src/session.ts`(721 行) | `core/test/session.test.ts` | core 引擎 API + memory/sandbox/policy + types | ✅ 已完成（2026-09-07）：C1 决策经重评**修订为「拆」**（原阻碍已随 B3/B4 消失，core 内无模块依赖 session）；core 不可反向 re-export host，故为破坏性变更，宿主改从新包导入 | 2 | ✅ |
| C3 | `@node-agent-runtime/memory`（含 Artifact 实现，C3 决策） | `memory.ts`、`artifact.ts`（`checkpoint.ts` 暂留 core） | `memory.test.ts`、`artifact.test.ts` | types（Storage/DocDomain/StreamDomain + Artifact 契约已下沉 C1） | 前置已完（Storage/Artifact 契约下沉 C1） | 3 | ✅（终局：Artifact 独立拆包 M6-9；checkpoint 归位 memory M6-10，见归档注记） |
| C4 | `@node-agent-runtime/sandbox` | `sandbox.ts` | `sandbox.test.ts` | types（工具契约已下沉 C1） | C2 决策：独立两包 | 3 | ✅ |
| C5 | `@node-agent-runtime/policy` | `permission.ts` | `permission.test.ts` | types +（policy 仅 type-import sandbox 模式/域） | 同上 | 3 | ✅ |
| — | facade 收窄 | `core/src/index.ts` 由直出改逐包 re-export | 全量测试 | 全部包 | ✅ 已完成（2026-09-07）：`export *` 转发 memory/sandbox/policy；mcp 不反向 re-export（避免循环） | 4 | ✅ |

## 4. 推荐执行顺序

**批次 1（低风险先行）—— C6 mcp** ✅ 已完成
- 文件已收敛为子目录，测试独立，core 无反向依赖，属纯外围增量。

**批次 2（原枢纽）—— C8 host** ⏸ 已移出
- 原本理由：`session.ts` 是 memory/checkpoint/sandbox/permission/artifact 的唯一宿主；不先挪出 core，C3~C5 拆出会造成 core 反向依赖。
- **C1 决策替代方案**：Session 留 core，改由「**契约下沉 C1**」解决循环——先把 `Storage`/`DocDomain`/`StreamDomain`（`core/src/store/types.ts`，零依赖纯类型）下沉到 types，再拆 C3~C5，即可在不拆 host 的前提下拆干净。

**批次 3 —— C3 memory（+ artifact），C4/C5（sandbox + policy）**
- C2 决策：独立两包（不合成 governance）。

**批次 4（收尾）—— facade 收窄**
- `core` 只作聚合 re-export；顺带重评 §8-2 契约下沉（`ToolDefinition` 元模型入 C1，转 Rust 前必需）。

## 5. 阻塞决策点

- [x] §8-5：Session/Task 是否出 core —— **已定：不出（不拆 C8 host），以契约下沉替代**
- [x] §8-3：sandbox 与 policy 是否独立两包 —— **已定：独立 C4/C5**
- [x] §8-4：`Artifact` 归属 —— **已定：类型下沉 C1，实现并入 C3（memory 包）**
- [x] §8-2：`tool.ts`/`ToolDefinition` 契约层是否下沉 C1 —— **已定：M6 暂不下沉**（外置包依赖 core 契约；循环出现或 Rust 移植前必须下沉）

> 决策全文与理由/触发条件见 `remaining-tasks.md` §3。

## 6. 每个包拆分的通用验收标准

- [x] 新包 `package.json` / `tsconfig.json` 齐备，可独立 `tsc --noEmit`（C6 ✅）
- [x] 新包测试迁移通过（core 中对应测试改 import 源）（C6 ✅）
- [x] core 收窄导出后，全仓 `npm test` 与 typecheck 通过（C6 ✅）
- [x] `examples/cli`、`examples/web` 导入已切换到新包（C6 ✅：cli 已切，web 未用 mcp）
- [x] 根 `package.json` workspaces、`tsconfig.json` paths、`package-lock.json` 已接线（C6 ✅）
- [x] 文档同步：`CHANGELOG.md`（随 commit 追加）、`crate-architecture.md` v0.11 修订行、本清单归档注记与状态勾选（M6-12）

## 7. 相关文档

- 模块边界与依赖图：`crate-architecture.md`
- 决策全文与遗留总池：`remaining-tasks.md`
- M6 生产化执行清单（拆包所在批次 P1）：`m6-productionization.md`
- 顶层架构：`docs/architecture.md`
- codex 参考：`codex-reference.md`
