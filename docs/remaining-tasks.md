# 遗留任务清单（M5 收尾 · 下一开发阶段）

> 记录时间：2026-09-07（M5 产品化阶段收尾）
> 定位：**总池索引**，汇总现阶段全部遗留/未决任务，供下一开发阶段取用。
> 事实源：执行级细节仍以各自清单文档为准——`docs/m5-productization.md`（#5 验收移交）、`docs/crate-split-todo.md`（拆包批次与验收标准）、`docs/crate-architecture.md` §8（待决清单）、`docs/architecture.md` §11（路线图 M5 行待标 ✅）。任务完成时：**勾选源清单 + 回填本文状态行，双处同步**。
> **决策与执行状态（截至 M6-14，2026-09-08）**：C1~C4 四项开放决策已全部落定（见 §3「决策结论」列）；C1 经重评由「不拆」**修订为「拆 host」**，B1~B4 拆包批次全部完成（M6-7）。M6-9~11 自查整改进一步将 C3 的 Artifact 实现拆为独立包 `@agent-runtime/artifact`、把 B3 暂留 core 的 checkpoint 归位 memory、外置 mock/tools-basic，形成 **12 包终局**。本池去向：A1→P5 / A2→P2.4 / A3→P2 / A4→P6；B1~B4→P1（✅）；D2→P3.8；D1/D3 维持远期。**A3（质量门总闸）已于 M6-14 由 P2.6 吸收完成**（`npm run ci` = typecheck+lint+test+coverage+`check:api`，并固化进 `.github/workflows/ci.yml`）；**A2（跨形态 E2E）已于 M6-17 完成**（CLI + Web 全流程脚本化并接入 CI `e2e` job）；余 A1 / A4 仍 ☐。

## 0. 总览

| 组 | 编号 | 任务 | 来源 | 状态 |
|---|---|---|---|---|
| A 验收收口 | A1 | 安装/分发实机验证（.app 双击、dmg 安装） | m5 #5 | ☐ |
| A 验收收口 | A2 | 自动化 E2E（桌面 demo 全流程脚本化） | m5 #5 / architecture §11 M5 验收 | ✅（2026-09-08，M6-17）：跨形态 E2E 落地——`scripts/e2e/`（CLI + Web 验证通过、CI `e2e` job 接入；Desktop 默认跳过）；流程含 新建会话→对话→审批 ask→approve 落盘→artifact→续跑 |
| A 验收收口 | A3 | 质量门总闸：`npm run typecheck` + `npm test` 全绿 | m5 §6 | ✅（2026-09-08，M6-14）：由 M6 P2.6 吸收完成——`npm run ci`（typecheck + lint + test + coverage + `check:api`，12 包）一键全绿，并纳入 `.github/workflows/ci.yml` |
| A 验收收口 | A4 | `architecture.md` §11 M5 行补 ✅（含修订记录 v1.7） | architecture §11 | ☐ |
| B 拆包批次 | B1 | 批次 1：C6 `@agent-runtime/mcp` | crate-split-todo §3/§4 | ✅ |
| B 拆包批次 | B2 | 批次 2：C8 `@agent-runtime/host`（先决 C4） | crate-split-todo §3/§4 | ✅（C1 决策重评为「拆」，2026-09-07 完成） |
| B 拆包批次 | B3 | 批次 3：C3 memory；C4 sandbox + C5 policy（视 C2 分/合） | crate-split-todo §3/§4 | ✅ |
| B 拆包批次 | B4 | 批次 4：core facade 收窄（逐包 re-export） | crate-split-todo §3/§4 | ✅ |
| C 开放决策 | C1 | Session/Task 是否出 core（C8 host 做不做） | crate-architecture §8-5 | ✅ 已定 |
| C 开放决策 | C2 | sandbox/policy 独立两包 or 合成 `governance` | crate-architecture §8-3 | ✅ 已定 |
| C 开放决策 | C3 | `Artifact` 归属（草案：类型入 C1、实现并入 C3） | crate-architecture §8-4 | ✅ 已定 |
| C 开放决策 | C4 | `tool.ts`/`ToolDefinition` 契约层是否下沉 C1 | crate-architecture §8-2 | ✅ 已定 |
| D 远期 | D1 | Rust workspace 移植（对齐 codex，长期选项） | crate-architecture §7/§8-1 | ☐（远期） |
| D 远期 | D2 | `config`/`features` 配置与特性开关模块 | crate-architecture §8-7 | ✅（2026-09-08，M6-18）：`core/config.ts` `loadConfig()` 分层校验 + 特性开关，Provider 密钥仅经配置/环境注入 |
| D 远期 | D3 | 参考文档机制采纳（codex / deepseek harness） | codex/deepseek 参考文档 | ☐（远期） |

