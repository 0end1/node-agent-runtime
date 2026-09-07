# 遗留任务清单（M5 收尾 · 下一开发阶段）

> 记录时间：2026-09-07（M5 产品化阶段收尾）
> 定位：**总池索引**，汇总现阶段全部遗留/未决任务，供下一开发阶段取用。
> 事实源：执行级细节仍以各自清单文档为准——`docs/m5-productization.md`（#5 验收移交）、`docs/crate-split-todo.md`（拆包批次与验收标准）、`docs/crate-architecture.md` §8（待决清单）、`docs/architecture.md` §11（路线图 M5 行待标 ✅）。任务完成时：**勾选源清单 + 回填本文状态行，双处同步**。
> **决策状态（2026-09-07，split 分支）**：C1~C4 四项开放决策已全部落定（见 §3「决策结论」列），据此 B1（C6 mcp）动工；C1 结论为不拆 C8 host，故 **B2 移出 M6 计划**（⏸ 待重评）。

## 0. 总览

| 组 | 编号 | 任务 | 来源 | 状态 |
|---|---|---|---|---|
| A 验收收口 | A1 | 安装/分发实机验证（.app 双击、dmg 安装） | m5 #5 | ☐ |
| A 验收收口 | A2 | 自动化 E2E（桌面 demo 全流程脚本化） | m5 #5 / architecture §11 M5 验收 | ☐ |
| A 验收收口 | A3 | 质量门总闸：`npm run typecheck` + `npm test` 全绿 | m5 §6 | ☐ |
| A 验收收口 | A4 | `architecture.md` §11 M5 行补 ✅（含修订记录 v1.7） | architecture §11 | ☐ |
| B 拆包批次 | B1 | 批次 1：C6 `@agent-runtime/mcp` | crate-split-todo §3/§4 | 🟡 进行中（split 分支） |
| B 拆包批次 | B2 | 批次 2：C8 `@agent-runtime/host`（先决 C4） | crate-split-todo §3/§4 | ⏸ 移出（C1 决策：不拆 host） |
| B 拆包批次 | B3 | 批次 3：C3 memory；C4 sandbox + C5 policy（视 C2 分/合） | crate-split-todo §3/§4 | ☐ |
| B 拆包批次 | B4 | 批次 4：core facade 收窄（逐包 re-export） | crate-split-todo §3/§4 | ☐ |
| C 开放决策 | C1 | Session/Task 是否出 core（C8 host 做不做） | crate-architecture §8-5 | ✅ 已定 |
| C 开放决策 | C2 | sandbox/policy 独立两包 or 合成 `governance` | crate-architecture §8-3 | ✅ 已定 |
| C 开放决策 | C3 | `Artifact` 归属（草案：类型入 C1、实现并入 C3） | crate-architecture §8-4 | ✅ 已定 |
| C 开放决策 | C4 | `tool.ts`/`ToolDefinition` 契约层是否下沉 C1 | crate-architecture §8-2 | ✅ 已定 |
| D 远期 | D1 | Rust workspace 移植（对齐 codex，长期选项） | crate-architecture §7/§8-1 | ☐（远期） |
| D 远期 | D2 | `config`/`features` 配置与特性开关模块 | crate-architecture §8-7 | ☐（已拉近 M6 P3.8） |
| D 远期 | D3 | 参考文档机制采纳（codex / deepseek harness） | codex/deepseek 参考文档 | ☐（远期） |

> 建议顺序：**C 决策先行 → A1~A4 验收收口 → B 拆包**；C1 决定 B2/B3 是否可拆干净，应在拆包动工前落定。
> 当前执行：C1~C4 已定 → **B1（mcp）进行中** → 其余 A 项按 M6 计划分批（A2/A3→P2，A1→P5，A4→P6）。

---

## 1. A 验收收口（下一开发阶段首要任务）

| # | 任务 | 说明 | 验收口径 |
|---|---|---|---|
| A1 | 安装/分发实机验证 | 双击 `target/release/bundle/macos/Agent Runtime Console.app` 确认窗口渲染 + 控制台全流程可用；`dmg` 安装到 `/Applications` 后再次验证。产物在本地（gitignore，不入库）；打包所需 `src-tauri/binaries/` 已在收尾时清理，重打前由 `npm run tauri build`（`beforeBuildCommand` 走 `build-server.mjs`）自动重建 | m5 §6 Desktop 验收 |
| A2 | 自动化 E2E | 桌面 demo 全流程（新建会话 → 对话 → 审批 ask → approve 落盘 + `sandbox:write` diff → artifact → 续跑）脚本化。M2/M3/M4 核心验收已自动化于包测试，本项补**跨形态（CLI/Web/Desktop）端到端**走查 | architecture §11 M5 验收 |
| A3 | 质量门总闸 | 全量 `npm run typecheck` + `npm test`（types + core + provider-openai + store-sqlite）跑绿一次，作为阶段完成基线 | m5 §6 |
| A4 | 路线图回填 | A1~A3 通过后：`architecture.md` §11 M5 行标 ✅、§13 修订记录新增 v1.7；`CHANGELOG.md` 追加条目（同一 commit） | architecture §11/§13 约定 |

---

## 2. B 拆包执行（crate-split-todo.md，C1~C4 已落定）

