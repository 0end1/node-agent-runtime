# Agent Runtime 拆包执行清单（Crate Split TODO）

> 记录时间：2026-09-07
> 依据：`docs/crate-architecture.md` §3（模块边界主表）与 §8（决策项）
> 目标：把 `core` 内的宿主/外围模块逐步抽为独立 npm workspaces 包，最终 `core` 收窄为 facade（聚合出口）。

## 1. 当前现状

- `packages/`：`core`、`types`、`provider-openai`、`store-sqlite`
- `core/src/` 内待拆文件：`session.ts`(721 行)、`memory.ts`、`checkpoint.ts`、`sandbox.ts`、`permission.ts`、`mcp/`（5 文件）、`artifact.ts`（归属待决）
- 曾试行 C8 host 拆包后回滚，本次清单按「可独立验收」的小步推进重排。

## 2. 已完成

- [x] C1 `@agent-runtime/types` —— v0.2
- [x] C2 `@agent-runtime/core` —— v0.2
- [x] C7 `@agent-runtime/provider-openai` —— M5-1
- [x] C9 `@agent-runtime/store-sqlite` —— M5-1

## 3. 待拆清单

| # | 包 | 迁移源 | 迁移测试 | 依赖 | 前置条件 | 批次 | 状态 |
|---|---|---|---|---|---|---|---|
| C6 | `@agent-runtime/mcp` | `core/src/mcp/`（client/jsonrpc/registry/transport/types） | `core/test/mcp.test.ts` + fixture | C1 + core 工具契约 | core 无反向 import；收窄 index 的 mcp 导出 | 1 | ☐ |
| C8 | `@agent-runtime/host` | `core/src/session.ts` | `core/test/session.test.ts` | core 宿主 API + C3/C4/C5 | 决策 §8-5 后才动；建议先搬迁后拆依赖 | 2 | ☐ |
| C3 | `@agent-runtime/memory` | `memory.ts`、`checkpoint.ts` | `core/test/memory.test.ts`、`checkpoint.test.ts` | types + core 的 Storage trait、工具契约 | 决策 §8-4（artifact 是否并入）；先拆 C8 | 3 | ☐ |
| C4 | `@agent-runtime/sandbox` | `sandbox.ts` | `core/test/sandbox.test.ts` | types（`sandbox:write`）+ core gate 类型 | 与 C5 交叉引用，先决策 §8-3 | 3 | ☐ |
| C5 | `@agent-runtime/policy` | `permission.ts` | `core/test/permission.test.ts`（如有） | core gate 调用点类型 | 同上 | 3 | ☐ |
| — | facade 收窄 | `core/src/index.ts` 由直出改逐包 re-export | 全量测试 | 全部包 | C6/C8/C3~C5 拆完；评估 §8-2 | 4 | ☐ |

## 4. 推荐执行顺序

**批次 1（低风险先行）—— C6 mcp**
- 文件已收敛为子目录，测试独立，core 无反向依赖，属纯外围增量。

**批次 2（枢纽，决定依赖方向）—— C8 host**
- `session.ts` 是 memory/checkpoint/sandbox/permission/artifact 的唯一宿主；不先挪出 core，C3~C5 拆出必然造成 core 反向依赖，后续拆不干净。
- 教训：上次回滚因改造面大。改为「先搬迁不拆依赖」：host 直接依赖 core，core 暂保留对外 re-export 保持兼容，再逐步收敛。

**批次 3 —— C3 memory，C4/C5（sandbox + policy）**
- 视 §8-3 决策：分两包或合成 `@agent-runtime/governance`。

**批次 4（收尾）—— facade 收窄**
- `core` 只作聚合 re-export；顺带评估 §8-2 契约下沉（`ToolDefinition` 元模型入 C1，转 Rust 前必需，TS 下可选）。

## 5. 阻塞决策点

- [ ] §8-5：Session/Task 是否出 core（决定 C8 做不做，以及 C3~C5 能否拆干净）
- [ ] §8-3：sandbox 与 policy 是否独立两包（决定批次 3 拆分次数）
- [ ] §8-4：`Artifact` 归属 —— 类型入 C1；实现随 M4 并入 C6 或并入 C3（草案：并入 C3）
- [ ] §8-2：`tool.ts`/`ToolDefinition` 契约层是否下沉 C1（非阻塞，转 Rust 前必须）

## 6. 每个包拆分的通用验收标准

- [ ] 新包 `package.json` / `tsconfig.json` 齐备，可独立 `tsc --noEmit`
- [ ] 新包测试迁移通过（core 中对应测试改 import 源）
- [ ] core 收窄导出后，全仓 `npm test` 与 typecheck 通过
- [ ] `examples/cli`、`examples/web` 导入已切换到新包（或经 facade 兼容）
- [ ] 根 `package.json` workspaces、`tsconfig.json` paths、`package-lock.json` 已接线
- [ ] 文档同步：`CHANGELOG.md`、`crate-architecture.md` 状态行、本清单状态勾选

## 7. 相关文档

- 模块边界与依赖图：`docs/crate-architecture.md`
- 顶层架构：`docs/architecture.md`
- codex 参考：`docs/codex-reference.md`
