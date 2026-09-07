# Agent Runtime 拆包执行清单（Crate Split TODO）

> 记录时间：2026-09-07
> 依据：`docs/crate-architecture.md` §3（模块边界主表）与 §8（决策项）
> 目标：把 `core` 内的宿主/外围模块逐步抽为独立 npm workspaces 包，最终 `core` 收窄为 facade（聚合出口）。
> **进度（2026-09-07，split 分支）**：§5 四项阻塞决策已全部落定（见 `remaining-tasks.md` §3）；**批次 1 C6 `@agent-runtime/mcp` 已拆完并通过验收**；批次 2 C8 host 经 C1 决策移出（⏸）。

## 1. 当前现状

- `packages/`：`core`、`types`、`mcp`（新增，C6）、`provider-openai`、`store-sqlite`
- `core/src/` 内待拆文件：`session.ts`(721 行)、`memory.ts`、`checkpoint.ts`、`sandbox.ts`、`permission.ts`、`artifact.ts`（归属已定：类型下沉 C1、实现并 C3）
- `core/src/mcp/` 已外置为 `packages/mcp/`（client/jsonrpc/registry/transport/types + index），core `index.ts` 相应收窄
- 曾试行 C8 host 拆包后回滚；C1 决策 Session/Task 留 core，host 拆包移出 M6（重评触发见 remaining-tasks §3 C1）。

## 2. 已完成

- [x] C1 `@agent-runtime/types` —— v0.2
- [x] C2 `@agent-runtime/core` —— v0.2
- [x] C7 `@agent-runtime/provider-openai` —— M5-1
- [x] C9 `@agent-runtime/store-sqlite` —— M5-1
- [x] **C6 `@agent-runtime/mcp`** —— M6 批次 1（2026-09-07）：`core/src/mcp/` 5 文件 + `mcp.test.ts` + `fixtures/mock-mcp-server.mjs` 迁至 `packages/mcp/`；`registry.ts` 改从 `@agent-runtime/core` 取 `defineTool`/`ToolKind`/`classifyToolName`（C4 决策契约不下沉）；core index 移除 mcp 导出（避免 core↔mcp 循环）；根 tsconfig paths / build / test 接线；`examples/cli.ts` 改从新包导入。验收：typecheck 绿、全仓测试 0 fail（core 84 pass+1 skip、mcp 15 pass）

## 3. 待拆清单

| # | 包 | 迁移源 | 迁移测试 | 依赖 | 前置条件 | 批次 | 状态 |
|---|---|---|---|---|---|---|---|
| C6 | `@agent-runtime/mcp` | `core/src/mcp/`（client/jsonrpc/registry/transport/types） | `core/test/mcp.test.ts` + fixture | C1 + core 工具契约 | core 无反向 import；收窄 index 的 mcp 导出 | 1 | ✅ |
| ~~C8~~ | ~~`@agent-runtime/host`~~ | — | — | — | — | 2 | ⏸ 移出（C1 决策：不拆 host；重评触发见 remaining-tasks §3 C1） |
| C3 | `@agent-runtime/memory`（含 Artifact 实现，C3 决策） | `memory.ts`、`checkpoint.ts`、`artifact.ts` | `memory.test.ts`、`checkpoint.test.ts`、`artifact.test.ts` | types（Storage/DocDomain/StreamDomain 契约下沉 C1 后） | 先下沉 Storage 契约，消除 core↔C3 循环 | 3 | ☐ |
| C4 | `@agent-runtime/sandbox` | `sandbox.ts` | `sandbox.test.ts` | types（`sandbox:write`） | C2 决策已定：独立两包 | 3 | ☐ |
| C5 | `@agent-runtime/policy` | `permission.ts` | `permission.test.ts` | types +（policy 仅 type-import sandbox 模式/域） | 同上 | 3 | ☐ |
| — | facade 收窄 | `core/src/index.ts` 由直出改逐包 re-export | 全量测试 | 全部包 | C6 已拆；C3~C5 拆完；届时重评 §8-2 | 4 | ☐ |

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

> 决策全文与理由/触发条件见 `docs/remaining-tasks.md` §3。

## 6. 每个包拆分的通用验收标准

- [x] 新包 `package.json` / `tsconfig.json` 齐备，可独立 `tsc --noEmit`（C6 ✅）
- [x] 新包测试迁移通过（core 中对应测试改 import 源）（C6 ✅）
- [x] core 收窄导出后，全仓 `npm test` 与 typecheck 通过（C6 ✅）
- [x] `examples/cli`、`examples/web` 导入已切换到新包（C6 ✅：cli 已切，web 未用 mcp）
- [x] 根 `package.json` workspaces、`tsconfig.json` paths、`package-lock.json` 已接线（C6 ✅）
- [ ] 文档同步：`CHANGELOG.md`（随 commit 追加）、`crate-architecture.md` 状态行、本清单状态勾选

## 7. 相关文档

- 模块边界与依赖图：`docs/crate-architecture.md`
- 决策全文与遗留总池：`docs/remaining-tasks.md`
- M6 生产化执行清单（拆包所在批次 P1）：`docs/m6-productionization.md`
- 顶层架构：`docs/architecture.md`
- codex 参考：`docs/codex-reference.md`