| 批次 | 包 | 迁移源 | 迁移测试 | 依赖 | 前置 |
|---|---|---|---|---|---|
| 1 | C6 `@agent-runtime/mcp` | `core/src/mcp/`（client/jsonrpc/registry/transport/types） | `core/test/mcp.test.ts` + `test/fixtures/mock-mcp-server.mjs` | C1（types）+ core 工具契约（`defineTool` / `ToolKind` / `classifyToolName`，C4 决策不下沉） | core 无反向 import；core index 移除 mcp 导出 |
| 2 | ~~C8 `@agent-runtime/host`~~ | — | — | — | **⏸ 移出 M6**：C1 决策 Session/Task 留 core（见 §3 C1） |
| 3 | C3 `@agent-runtime/memory`（含 Artifact 实现，见 C3 决策） | `memory.ts` `checkpoint.ts` `artifact.ts` | `memory.test.ts` `checkpoint.test.ts` `artifact.test.ts` | types（Storage/DocDomain/StreamDomain 契约已下沉 C1） | 先下沉 Storage 契约到 C1，避免 core↔C3 循环 |
| 3 | C4 `@agent-runtime/sandbox` + C5 `@agent-runtime/policy` | `sandbox.ts` + `permission.ts` | `sandbox.test.ts` `permission.test.ts` | types +（policy 仅 type-import sandbox 模式/域） | C2 决策：独立两包 |
| 4 | facade 收窄 | `core/src/index.ts` 直出改逐包 re-export | 全量测试 | 全部包 | C6/C3~C5 拆完；届时重评 C4（tool 契约是否下沉 C1） |

**每包通用验收标准**（crate-split-todo §6）：新包 `package.json`/`tsconfig.json` 齐备且可独立 `tsc --noEmit` → 对应测试迁移通过（core 测试改 import 源）→ core 收窄导出后全仓 `npm test` + typecheck 绿 → `examples/cli`、`examples/web` 导入切换（或经 facade 兼容）→ 根 workspaces / tsconfig paths / `package-lock.json` 接线 → 文档同步（CHANGELOG、crate-architecture 状态行、crate-split-todo 勾选）。

---

## 3. C 开放决策点（crate-architecture §8）——2026-09-07 已全部落定

| # | 决策 | 影响 | 决策结论 | 状态 |
|---|---|---|---|---|
| C1 | **Session/Task 是否出 core**（C8 host） | 决定 C8 做不做，及 C3~C5 能否拆干净（session.ts 是唯一宿主） | **不拆 C8 host**：`SessionManager` 留 core。理由：session 依赖 runtime/agent/memory/permission/artifact/checkpoint，拆出需 examples 全量改 import，收益不抵 M6 发布前风险；「产品概念不进引擎」由 facade 收窄（B4）与新宿主能力外置逐步满足。**重评触发**：引擎侧需复用 Task 状态机 / 出现多宿主形态 | ✅ |
| C2 | sandbox 与 policy 独立两包 or 合成 `@agent-runtime/governance` | 决定批次 3 拆分次数 | **独立两包** C4 `@agent-runtime/sandbox` + C5 `@agent-runtime/policy`（按 codex 推荐）。理由：职责正交（执行域 vs 授权决策）；`permission.ts` 仅 type-import sandbox 的 `SandboxMode`/`SandboxScope`，拆后无运行期耦合 | ✅ |
| C3 | `Artifact` 归属 | 类型入 C1；实现随 M4 并 C6 or C3 | **类型下沉 C1**（`Artifact`/`ArtifactKind`/`ArtifactInput` 等），**实现并入 C3**（与 memory 同包 `@agent-runtime/memory`，包描述注明「会话记忆 + 产物存储，均基于 Storage 契约」）。同时**下沉 `Storage`/`DocDomain`/`StreamDomain` 契约至 C1**（`core/src/store/types.ts` 为零依赖纯类型），消除 core↔C3 循环 | ✅ |
| C4 | `tool.ts`/`ToolDefinition` 契约层是否下沉 C1 | TS 下 `import type` 可不拆；**转 Rust 前必须拆** | **M6 暂不下沉**：外置包（mcp/memory/sandbox/policy）依赖 core 的工具契约获取 `defineTool`/`ToolDefinition`/`ToolKind`，与既有 C7/C9 模式一致。**下沉触发**：C3~C5 拆包出现 core↔子包循环，或启动 D1（Rust 移植）前必须下沉 | ✅ |

---

## 4. D 远期（不排期，采纳/发生时再激活）

| # | 事项 | 激活条件 |
|---|---|---|
| D1 | Rust workspace 移植（对齐 codex-rs）：`crate-architecture.md` 即移植蓝本（C1~C9 表逐行对应） | 出现单二进制分发 / 深层并发 / 性能诉求 |
| D2 | `config`/`features` 配置与特性开关模块（仿 codex） | **已拉近**：M6 P3.8 落地（宿主层需配置驱动装配 / 能力开关，deepseek-harness 有 Cordis 参考） |
| D3 | codex / deepseek-harness 参考机制（context-fragments、模型路由、token 计量、UI 插件化等） | 仅作参考入库；**被某里程碑采纳时**再回填该里程碑文档 + CHANGELOG，并引用对应参考文档 |

---

## 5. 维护约定

- 源清单与本文**状态回填同一次提交**；`CHANGELOG.md` 条目与代码/文档同一 commit。
- 每项任务完成须过质量门：相关包 `typecheck` + 测试绿；涉及公共 API 变更时全仓回归。
- 本文不替代执行级清单，细节有出入以源清单为准（并顺手修正本文，避免双源漂移）。

## 6. 相关文档

- M5 验收口径与状态：`docs/m5-productization.md`（#5、§6）
- 拆包执行级清单：`docs/crate-split-todo.md`
- 模块边界 / 决策点 / 里程碑：`docs/crate-architecture.md`、`docs/architecture.md` §11
- M6 生产化执行清单（本池 A~C 的重排去向）：`docs/m6-productionization.md`
- 项目开发总览（已完成 / 未来）：`docs/development-checklist.md`
- 参考（远期采用时引用）：`docs/codex-reference.md`、`docs/deepseek-harness-reference.md`
