# 项目开发清单（已完成 / 未来规划）

> 记录时间：2026-09-07
> 定位：**总览索引**。一张表看清「已做了什么 / 接下来做什么」。执行级细节以事实源为准——`m6-productionization.md`（M6 生产化执行清单）、`remaining-tasks.md`（遗留池 A~D）、`crate-split-todo.md`（拆包执行级）、`architecture.md` §11（演进路线图）、`m5-productization.md`（M5 验收依据）。本文与各源清单**状态同步回填，同一 commit**。
> 状态图例：✅ 完成 · 🟡 主体完成/收口中 · ☐ 待办 · ⏸ 远期（未排期）
> 一句话现状：**能力层 M0~M4 与产品化 M5 主体已完成并验证；M6 生产级改造 Gate 1~4 与 Gate 6 已关闭；P5.5/P5.6 交付物已完成；P5.1~P5.4 自 2026-09-10 起随桌面端移出至产品侧（代码与脚本作为产品侧资产保留，底座侧不再跟踪），不阻塞 M7 产品方向推进（见 `docs/product-direction.md`）**。**项目已按「底座」收敛（2026-09-10）**：`packages/*` 12 包为唯一一等公民，`examples/cli.ts`、`examples/web/`、`deploy/` 降级为验证载体；**`examples/desktop-tauri` 与 P5.1~P5.4 已整体移出底座、方向归产品侧**；M7 只对底座立项（判定见 `docs/base-convergence.md` §2.3）。

---

## 0. 阶段总览

| 阶段 | 主题 | 状态 | 关键交付 |
|---|---|---|---|
| M0 | 引擎原型 | ✅ | 主循环 · 事件总线 · 工具系统 · 双 provider |
| M1 · 生命周期 | `Session`/`Task`/`Run` + Storage + Context | ✅ | 会话可重启恢复；C1/C2 workspace 化 |
| M2 · 记忆与续跑 | Memory · Checkpoint · resume | ✅ | 步级快照 + 工具指纹校验后续跑 |
| M3 · 治理 | Permission 审批 + Sandbox 执行域 | ✅ | ask 审批流、三档沙箱、`sandbox:write` diff |
| M4 · 外部能力 | MCP + Artifact | ✅ | 远端工具物化同路径过治理；产物管理 |
| M5 · 产品化 | 分包 + CLI/Web/Desktop 三形态 | 🟡 | 三形态与生产打包已验证；A1~A4 收口移交 M6（A2 → P2.4 ✅、A3 → P2.6 ✅、A4 → P6.3 ✅，**仅剩 A1 → P5.1 签名后实机复验**） |
| **M6 · 生产级改造** | demo → 可用于生产 | 🟡 收尾中 | **Gate 1（P1）✅**（M6-7~12）：C1~C4 决策落定 + **12 包终局**（Artifact 独立、mock/tools-basic 外置、checkpoint 归位 memory，core 1005 行）+ 公共 API 冻结快照（`docs/api-surface.md`）；**Gate 2（P2）✅**（M6-16/17）：CI / Lint·Format / audit 门 / 覆盖率门禁（行均值 92.38%）/ 跨形态 E2E / `npm run ci` 总闸；**Gate 3（P3）✅**（M6-18~21）：可观测·错误码、脱敏、审批审计、限额、Web/MCP 安全加固、默认安全策略、配置分层；**Gate 4（P4）✅**（M6-22）：LICENSE / 发布元数据 / engines / changesets + 发版编排 / peer 边界 / 体积基线（canary 12 包实装验证）；**Gate 6（P6）✅**（M6-23~26）：治理文件 / README 生产用法 / 路线图回填 v1.10 / 双源收敛 / 参考机制复核；**P5 部分（Gate 5 待关）**：P5.5 store-sqlite 生产基线 ✅、P5.6 Web 部署形态 ✅（M6-24）；P5.1 实机验收 / P5.2 签名+公证 / P5.3 三平台矩阵 / P5.4 auto-updater **配置与脚本就绪**（M6-25/27），自 **2026-09-10 起随桌面端移出至产品侧**（不再是底座保留项；配置与脚本作为产品侧资产保留，不阻塞 M7）；产品方向见 `docs/product-direction.md`（详见 §3.1） |
| **M7 · 底座收敛与治理交付** | 以 **12 包为唯一一等公民** | 🟡 进行中（M7-1 + **M7-2 全量（traceId + OTEL span + 审计导出）** + M7-3 + M7-6a + **M7-6b** + **M7-5 底座部分（配方编译与快照）** 已落地，2026-09-15） | **投入分层收敛**：底座（`packages/*` 12 包）→ 验证载体（`examples/` · `deploy/`）；桌面端（`examples/desktop-tauri` · `desktop.yml` · P5.1~P5.4）**已移出至产品侧**；**只对底座立项**，首批 M7-1（成本与上下文治理）/ M7-2（可观测与合规导出）/ M7-3（策略工程化）/ M7-6（工具规模治理）。判定规则见 `docs/base-convergence.md`，候选见 §3.3；**首批执行清单见 `docs/m7-base-governance.md`**（包归属 / API 变更分级 / 验收用例 / 顺序）；**进度**：批次 A（12 包 bump 到 0.3.0，未发布/未打 tag）✅、M7-2 traceId 贯穿 ✅（`packages/core/test/trace.test.ts` 12 例，`npm run ci` 全绿）；M7-6a 检索式声明（`tool_search`）+ 步骤级 `toolSurface` 快照 ✅；**M7-2 收尾（`toOtelSpans` OTEL span 导出 + `serializeAudit` 审计导出）✅**（`packages/core/test/otel.test.ts` / `packages/host/test/audit-export.test.ts` 各 7 例，`npm run ci` 六门全绿）—— 首批 M7-1 / M7-2 / M7-3 / M7-6a **均已交付**；**M7-6b（MCP 只读资源 `resources/list` / `resources/read` + `searchTools`）于同日交付**（`packages/mcp/test/m7-6b.test.ts` 13 例 + `mcp.test.ts` 增 4 例，`npm run ci` 六门全绿），M7 首批目标**全部落地** |
| M8+ | 待规划 | ⏸ | 远期（Rust 移植 D1、参考机制 D3 等，发生再激活） |