> 建议顺序：**C 决策先行 → A1~A4 验收收口 → B 拆包**；C1 决定 B2/B3 是否可拆干净，应在拆包动工前落定。
> 当前状态：C1~C4 已定、B1~B4 已全部完成（M6-7），M6-9~11 自查整改闭环（12 包终局，见 `crate-split-todo.md` 归档注记）；**A3 质量门总闸已于 M6-14 完成**（P2.6 `npm run ci` + CI 编排）；**A2 跨形态 E2E 已于 M6-17 完成**（P2.4 `scripts/e2e/` + CI `e2e` job）；余下 A1→P5、A4→P6 仍 ☐。

---

## 1. A 验收收口（下一开发阶段首要任务）

| # | 任务 | 说明 | 验收口径 |
|---|---|---|---|
| A1 | 安装/分发实机验证 | 双击 `target/release/bundle/macos/Agent Runtime Console.app` 确认窗口渲染 + 控制台全流程可用；`dmg` 安装到 `/Applications` 后再次验证。产物在本地（gitignore，不入库）；打包所需 `src-tauri/binaries/` 已在收尾时清理，重打前由 `npm run tauri build`（`beforeBuildCommand` 走 `build-server.mjs`）自动重建 | m5 §6 Desktop 验收 |
| A2 | 自动化 E2E | 桌面 demo 全流程（新建会话 → 对话 → 审批 ask → approve 落盘 + `sandbox:write` diff → artifact → 续跑）脚本化。M2/M3/M4 核心验收已自动化于包测试，本项补**跨形态（CLI/Web/Desktop）端到端**走查 | architecture §11 M5 验收 · ✅ **2026-09-08 完成（M6-17）**：`scripts/e2e/`（CLI + Web 全流程 + CI `e2e` job；Desktop 需 Tauri/Rust，默认跳过） |
| A3 | 质量门总闸 | 全量 `npm run typecheck` + `npm test`（types + core + provider-openai + store-sqlite）跑绿一次，作为阶段完成基线 | m5 §6 · ✅ **2026-09-08 完成（M6-14）**：升级为 `npm run ci`（typecheck + lint + test + coverage + `check:api`，12 包全覆盖）并纳入 CI，`npm run ci` 本地一键全绿 |
| A4 | 路线图回填 | A1~A3 通过后：`architecture.md` §11 M5 行标 ✅、§13 修订记录新增 v1.7；`CHANGELOG.md` 追加条目（同一 commit） | architecture §11/§13 约定 |

---

## 2. B 拆包执行（crate-split-todo.md，C1~C4 已落定）

| 批次 | 包 | 迁移源 | 迁移测试 | 依赖 | 前置 |
|---|---|---|---|---|---|
| 1 | C6 `@agent-runtime/mcp` | `core/src/mcp/`（client/jsonrpc/registry/transport/types） | `core/test/mcp.test.ts` + `test/fixtures/mock-mcp-server.mjs` | C1（types）+ core 工具契约（`defineTool` / `ToolKind` / `classifyToolName`，C4 决策不下沉） | core 无反向 import；core index 移除 mcp 导出 |
| 2 | C8 `@agent-runtime/host` | `core/src/session.ts`(721 行) | `core/test/session.test.ts` | host → {core, memory, sandbox, policy, types} | ✅ **2026-09-07 完成**：C1 决策重评为「拆」后执行（原计划一度移出 M6，见 §3 C1 修订记录）；破坏性变更，core 不再导出 `SessionManager` |
| 3 | C3 `@agent-runtime/memory`（含 Artifact 实现，见 C3 决策） | `memory.ts` `artifact.ts`（**`checkpoint.ts` 暂留 core**，见下注） | `memory.test.ts` `artifact.test.ts` | types（Storage/DocDomain/StreamDomain 与 Artifact 契约已下沉 C1） | ✅ 已完成（2026-09-07）。**checkpoint 留 core 原因**：`computeToolsHash`/`assertResumable` 依赖 core 的 `Agent` 类（工具契约虽已下沉 C1，但 `Agent` 实现仍在 core），外置会形成 core↔C3 包级循环；待 `Agent` 契约下沉或 B4 facade 收窄时再迁 |
| 3 | C4 `@agent-runtime/sandbox` + C5 `@agent-runtime/policy` | `sandbox.ts` + `permission.ts` | `sandbox.test.ts` `permission.test.ts` | types（工具/事件契约已下沉 C1）+  policy type-import sandbox 模式/域 | ✅ 已完成（2026-09-07）：按 C2 决策拆为独立两包，sandbox 13 / policy 13 测试通过 |
| 4 | facade 收窄 | `core/src/index.ts` 直出改逐包 re-export | 全量测试 | 全部包 | ✅ 已完成（2026-09-07）：`export *` 转发 memory/sandbox/policy（mcp 除外，避免循环）；C4 已重评并触发下沉 |