---

## 1. 已完成：能力层（M0~M4）

| 里程碑 | 范围 | 主要交付物 | 验收证据 |
|---|---|---|---|
| **M0** | 引擎主循环、事件、工具、双 provider | `runtime.ts` `events.ts` `tool.ts` `providers/mock.ts` | `npm test` 14 用例；代码后迁入 `packages/core`（C2） |
| **M1 · 生命周期** | Session/Task/Run 实体化；`Storage` 接口 + `MemoryStorage`/`FileStorage`；`Context` 门面 | `session.ts` `store/` `context.ts`；npm workspaces 收敛为 C1 `types` + C2 `core` | 会话重启恢复、`history` 不再由调用方维护；`npm test` 35 通过 |
| **M2 · 记忆与续跑** | `SessionMemory`（消息流 + `remember`/`recall` 事实层）；步级 `Checkpoint`（含 `toolsHash`）；`resume()` | `memory.ts` `checkpoint.ts`；事件 `checkpoint:saved/restored` | 续跑 transcript 与一次性跑完一致；`npm test` types 4 + core 50 |
| **M3 · 治理** | `DefaultPermissionPolicy`（`ToolKind × SandboxMode` 决策矩阵）+ `PermissionManager`（ask/超时即拒/`approve({always})`）；`LocalSandbox`（三档模式 + 声明域 + 默认禁网 + 每调用超时） | `permission.ts` `sandbox.ts`；引擎 `RunOptions.gate` 单一接缝；事件 `permission:request/approved/denied`、`sandbox:write`（含 diff） | 危险工具默认 ask/deny、越界拒绝、策略 allow 也过不了 read-only（纵深防御）；`npm test` types 4 + core 77 |
| **M4 · 外部能力** | MCP client（stdio + streamable HTTP，JSON-RPC 2.0）+ `McpRegistry` 物化 `mcp__server__tool`；`ArtifactManager` | `core/src/mcp/` `artifact.ts`；`SessionManager.artifacts` 门面 + 会话级联清理 | stdio/HTTP 双 mock server 端到端；`npm test` types 4 + core 99 |

---

## 2. 已完成：产品化与工程（M5）

| # | 事项 | 交付物 / 结果 | 状态 |
|---|---|---|---|
| M5-1 | 拆包收口 C7/C9 | `provider-openai`（fetch/OpenAI 兼容）+ `store-sqlite`（`node:sqlite`）外置为独立 workspace 包；core 只留 `ModelProvider`/`Storage` 接缝与 `MockProvider` | ✅ |
| M5-2 | CLI 演示面 | 演示写工具 `demo_write_file`（`kind:"write"`）触发 M3；CLI 订阅审批/沙箱事件，阻塞等待授权仍可 approve/deny | ✅ |
| M5-3 | Web 演示面 | 常驻 SSE `/api/events`、审批卡片、`sandbox:write` diff、artifact 面板、checkpoint/resume、会话切换；支持 `--storage=sqlite` | ✅ |
| M5-4 | Desktop 壳 | `examples/desktop-tauri/`（Tauri v2）：窗口载 Web 控制台，`beforeDevCommand` 启本地 server；图标生成、`cargo check` 绿 | ✅ |
| M5-5 | 清单状态刷新 | `m5-productization.md` #3 状态更新、验收路径细化（dev / 生产两条） | ✅ |
| M5-6 | Desktop 生产打包闭环 | `build-server.mjs` esbuild 打包 server + 复制 Node 运行时与静态资源；app 自带 Node sidecar；`tauri build` 出 `.app`(123M)/`.dmg`(42M)，实跑 `:8787 → 200` | ✅ |
| M5-7 | 遗留任务清单入库 | `docs/remaining-tasks.md`（A 验收 4 / B 拆包 4 / C 决策 4 / D 远期 3） | ✅ |
| M5-8 | 仓库更名引用同步 | GitHub `0end1/nodeRuntimes` → `0end1/nodeRuntime`；`package.json` 三处引用 + origin remote 更新 | ✅ |
| — | 工程基线 | npm workspaces monorepo（4 包，均 `private`）；TS strict + NodeNext + `declaration`/`sourceMap`；逐包 `node:test`（`tsx --test`）；docs 8 篇；CHANGELOG 按 M 编号；分支 `apps`/`main`/`dev` 三线同步 | ✅ |

> **M5 收口（🟡，仅剩 A1 实机复验）**：主体（三形态 + 生产打包）已验证完成；`remaining-tasks` A1~A4 **移交 M6** 且去向全部落地 —— **A3 全量质量门 ✅（M6-14，P2.6 `npm run ci` + CI 常态化）**、**A2 自动化 E2E ✅（M6-17，P2.4 `scripts/e2e/` CLI + Web + CI `e2e` job）**、**A4 路线图回填 ✅（M6-26，P6.3 `architecture.md` §11 M6 行 + §13 v1.10）**；**A1 ⏸ 已随桌面端移出至产品侧（2026-09-10；原 P5.1，M6-25 验收脚本 `verify:desktop` 本就绪）**。
>
> **口径更新（2026-09-10 底座收敛）**：M5 交付的「三形态」自本日起降级 —— CLI/Web 为**验证载体**（只验证底座、不演进产品）；Desktop 与 P5.1~P5.4 **移出至产品侧**（底座不再投入与判定）；底座（`packages/*` 12 包）为唯一一等公民。判定与纪律见 `docs/base-convergence.md` §2.3。

---

## 3. 未来要做

### 3.1 M6 · 生产级改造（进行中，执行清单见 `docs/m6-productionization.md`）