**每包通用验收标准**（crate-split-todo §6）：新包 `package.json`/`tsconfig.json` 齐备且可独立 `tsc --noEmit` → 对应测试迁移通过（core 测试改 import 源）→ core 收窄导出后全仓 `npm test` + typecheck 绿 → `examples/cli`、`examples/web` 导入切换（或经 facade 兼容）→ 根 workspaces / tsconfig paths / `package-lock.json` 接线 → 文档同步（CHANGELOG、crate-architecture 状态行、crate-split-todo 勾选）。

---

## 3. C 开放决策点（crate-architecture §8）——2026-09-07 已全部落定

| # | 决策 | 影响 | 决策结论 | 状态 |
|---|---|---|---|---|
| C1 | **Session/Task 是否出 core**（C8 host） | 决定 C8 做不做，及 C3~C5 能否拆干净（session.ts 是唯一宿主） | ✅ **2026-09-07 修订为「拆」**（原判定「不拆」）：原阻碍（memory/permission/artifact/sandbox 在 core 内与 session 互引）已随 B3/B4 消失，实测 core 内无模块依赖 `session.ts`，方向 host → {core, memory, sandbox, policy, types} 单向无环；且当前 0.x 全包 `private`（无外部消费者），破坏性变更成本最低。**已执行**：`packages/host/` 外置完成（host 8 测试通过），core 不再导出 `SessionManager` | ✅（已修订并执行） |
| C2 | sandbox 与 policy 独立两包 or 合成 `@agent-runtime/governance` | 决定批次 3 拆分次数 | **独立两包** C4 `@agent-runtime/sandbox` + C5 `@agent-runtime/policy`（按 codex 推荐）。理由：职责正交（执行域 vs 授权决策）；`permission.ts` 仅 type-import sandbox 的 `SandboxMode`/`SandboxScope`，拆后无运行期耦合 | ✅ |
| C3 | `Artifact` 归属 | 类型入 C1；实现随 M4 并 C6 or C3 | **类型下沉 C1**（`Artifact`/`ArtifactKind`/`ArtifactInput` 等），**实现并入 C3**（与 memory 同包 `@agent-runtime/memory`，包描述注明「会话记忆 + 产物存储，均基于 Storage 契约」）。同时**下沉 `Storage`/`DocDomain`/`StreamDomain` 契约至 C1**（`core/src/store/types.ts` 为零依赖纯类型），消除 core↔C3 循环 | ✅ |
| C4 | `tool.ts`/`ToolDefinition` 契约层是否下沉 C1 | TS 下 `import type` 可不拆；**转 Rust 前必须拆** | ✅ **已触发下沉（2026-09-07）**：拆 C4/C5 时 sandbox 需 `ToolKind`、policy 需事件与工具类型，留在 core 将形成包级循环 → 工具契约与事件契约一并下沉 C1（`types/src/tools.ts` / `events.ts`），core 保留实现并 re-export 类型（公共面不变）。`EventEmitter<E>` 亦入 C1，供 policy 结构化解耦 | ✅（已执行） |
>
> **决策修订注记（M6-12 追注）**：C3 的「实现并入 C3（memory 包）」于 M6-9 自查后修订为**独立拆包 `@agent-runtime/artifact`**（一包一职责，`packages/artifact/`）；B3 中暂留 core 的 `checkpoint.ts` 亦于 M6-10 借 ToolSurface 契约归位 memory；C3 结论中「包描述注明『会话记忆 + 产物存储』」一并随之失效（memory 现只承担 SessionMemory + Checkpoint）。C1/C2/C4 维持 §3 结论。相关修订与验证见 `p1-review.md` §3.1、`crate-split-todo.md` 归档注记、`CHANGELOG.md` M6-9/10 条目。

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