| 批次 | 主题 | 关键项 | 状态 |
|---|---|---|---|
| **P1** | 决策冻结 + 包边界收口（**发布前置**） | 落定 C1~C4 决策 → 拆包 B1 mcp / B2 host / B3 memory·sandbox·policy / B4 facade 收窄 → M6-9~11 自查整改（Artifact 独立 / mock·tools-basic 外置 / checkpoint 归位，**12 包终局**）→ 公共 API 冻结快照 | ✅ 全部完成（Gate 1 已关闭，快照见 `docs/api-surface.md`，基线复核见 P2.7） |
| **P2** | 工程护栏与质量门 | GitHub Actions CI（typecheck/lint/test/build）、ESLint+Prettier、覆盖率门禁、跨形态 E2E（吸收 A2）、`npm audit` 门、收敛为 `npm run ci`（吸收 A3） | ✅ **Gate 2 关闭（M6-17）**：P2.1 / P2.2 / P2.5 / P2.6 ✅（M6-14）：`.github/workflows/ci.yml`（quality / coverage / audit 三 job）+ ESLint 9 + Prettier 基线 + `npm run ci` 总闸；**P2.7 ✅** 已随总闸接入 CI；**P2.3 ✅**（M6-16）：统计口径修正为只统计本包 + 补 `types`/`tools-basic` 测试 + 阈值定档（逐包 行≥80 / 分支≥60 / 函数≥55，全仓均值 行≥90 / 分支≥78 / 函数≥85），`npm run coverage:gate` 阻断；**P2.4 ✅**（M6-17）：`scripts/e2e/` 跨形态 E2E（CLI + Web 全流程验证通过、CI `e2e` job 接入；Desktop 默认跳过） |
| **P3** | 可观测 · 安全 · 配置 | 结构化日志+错误码、事件/日志脱敏、审批审计与白名单持久化、成本/速率上限、Web/本地 server 鉴权与防跨站、MCP 防 SSRF、默认安全策略包、config/features（吸收 D2） | ✅ **Gate 3 关闭（M6-18~19，评审加固 M6-20/21）**：`Logger`/错误码、`redact()` 强脱敏（密钥永不进事件/日志/diff）、审批审计 + 白名单持久化、`RunLimits` 成本/速率上限、web `security.ts`（CORS/CSRF/Bearer/体上限）、MCP URL 白名单 + 重定向逐跳校验、`PRODUCTION_MATRIX` 默认安全、`loadConfig()` 分层配置；均有单测 / E2E 覆盖 |
| **P4** | SDK 发布工程 | LICENSE、去 `private` + `publishConfig`、engines/Node 基线统一、changesets 版本编排 + `npm publish --provenance`、依赖策略（`workspace:`）、包体积基线 | ✅ **Gate 4 关闭（M6-22）**：MIT + 12 包可发布元数据齐备（`npm pack --dry-run` 正确）、engines 统一 Node ≥22.13（ESM-only）、changesets 版本编排 + `release.yml`、core/types 提为插件 peer 边界、体积基线 CI 门禁；canary 12 包 tarball 全新项目实装验证通过；**已于 2026-09-16 以 0.4.0 首发（带 provenance）、0.4.1 补齐 workspace 内部依赖声明后实发完成**（详见 `docs/m7-base-governance.md` §6 复盘） |
| **P5** | 分发与部署矩阵 | 桌面实机验证（吸收 A1）、macOS 签名+公证、Windows/Linux 三平台产物、auto-updater、store-sqlite 生产基线（WAL/索引/迁移）、Web 容器化部署样例 | ⏸ **桌面项移出，Gate 5 仅剩 Web/存储（2026-09-10）**：P5.5 store-sqlite 基线 ✅（M6-24，SCHEMA_VERSION=2 迁移幂等 + 1k 记录耗时断言）、P5.6 Web 部署形态 ✅（M6-24，deploy/ Dockerfile·systemd·nginx + `smoke:web`，两者交付物不受挂起影响）；P5.1 实机验收 / P5.2 签名+公证 / P5.3 三平台 CI / P5.4 auto-updater **已随桌面端移出至产品侧**（配置与脚本作为产品侧资产保留，M6-25/27），底座侧不再跟踪、**不纳入 M7 关键路径** |
| **P6** | 治理 · 文档 · 社区 | `CONTRIBUTING`/`SECURITY`、README 生产用法、路线图回填（吸收 A4）、双源收敛、CHANGELOG M6 条目 | ✅ **Gate 6 关闭（M6-23~26）**：P6.1 治理文件、P6.2 README 生产用法（badges + 安装/配置/观测/发布）、P6.3 路线图回填（`architecture.md` §11 + §13 v1.10）、P6.4 `remaining-tasks.md` 双源收敛、P6.5 CHANGELOG 分批条目、P6.6 参考机制采纳复核 |

执行约束：**P1 先行且必须早于 P4**（发布即冻结 API 边界）；P3 与 P5 可在 P2 后并行；P6 全期并行。

### 3.2 遗留池（`remaining-tasks.md`，已重排入 M6）

| 组 | 内容 | 去向 |
|---|---|---|
| A 验收收口 | A1 安装分发实机 / A2 自动化 E2E / A3 质量门 / A4 路线图回填 | **A1 → P5.1 ⏳**（M6-25 脚本就绪，待 P5.2 签名复验）；**A2 → P2.4 ✅（M6-17）**；**A3 → P2.6 ✅（M6-14）**；**A4 → P6.3 ✅（M6-26）** |
| B 拆包批次 | C6 mcp、C8 host、C3 memory + C4/C5 sandbox·policy、facade 收窄 | → P1.2~P1.5（✅ 全部完成，M6-7） |
| C 开放决策 | Session/Task 是否出 core；sandbox·policy 分合；`Artifact` 归属；tool 契约是否下沉 C1 | → P1.1（✅ 完成，M6-7：C1 修订为拆 host / C2 独立两包 / C3 类型下沉 + 实现独立成包 / C4 工具与事件契约下沉 C1） |
| D 远期 | **D2 config/features ✅**（M6-18 落地 P3.8）；**D3 参考机制 ✅ 采纳复核**（M6-26 落地 P6.6）；D1 Rust workspace 移植 | D1 维持 ⏸（触发时激活，`crate-architecture.md` 即蓝本） |

### 3.3 M7+ 候选池（未排期，M6 收口后按反馈定优先级）

> **M7 口径（2026-09-10）**：项目已按**底座**收敛，判定与纪律见 `docs/base-convergence.md`（底座 = `packages/*` 12 包；`examples/` 与 `deploy/` 为验证载体；`examples/desktop-tauri` 与 P5.1~P5.4 已移出至产品侧）；**只对底座立项**，首批 M7-1 成本与上下文治理 / M7-2 可观测与合规导出 / M7-3 策略工程化 / M7-6 工具规模治理。下表为技术候选池，其中「多 Agent 协同」「Rust 移植」维持远期不立项，其余候选立项前先过 `base-convergence.md` §3 三问准入规则。方向与里程碑草案见 `docs/product-direction.md`；**首批四项执行清单见 `docs/m7-base-governance.md`**（2026-09-10 立；立项前需按 §4 先回填 `architecture.md` §11 + §13）。

| 候选 | 说明 | 来源 |
|---|---|---|
| Agent 配方快照与编译期校验 | `agentId` 版本快照（防配方变更破坏历史会话）、`McpToolRef[]` 延迟解析、`compileAgent()` 校验重名/可达性/Schema | `architecture.md` §3.2 |
| 宿主驱动 Task 流水线增强 | §4.2 目标流水线主线已随 M1~M3 落地；剩余增强（多任务编排、并发调度、失败重试策略）待定 | `architecture.md` §4.2 |
| 多 Agent 协同 / 子任务编排 | 多 agent 协作与委派，生态常见诉求 | 待论证（可先做 ADR） |
| 参考机制采纳 | codex / deepseek-harness 中的 model 路由、token 计量、UI 插件化等 | `codex-reference.md` / `deepseek-harness-reference.md`（D3） |
| Rust workspace 移植 | 单二进制分发 / 深层并发 / 性能诉求触发时激活 | `crate-architecture.md` §7/§8-1（D1） |

---

## 4. 维护约定

- 状态变更：完成即**回填本文 + 对应源清单 + CHANGELOG 条目，同一 commit**；涉及公共 API 变更做全仓回归。
- 本文为**索引视图**：与源清单描述冲突时以源清单为准，并顺手修正本文，避免双源漂移。
- 新增阶段（M7 等）：先在 `architecture.md` §11 路线图表新增行 + §13 修订记录，再回填本文 §0/§3.3。

## 5. 相关文档

- **产品方向规划（M7+）**：`docs/product-direction.md`
- **收敛决策事实源（底座边界 / 准入 / 移出）**：`docs/base-convergence.md`
- 产品落地路径评估（形态成本与 ACP 替代路径）：`docs/product-build-paths.md`
- M7 首批执行清单（底座治理交付 M7-1/2/3/6）：`docs/m7-base-governance.md`
- M6 执行清单：`docs/m6-productionization.md`
- 遗留任务总池：`docs/remaining-tasks.md` · 拆包执行级：`docs/crate-split-todo.md`
- 路线图与修订记录：`docs/architecture.md` §11 / §13
- M5 验收依据：`docs/m5-productization.md`
- 模块边界与决策：`docs/crate-architecture.md` §8
