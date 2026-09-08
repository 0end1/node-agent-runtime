# Changelog

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

本文件记录 **Agent Runtime（nodeRuntimes）** 的重要变更。

> **维护约定**：每次代码提交（commit）时，请同步在 [Unreleased] 或对应版本段落追加条目，并将 CHANGELOG 更新与代码放入**同一个 commit**。分类参考 Conventional Commits：`Added` 新增 / `Changed` 变更 / `Fixed` 修复 / `Docs` 文档 / `Security` 安全。

## [Unreleased]

**M6-17 · 跨形态自动化 E2E（P2.4）**（2026-09-08）：

- **E2E 脚本**：新增 `scripts/e2e/`（lib 公共库 + cli/web/desktop 三形态 + run-all 调度）；`npm run e2e` 默认跑 CLI + Web，`--only=<形态>` 单选，`--with-desktop` / `e2e:desktop` 追加 Desktop（需 Tauri/Rust，默认跳过）
- **CLI 形态**：stdin 驱动 `examples/cli.ts` REPL 走通「对话（calculator 单步 / geocode→weather 多步）→ 写文件触发 ask → `/approve` 授权 → 沙箱落盘 → `/checkpoints` → `/resume` → `/artifacts`」
- **Web 形态**：HTTP + SSE 驱动 `examples/web/server.ts` 走通「新建会话 / 对话单步+多步工具 / ask→`/api/approve`→沙箱落盘 / `/api/artifacts` / `/api/checkpoints`+`/api/resume`」
- **CI 接入**：`.github/workflows/ci.yml` 新增 `e2e` job（`needs: quality`，跑 `npm run e2e`，自带 prebuild）；Desktop 形态 CI 默认跳过
- **MockProvider 写文件意图（配套）**：`packages/mock/src/mock.ts` 新增「写文件」意图，使 demo/Mock 可触发 `demo_write_file` 的 ask→approve→沙箱写入链路（此前规则模型从不调用该工具，演示能力实际不可达）

### Added（M6-17）
- `scripts/e2e/lib.mjs`、`scripts/e2e/cli.mjs`、`scripts/e2e/web.mjs`、`scripts/e2e/desktop.mjs`、`scripts/e2e/run-all.mjs`
- 根脚本：`e2e`、`e2e:cli`、`e2e:web`、`e2e:desktop`、`pree2e`（自动 build）

### Changed（M6-17）
- `.github/workflows/ci.yml`：新增 `e2e` job
- `packages/mock/src/mock.ts`：新增写文件意图（让 ask 审批链路在 Mock 下可达）

**验收**：`npm run e2e` 两形态全流程通过（14 步全绿）；`npm run ci` 全绿；`npm run coverage:gate` 通过；`check:api` 0 差异。

**M6-17 加固 · E2E artifact 强断言 + 退出清理**（2026-09-08）：

- **artifact 覆盖盲点修复**：`examples/cli.ts` 与 `examples/web/server.ts` 的 `demo_write_file` 在写文件落盘后调用 `manager.artifacts.save` 登记 `file` 产物。此前运行时不会自动登记工具结果，artifacts 恒为空，M4 能力在端到端从未被真正覆盖
- **E2E 强断言**：`scripts/e2e/cli.mjs` / `scripts/e2e/web.mjs` 的 artifact 步骤由「仅判数组 / 含文本」升级为「非空 + 含写文件登记的 `file` 产物 + 内容可读」；CLI 经 `/artifact <id>` 校验 `hello cli`，Web 经 `/api/artifact/<id>` 校验 `hello e2e`
- **CLI 退出清理**：`scripts/e2e/cli.mjs` 收尾由 `send("exit")`（被当成对话）改为 `proc.child.stdin.end()` 触发 readline `close` → `doExit` 正常退出
- **Desktop 注释**：`scripts/e2e/desktop.mjs` 补本地启用命令 `E2E_DESKTOP=1 npm run e2e:desktop`

### Fixed（M6-17 加固）
- `examples/cli.ts`、`examples/web/server.ts`：写文件后登记 `file` artifact（修复 M4 端到端覆盖盲点）

### Changed（M6-17 加固）
- `scripts/e2e/cli.mjs`、`scripts/e2e/web.mjs`、`scripts/e2e/desktop.mjs`

---

**M6-16 · 覆盖率门禁（P2.3）**（2026-09-08）：

- **口径修正**：`scripts/coverage.mjs` 增加 `--test-coverage-include=src/**|dist/**`，覆盖率**只统计本包**。首测（M6-14）把依赖包的 `dist` 计入本包，导致数值严重失真——`policy/permission.js` 实际 98.17% 却被 `types/dist/*.js` 拉低到 34.65%，`artifact/artifact.js` 实际 100% 被拉低到 35.18%
- **补测**：新增 `packages/types/test/util.test.ts`（`newId` / `stringifyResult` / `fmtNumber` 含循环引用与非有限数分支）、`packages/types/test/tools.test.ts`（`classifyToolName` 五类分支 + `toolKind` 声明优先）、`packages/tools-basic/test/builtin.test.ts`（`now` / `geocode` / `weather` / `exchange` 执行体与错误分支）
- **缺陷修复**：`packages/types` 的 `test` 脚本由硬编码 `test/schema.test.ts` 改为 `test/*.test.ts`（此前该包新增测试文件不会被执行）
- **阈值定档**：逐包 行 ≥80 / 分支 ≥60 / 函数 ≥55；全仓均值 行 ≥90 / 分支 ≥78 / 函数 ≥85；新增 `npm run coverage:gate`（阻断）并接入 `npm run ci` 与 CI `coverage` job；`npm run coverage` 保留为纯报告

### Added（M6-16）
- `packages/types/test/util.test.ts`、`packages/types/test/tools.test.ts`、`packages/tools-basic/test/builtin.test.ts`
- 根脚本 `coverage:gate`

### Changed（M6-16）
- `scripts/coverage.mjs`：统计口径、阈值常量与 `--gate` 校验
- `packages/types/package.json`：`test` 脚本改为通配（与其它 11 包一致）
- `.github/workflows/ci.yml`：`coverage` job 改跑 `npm run coverage:gate`
- `package.json`：`ci` 中的 `coverage` 改为 `coverage:gate`

**验收**：`npm run ci` 全绿；`npm run coverage:gate` 通过；覆盖率水位（口径修正 + 补测后）行 **92.38%** / 分支 **80.44%** / 函数 **89.74%**（`mock` 无测试文件，跳过）。分支低水位（`mcp` 64.74 / `host` 66.23 / `core` 72.79 / `provider-openai` 73.13 / `tools-basic` 76.38 / `policy` 77.14）经评审豁免，下一档目标 ≥70、最终 ≥80。

---

**M6-15 · 任务状态回填（Docs）**（2026-09-08）：把 M6-14 工程护栏的完成事实回填各清单，消除双源漂移。

- `docs/remaining-tasks.md`：**A3 质量门总闸 ✅**（由 M6 P2.6 吸收完成 —— `npm run ci` = typecheck+lint+test+coverage+`check:api`，并纳入 `.github/workflows/ci.yml`）；头部决策状态行、§0 总览 A3 行、§1 A3 明细、建议顺序状态行四处同步
- `docs/development-checklist.md`：§0 M6 行改为「P2 主体已完成（P2.4 ☐、P2.3 阈值待评审）」；§2 M5 收口行与 §3.2 遗留池标注 A3 已完成（去向 P2.6）
- `docs/m5-productization.md`：阶段状态与 #5 补注 ——「仓库级 typecheck/test 全绿」已由 `npm run ci` + CI 常态化保障，#5 仍余安装分发实机验证与自动化 E2E
- `docs/docmap-audit.md`：§4 缺失项 CI workflow 标 ✅ 已补齐；§7 追加 M6-14 / M6-15 执行记录

**验收**：纯文档状态回填，无代码与公共 API 变化；`npm run ci` 不受影响。

---

**M6-14 · 工程护栏（P2.1 / P2.2 / P2.5 / P2.6，含 P2.3 水位）**（2026-09-08）：

- **P2.1 CI 主流程**：新增 `.github/workflows/ci.yml`，三个 job —— `quality`（typecheck → lint → test → build → `check:api`，Node 22.x）、`coverage`（仅出报告，不阻断）、`audit`（`npm audit --omit=dev --audit-level=high`）；matrix 暂固定 22.x（`@agent-runtime/store-sqlite` 依赖 `node:sqlite` ≥22.5，engines 统一待 P4.3）
- **P2.2 Lint/Format 基线**：新增 `eslint.config.js`（ESLint 9 flat config + typescript-eslint）与 `.prettierrc` / `.prettierignore`；根脚本 `lint` / `lint:fix` / `format` / `format:check`；已执行一次全仓格式化（52 文件）
- **P2.3 覆盖率（先出水位）**：新增 `scripts/coverage.mjs` 与 `npm run coverage`，逐包跑 `node --import tsx --test --experimental-test-coverage` 并汇总，完整输出落 `coverage/report.txt`（已入 `.gitignore`）；**暂不设门槛**
- **P2.5 依赖审计门**：CI `audit` job；`package-lock.json` 在库，当前 0 vulnerabilities
- **P2.6 质量门总闸**：`npm run ci` = `typecheck && lint && test && coverage && check:api`（`test` 的 `pretest` 已含 build），本地一键全绿

### Added（M6-14）
- `.github/workflows/ci.yml`、`eslint.config.js`、`.prettierrc`、`.prettierignore`、`scripts/coverage.mjs`
- 根脚本：`lint`、`lint:fix`、`format`、`format:check`、`coverage`、`ci`
- devDependencies：`eslint@^9`、`@eslint/js@^9`、`typescript-eslint@^8`、`prettier`、`globals`

### Changed（M6-14）
- 全仓 Prettier 格式化（代码风格统一：printWidth 100 / 双引号 / trailing comma）
- 清理 lint 问题：`prefer-const` 2 处（`core/test/runtime.test.ts`、`mock/src/mock.ts`）、未使用变量 3 处（`host/src/session.ts` 改直接校验、`mock/src/mock.ts` 参数加 `_` 前缀、`sandbox/test/sandbox.test.ts` 删除未调用的 `manager()` 死代码）
- `.gitignore` 增加 `coverage/`

**验收**：`npm run ci` 全绿（`lint` 0 error 0 warning、`test` 0 fail、12 包 `check:api` 0 差异）；`npm audit --omit=dev` 0 vulnerabilities；覆盖率水位（首次）行 58.62% / 分支 72.26% / 函数 53.77%（11 包有测试，`mock` 无测试），明细见 `docs/m6-productionization.md` §2。

---

**M6-13 · 文档同步收口（P0/P1 修正）**（2026-09-08）：基于 `docs/docmap-audit.md`（M6-12 文档盘点）执行其 §6 的 P0/P1 修正清单，把拆包后仍残留的单包时代/中间态描述对齐到 **12 包终局**：

- `README.md`：项目结构树改为 12 包依赖分层布局（含 `core/src/store/` 与真实源码文件，去掉拆包前旧树）；核心代码示例与会话示例导入源由 `./src/index.js` 改按包导入（`@agent-runtime/core` / `mock` / `tools-basic` / `provider-openai` / `host`）；概念表补包名；内置工具节注明源自 `@agent-runtime/tools-basic`；兼容注改为「core = facade 聚合出口，导出面以 api-surface + check:api 为准」
- `docs/crate-split-todo.md`：新增「归档注记」（12 包终局：artifact 独立拆包、checkpoint 归位 memory、§5 决策 C1/C4 修订）；§1 标注为历史快照；C3 状态格与 §6 文档同步项收尾勾选
- `docs/m6-productionization.md`：P1.6 改 12 包导出面、P1.1 追注 Artifact 独立成包、进度段加「12 包终局」追注
- `docs/development-checklist.md`：§0 M6 行与 P1/P2 行对齐 12 包终局，P2.7 ✅ 标注
- `docs/remaining-tasks.md`：头部决策状态、建议顺序/当前状态改为「已收口」；B2（C8 host）行改为已完成（C1 重评为「拆」）；§3 补决策修订注记
- `docs/crate-architecture.md`：头部状态刷新为 12 包终局；新增 **v0.11** 修订行（M6-9~12 自查整改闭环）；§3 Artifact 归属落定为独立包；§8 待决 2/4/5 补 `[已定]` 标注
- `examples/desktop-tauri/README.md`：「与拆包（C8 host）的关系」由未来态改写为现状（host 已拆且示例已接线）
- `docs/architecture.md`：§5.3 / §6.1 / §6.2 / §8.1 / §8.2 / §9 的 M2~M4 实现注记补「M6 已迁出至 `@agent-runtime/*`」追注（mcp / policy / sandbox / artifact / memory+checkpoint / host），避免按旧路径 `packages/core/src/*` 检索被误导
- `docs/m5-productization.md`：原则与 Desktop 明细中「未来若拆 C8 host」的未来态表述改为现状（host 已拆、示例已切子包导入）

**新增**：`docs/docmap-audit.md`（16 篇文档地图与一致性/缺失审计，含目录树、逐文档档案与交叉引用关系）。

**验收**：纯文档变更，无代码与公共 API 变化；`npm run typecheck` / `npm run check:api` 不受影响。

---

**M6-12 · 包元数据名实对齐**（2026-09-08，split 分支）：修正拆包（M6-9 / M6-10）后残留的过时描述——`@agent-runtime/memory` 的产物职责已归 `@agent-runtime/artifact`、`@agent-runtime/core` 已不含 session 与 provider 实现，两个包的 `description` 与 core facade 注释块同步至真实构成（memory = SessionMemory + Checkpoint/ToolSurface 契约；artifact 独立一行；core = 引擎 + 聚合出口）。
**验收**：纯描述/注释变更，无代码与公共 API 变化；`npm run typecheck` 绿，`npm run check:api` 0 差异。

### Changed（M6-12）
- `packages/memory/package.json`：description 去掉 ArtifactManager，改为 SessionMemory + checkpoint 设施，并注明产物归属 `@agent-runtime/artifact`
- `packages/core/package.json`：description 改为引擎真实构成（run loop / agent / context / EventBus / tool-model 契约 / 零依赖默认存储 / facade），去掉 session、providers
- `packages/core/src/index.ts`：facade 注释块对齐实际转发——memory 行改为 SessionMemory / Checkpoint（ToolSurface 契约），新增 `@agent-runtime/artifact` 独立行

---

**M6 · P1 审查归档（Docs，2026-09-08，split 分支）**：将 `docs/p1-review.md` 的 7+1 主题审查结论与 M6-9~M6-11 整改事实回填至架构决策文档，形成发布（Gate 4）前置的单一核对入口，并补齐审查中要求的防腐明示。
**交付**：`docs/architecture.md` v1.9 修订——§10 现状注记更新为 12 个 workspace 包视图（依赖方向、core 1005 行、事件可注入），§11 M6 行补 Gate 1 关闭与审查整改闭环，§13 追加 v1.9 行；`docs/api-surface.md` §1 补 types 防腐红线（只许契约声明 + 零 IO 纯函数）；新增 `docs/final-review.md`（最终审查与封板核对总表：7 项主题 + MCP-as-Tools，含决策证据出处与复核命令）。
**验收**：纯文档变更，无代码 / 公共 API 变化，`npm run check:api` 不受影响。

### Docs（M6 归档）
- `docs/architecture.md`：v1.9 修订——§10 / §11 / §13 同步 12 包与 M6-9~M6-11 整改事实
- `docs/api-surface.md`：§1 补 types 防腐红线（禁止 IO / 有状态逻辑 / 运行时内部依赖，超范畴能力下沉实现包）
- `docs/final-review.md`：新增——最终审查与封板核对总表（7+1 主题单一入口）

---

**M6-11 · 工程护栏：API 快照复核脚本化（P2-c）**（2026-09-08，split 分支）：闭环 `docs/p1-review.md` 遗留的 P2 建议「API 快照复核脚本化，纳入 CI 作业 `api-surface`」，落地 `docs/api-surface.md` §13 的复核要求。
**交付**：`scripts/check-api-surface.ts`（TS AST 解析各包 `dist/index.d.ts`，口径与冻结快照一致——本地 `export *` 递归展开、具名 re-export 计入、跨包 `export *` 仅记转发目标）+ 基线 `scripts/api-surface.baseline.json`。基线冻结并与 `docs/api-surface.md` 逐包符号全集对齐（types 47 / memory 14 / artifact 8 / sandbox 14 / policy 15 / core 49 + 5 转发 / tools-basic 4 / mock 1 / host 10 / mcp 28 / provider-openai 2 / store-sqlite 2）。
**门禁**：`npm run check:api` 复核（有差异退出码 1，按 §13 评审）；`npm run check:api:update` 评审通过后重新冻结。CI 作业 `api-surface`（P2.7）复用同一脚本，随 P2 总闸（`npm run ci`）接入。
**验收**：`npm run typecheck` 绿（含新增 `scripts/`）；`npm run check:api` 0 差异。

### Added（M6-11）
- `scripts/check-api-surface.ts`：API 表面提取器/复核脚本（`--summary` / `--update` / 默认复核）
- `scripts/api-surface.baseline.json`：公共导出面机读基线（12 包）

### Changed（M6-11）
- 根 `package.json`：新增 `check:api` / `check:api:update` 脚本
- `tsconfig.json`：`include` 增补 `scripts`
- `docs/api-surface.md` §13：快照复核标记为已脚本化；修订轨迹追加 M6-11
- `docs/m6-productionization.md`：P2 表新增 P2.7（api-surface CI 作业，脚本与基线已先行 ✅）
- `docs/p1-review.md`：P2「快照复核脚本化」标记 ✅ 已完成（M6-11）

---

**M6-10 · P1 审查整改（P2）**（2026-09-08，split 分支）：收尾 `docs/p1-review.md` 的 P2 级建议。
**P2-a checkpoint 归位**：`checkpoint.ts` 解耦 `Agent` 类——新增结构化契约 `ToolSurface { name, tools }` 取代 `computeToolsHash(agent: Agent)` / `assertResumable(ckpt, agent)` 对引擎类的依赖（`Agent` 结构上兼容，现有调用点无需改写）；随后迁入 C3 `@agent-runtime/memory`，测试随迁。core 由 1146 → **1005 行**，且因 facade 转发 memory，**从 core 导入 Checkpoint 符号仍可用（非破坏性）**。
**P2-b 事件总线可注入**：`AgentRuntimeOptions.events?` 与 `SessionManagerOptions.events?` 支持宿主创建并注入 `EventBus`（默认仍自建/复用 runtime 总线）；host 内部统一改用 `this.events`，不再借用 `runtime.events` 内部构件。
**P2-c 快照复核脚本化**：⏸ 未实施，随 P2（工程护栏）的 CI 作业落地。
**验收**：`npm run typecheck` 绿；全仓 `npm test` 0 fail（types 4 / memory 19 / artifact 8 / sandbox 13 / policy 13 / core 21+1skip / tools-basic 2 / host 8 / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-10）
- `AgentRuntimeOptions.events` / `SessionManagerOptions.events` / `SessionManager.events`：宿主可注入并持有事件总线
- `@agent-runtime/memory`：`CheckpointStore` 等 9 个 Checkpoint 符号 + `ToolSurface` 契约

### Changed（M6-10）
- `packages/core/src/checkpoint.ts` → `packages/memory/src/checkpoint.ts`（解耦 `Agent` 后归位 C3）
- `packages/core/src/index.ts`：移除自身 Checkpoint 导出（改由 facade 转发 memory）
- `packages/host/src/session.ts`：11 处事件发布改用 `this.events`；Checkpoint 导入改从 memory

### Docs（M6-10）
- `docs/api-surface.md`：按 12 包重新冻结（memory 14 / core 49 + 5 转发 / core 1005 行）
- `docs/p1-review.md`：P2 项状态更新

---

**M6-9 · P1 审查整改（P0 + P1）**（2026-09-08，split 分支）：依据 `docs/p1-review.md` 执行架构整改，解决「core 过重」「为拆包而人为分层」两类问题。
**P0 演示资产外置**：`MockProvider` → 新包 `@agent-runtime/mock`；`builtinTools` / `calculator` / `CURRENCY_ALIASES` / `CurrencyCode` / `evaluate` → 新包 `@agent-runtime/tools-basic`；core 移除对应实现与导出（公共面 -5、**1804 → 1146 行，-36%**）。
**P1-a 工具分类下沉**：`classifyToolName` / `toolKind` 由 sandbox 下沉 C1（`types/src/tools.ts`，属工具元数据推断而非执行域），sandbox 以 re-export 保持 API 不变；`mcp` 因此去掉对 sandbox 的依赖（现只依赖 core + types）。
**P1-b 产物独立**：`artifact.ts` 从 memory 包拆出为 `@agent-runtime/artifact`（memory 导出由 13 → 5，一包一职责），host 与 core facade 同步接线。
**破坏性变更**：从 core 导入 `MockProvider` / `builtinTools` / `evaluate` / `CURRENCY_ALIASES` / `CurrencyCode` 失效（改从 `mock` / `tools-basic`）；从 `memory` 导入 `Artifact*` 失效（改从 `artifact`）。
**验收**：`npm run typecheck` 绿；全仓 `npm test` 0 fail（types 4 / memory 9 / artifact 8 / sandbox 13 / policy 13 / core 31+1skip / tools-basic 2 / host 8 / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-9 · 整改新包）
- `packages/mock/`：`@agent-runtime/mock`（MockProvider 演示/测试模型后端）
- `packages/tools-basic/`：`@agent-runtime/tools-basic`（builtinTools / evaluate / CURRENCY_ALIASES / CurrencyCode）
- `packages/artifact/`：`@agent-runtime/artifact`（ArtifactManager 产物管理，原属 memory）
- `packages/types/src/tools.ts`：`classifyToolName` / `toolKind`（由 sandbox 下沉）

### Changed（M6-9 · 整改接线）
- `packages/core`：`providers/`、`tools/` 目录移出（演示资产）；facade 增加 artifact 转发
- `packages/memory`：仅保留会话记忆（剥离产物）
- `packages/mcp`：去掉 `@agent-runtime/sandbox` 依赖
- `packages/host`、`examples/cli.ts`、`examples/web/server.ts`、四处测试：导入源更新
- 根 `package.json` / `tsconfig.json`：build/test 与 paths 接入 3 个新包（共 12 个 workspace 包）

### Docs（M6-9）
- `docs/api-surface.md`：按 12 包重新冻结并标注依赖方向
- `docs/p1-review.md`：补记整改执行结果
- `README.md`：包结构与验证章节同步

---

**M6-8 · 公共 API 冻结快照（P1.6，Gate 1 关闭）**（2026-09-07，split 分支）：新增 `docs/api-surface.md`——用 TypeScript 解析各包 `dist/index.d.ts` 提取对外导出面，冻结 9 个 workspace 包的公共 API 基线（types 7 子模块聚合 / memory 13 / sandbox 14 / policy 15 / core 61 + 4 项 facade 转发 / host 10 / mcp 28 / provider-openai 2 / store-sqlite 2），记录依赖方向 `types ← {memory,sandbox,policy} ← core ← {host,mcp,provider-openai,store-sqlite}` 与「mcp、host 不被 core 反向 re-export」约束；并定义变更规则（新增=兼容；删除/重命名/收窄=破坏性，需 break-change 评审）与发布前快照复核要求（拟纳入 P2 的 CI 作业）。至此 **M6 P1（决策冻结 + 包边界收口）Gate 1 关闭**：P1.1~P1.6 全部完成。

### Added（M6-8 · API 冻结）
- `docs/api-surface.md`：9 个包的对外导出清单（冻结基线）+ 变更规则与评审流程

### Docs（M6-8）
- `docs/m6-productionization.md`：P1.6 完成、Gate 1 退出标准满足
- `docs/development-checklist.md`：P1 全部完成，M6 进入 P2~P6

---

**M6-7 · 拆包批次 B2（C8 host）**（2026-09-07，split 分支）：**修订 C1 决策**——原判定「不拆 host」的前提（memory/permission/artifact/sandbox 在 core 内与 session 互引）已随 B3/B4 消失，实测 core 内**无任何模块依赖 `session.ts`**，故恢复 C8：`session.ts`(721 行) + `session.test.ts` 外置为 `@agent-runtime/host`（`packages/host/`），依赖方向 **host → {core, memory, sandbox, policy, types}**，单向无环；`core/src/index.ts` 移除 Session/Task 导出（host → core，core 不可反向 re-export，与 mcp 同理）。**破坏性变更**：`import { SessionManager } from "@agent-runtime/core"` 失效，宿主需改从 `@agent-runtime/host` 导入——当前 0.x 且全部包 `private`（无外部消费者），为成本最低窗口。引用点已更新：`examples/cli.ts`、`examples/web/server.ts`、core/memory/mcp/sandbox 四处测试。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 33+1skip / **host 8** / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）；`examples/` 与四处测试的导入已全部切换到新包（运行时冒烟随 M6 P2 的自动化 E2E 覆盖）。

### Added（M6-7 · 拆包 B2）
- `packages/host/`：C8 `@agent-runtime/host`（`SessionManager` / `SessionError` 与 Session/Task/Run 类型）

### Changed（M6-7 · 拆包 B2 接线）
- `packages/core/src/index.ts`：移除 Session/Task 导出段（改指引注释）
- `examples/cli.ts` / `examples/web/server.ts`：`SessionManager` / `Session` 改从 `@agent-runtime/host` 导入
- `packages/{core,memory,mcp,sandbox}/test/*.test.ts`：`SessionManager` 改从 host 导入
- 根 `package.json` / `tsconfig.json`：build/test 与 paths 接入 host（序 …→core→host→mcp→…）
- `README.md`：会话管理示例与包结构同步

### Docs（M6-7）
- `docs/remaining-tasks.md`：C1 决策修订为「拆 host」，B2 恢复并完成
- `docs/crate-split-todo.md`、`docs/crate-architecture.md`：C8 状态与修订记录

---

**M6-6 · 拆包批次 B4（core facade 收窄）**（2026-09-07，split 分支）：`core/src/index.ts` 由各模块直出改为 **facade 聚合出口**——统一 `export *` 转发 C3 `@agent-runtime/memory`、C4 `@agent-runtime/sandbox`、C5 `@agent-runtime/policy`（**C6 mcp 不在此列**：其依赖方向为 mcp → core，反向 re-export 会形成循环，仍需 `import { McpRegistry } from "@agent-runtime/mcp"`）。宿主既可继续从 `@agent-runtime/core` 单点导入（兼容面不变），也可按需直连子包（推荐新代码）。`checkpoint.ts` 经评估仍留 core：`computeToolsHash` / `assertResumable` 依赖 core 的 `Agent` 类。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 41+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Changed（M6-6 · facade 收窄）
- `packages/core/src/index.ts`：新增 facade re-export 块（`export *` 转发 memory / sandbox / policy），移除原 memory/artifact/governance 指引注释

### Docs（M6-6）
- `docs/remaining-tasks.md`：B4 完成；checkpoint 留 core 原因更新为「依赖 `Agent` 类」
- `docs/crate-split-todo.md`：facade 行勾选完成
- `docs/crate-architecture.md`：修订记录 v0.9

---

**M6-5 · 拆包批次 B3（C4 sandbox + C5 policy）**（2026-09-07，split 分支）：`sandbox.ts` 外置为 `@agent-runtime/sandbox`、`permission.ts` 外置为 `@agent-runtime/policy`（C2 决策：独立两包），两个测试随迁。本批**触发 C4 决策的「出现循环即下沉」条件**：把工具契约（`ToolDefinition`/`AnyTool`/`ToolKind`/`ToolMeta`/`ToolExecutionContext`）与事件契约（`RuntimeEvent` 及全部事件接口）下沉 C1（新增 `packages/types/src/tools.ts` / `events.ts`）；core 对应文件改为「re-export 类型 + 保留实现」（`defineTool` / `EventBus` 仍在 core，core 内部与公共导入面不变）；`permission.ts` 对 `EventBus<RuntimeEvent>` 的依赖改为 C1 新增的 `EventEmitter<E>` 结构接口，避免 policy 反向依赖 core；`mcp` 的 `classifyToolName` 改由 `@agent-runtime/sandbox` 提供。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 41+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-5 · 拆包 B3）
- `packages/sandbox/`：C4 `@agent-runtime/sandbox`（`LocalSandbox` + `classifyToolName`/`toolKind`/`isPathAllowed`/`simpleDiff` 与 Sandbox 契约类型）
- `packages/policy/`：C5 `@agent-runtime/policy`（`PermissionManager` + `DefaultPermissionPolicy`/`StaticPolicy`/`combinePolicies`/`toolListPolicy`）
- `packages/types/src/tools.ts` / `events.ts`：工具契约与事件契约下沉 C1（含新增 `EventEmitter<E>` 最小发射接口）

### Changed（M6-5 · 拆包 B3 接线）
- `packages/core/src/tool.ts` / `events.ts`：类型改为从 C1 re-export，实现保留
- `packages/core/src/session.ts`：`LocalSandbox` / `PermissionManager` 改从新包导入
- `packages/core/src/index.ts`：移除治理实现导出，保留指引注释
- `packages/mcp/`：`classifyToolName` 改依赖 `@agent-runtime/sandbox`
- 根 `package.json` / `tsconfig.json`：build/test 与 paths 接入两个新包（序 types→memory→sandbox→policy→core→mcp→provider-openai→store-sqlite）

---

**M6-4 · 拆包批次 B3（C3 memory + artifact）**（2026-09-07，split 分支）：`memory.ts` + `artifact.ts` 外置为 `@agent-runtime/memory`（`packages/memory/`，仅依赖 types），`memory.test.ts` / `artifact.test.ts` 随迁；按 C3 决策把 `Artifact` / `ArtifactKind` / `ArtifactInput` 契约类型下沉 C1（新增 `packages/types/src/artifacts.ts`）；`session.ts` 改从新包导入，core `index.ts` 移除 memory/artifact 实现导出（类型经顶部 `export *` 转发，公共导入面不变）。**`checkpoint.ts` 暂留 core**：`computeToolsHash` / `assertResumable` 依赖 `Agent` 与工具契约（C4 决策未下沉），外置会形成 core ↔ C3 包级循环，待契约下沉或 B4 facade 收窄时再迁。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / core 67+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-4 · 拆包 B3）
- `packages/memory/`：新增 C3 `@agent-runtime/memory` 包（package.json / tsconfig.json / `src/index.ts`），承载 `SessionMemory` 与 `ArtifactManager`；依赖仅 @agent-runtime/types
- `packages/types/src/artifacts.ts`：`Artifact` / `ArtifactKind` / `ArtifactInput` 契约类型（C3 决策下沉）

### Changed（M6-4 · 拆包 B3 接线）
- `packages/core/src/session.ts`：`SessionMemory` / `Memory` / `ArtifactManager` / `Artifact` 改从 `@agent-runtime/memory` 导入
- `packages/core/src/index.ts`：移除 memory / artifact 实现导出，保留指引注释（类型面不变）
- 根 `package.json` / `tsconfig.json`：build/test 与 paths 接入 `@agent-runtime/memory`（build 序 types→memory→core→mcp→provider-openai→store-sqlite）

### Docs（M6-4）
- `docs/remaining-tasks.md`：B3 完成 + checkpoint 留 core 说明
- `docs/crate-architecture.md`：修订记录 v0.7

---

**M6-3 · Storage 契约下沉 C1（拆包 B3 前置）**（2026-09-07，split 分支）：把 `Storage` / `DocDomain` / `StreamDomain` 契约从 `core/src/store/types.ts` 下沉至 `@agent-runtime/types`（新增 `packages/types/src/storage.ts` 并由 index 导出），删除 core 内契约文件；core 内 6 处引用（`session` / `memory` / `checkpoint` / `artifact` / `store/memory` / `store/file`）改为从 types 导入，`core/src/index.ts` 经 `export * from "@agent-runtime/types"` 转发，**公共导入面不变**。目的：让 C3（memory/artifact）等外置包只依赖 types，消除 core ↔ 子包循环（C1/C3 决策的落地手段）。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / core 84+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-3 · 契约下沉）
- `packages/types/src/storage.ts`：`Storage` / `DocDomain` / `StreamDomain` 契约（原 `core/src/store/types.ts`，零依赖纯类型），`types/index.ts` 已导出

### Changed（M6-3 · 契约下沉接线）
- `packages/core/src/{session,memory,checkpoint,artifact}.ts` 与 `store/{memory,file}.ts`：Storage 契约改从 `@agent-runtime/types` 导入
- `packages/core/src/index.ts`：移除本地 Storage 导出（改由 `export * from "@agent-runtime/types"` 转发）
- `packages/core/src/store/types.ts`：删除（契约已下沉 C1）

---

**M6-2 · 决策落定 + 拆包批次 B1（C6 mcp）**（2026-09-07，split 分支）：落定 `remaining-tasks` C1~C4 四项开放决策——**C1** 不拆 C8 host（Session/Task 留 core，改以「Storage 契约下沉 C1」消除 core↔子包循环，B2 移出 M6）；**C2** sandbox/policy 独立两包（C4/C5，不合成 governance）；**C3** `Artifact` 类型下沉 C1、实现并入 C3（memory 包）；**C4** 工具契约 M6 暂不下沉（外置包依赖 core 的 `defineTool`/`ToolDefinition`）。据此执行批次 B1：`core/src/mcp/`（client/jsonrpc/registry/transport/types）与 `mcp.test.ts` + `fixtures/mock-mcp-server.mjs` 迁为 `packages/mcp/`（`@agent-runtime/mcp`），`registry.ts` 改从 core 取 `defineTool`/`classifyToolName`，core `index.ts` 移除 mcp 导出（避免 core↔mcp 循环），根 tsconfig paths / build / test 与 `examples/cli.ts` 接线。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / core 84+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-2 · 拆包 B1）
- `packages/mcp/`：新增 C6 `@agent-runtime/mcp` 包（package.json / tsconfig.json / `src/index.ts`），承载 MCP client、JSON-RPC、stdio+streamable HTTP 传输与 `McpRegistry` 物化；依赖 core 工具契约，方向单向

### Changed（M6-2 · 拆包 B1 接线）
- `packages/core/src/index.ts`：移除 MCP adapter 导出段（改由 `@agent-runtime/mcp` 提供），避免 core↔mcp 循环
- `examples/cli.ts`：`McpClient`/`McpRegistry`/`StdioTransport`/`StreamableHttpTransport`/`McpServerHandle` 改从 `@agent-runtime/mcp` 导入
- 根 `package.json` / `tsconfig.json`：`build`/`test` 脚本与 paths 接入 `@agent-runtime/mcp`（build 序 types→core→mcp→provider-openai→store-sqlite）

### Docs（M6-2 · 决策与状态回填）
- `docs/remaining-tasks.md`：C1~C4 决策结论与触发条件；B1 进行中→已完、B2 移出
- `docs/crate-split-todo.md`：C6 勾选完成、C8 移出、§5 决策点全部勾选、通用验收逐项确认
- `docs/crate-architecture.md`：§6 里程碑 M4 行更新 + 修订记录 v0.5
- `docs/m6-productionization.md`：P1.1 完成、P1.3（C8 host）移出
- `README.md`：验证章节同步新增 mcp 包

---

**M6-1 · 生产级改造执行清单入库**（2026-09-07，apps 分支）：demo 阶段（M1~M5）全部完成验证后，新增 `docs/m6-productionization.md`——demo → 生产级改造阶段执行清单。实测差距基线（无 CI/lint/LICENSE、4 包全 `private`、engines 不一致、拆包未收口、Web server 无鉴权、分发未签名）映射为 6 批 P1~P6：P1 决策冻结（C1~C4）+ 拆包收口（B1~B4）+ API 冻结（发布前置）；P2 CI/质量门（typecheck/lint/coverage ≥80%/跨形态 E2E/audit，收敛为 `npm run ci` 一键）；P3 可观测·安全·配置（结构化日志与错误码、事件脱敏、审批审计与白名单持久化、成本/速率上限、server 鉴权、MCP 防 SSRF、默认安全策略、config/features 吸收 D2）；P4 SDK 发布工程（LICENSE、去 private、engines 统一、changesets、`--provenance` 发布）；P5 分发与部署矩阵（macOS 公证、三平台产物、auto-updater、store-sqlite 生产基线、容器化样例）；P6 治理·文档（CONTRIBUTING/SECURITY、README 生产用法、路线图 v1.8 回填、双源收敛）。吸收重排 remaining-tasks A~C 并拉近 D2；执行约束 P1 先行且必须早于 P4。

### Docs（M6-1）
- `docs/m6-productionization.md`：新增 M6 生产级改造执行清单（来源：仓库实测差距 / remaining-tasks / crate-split-todo / architecture §11）

---

**M5-8 · 仓库更名引用同步**（2026-09-07，apps 分支）：GitHub 仓库 `0end1/nodeRuntimes` 更名 `0end1/nodeRuntime`（经 GitHub API 完成，旧地址自动 301）；同步根 `package.json` 三处仓库引用（`repository.url` / `homepage` / `bugs.url`）至新地址，本地 `origin` remote 同步更新。README / docs / CHANGELOG 顶部均为作者个人主页 `github.com/0end1`，不受影响。

### Changed（M5-8 · 仓库更名引用同步）
- `package.json`：`repository` / `homepage` / `bugs` 指向新仓库地址 `https://github.com/0end1/nodeRuntime`

---

**M5-7 · 遗留任务清单入库**（2026-09-07，dev 分支）：新增 `docs/remaining-tasks.md`——M5 产品化阶段收尾后的遗留任务总池索引（14 项分组总览表）：A 验收收口 4 项（安装分发实机验证 / 自动化 E2E / `typecheck`+`npm test` 质量门 / `architecture.md` §11 M5 行回填，源自 m5-productization #5 移交）、B 拆包批次 4 项（C6 mcp / C8 host / C3~C5 / facade 收窄，执行级细节以 crate-split-todo 为准）、C 开放决策 4 项（§8-5 host 归属 / §8-3 sandbox·policy 分合 / §8-4 Artifact 归属 / §8-2 契约下沉）、D 远期 3 项（Rust 移植 / config·features / 参考机制采纳）。建议执行顺序：决策先行 → 验收 → 拆包。

### Docs（M5-7）
- `docs/remaining-tasks.md`：新增 M5 收尾遗留任务总清单（来源：m5-productization #5 / crate-split-todo / crate-architecture §8 / architecture §11）

---

**M5-6 · Desktop 生产打包闭环（Tauri build + 自包含 sidecar）**（2026-09-07，dev 分支）：补齐并验证 Desktop 生产打包。`beforeBuildCommand`（`build-server.mjs`）用 esbuild 把 `examples/web/server.ts` 打成自包含 CJS bundle（`agent-server.js`），并复制 Node 运行时（`node-<triple>`）与静态控制台（`public/`）；app **自带 Node 运行时**（`externalBin: binaries/node`）执行 bundle（`resources`），静态资源一并平铺进 app，壳通过 `AGENT_CONSOLE_PUBLIC_DIR` 把 `Resources/public` 告知 server——不依赖目标机安装 Node。`tauri build` 产出 `.app`（123M）+ `.dmg`（42M），并以 app 自带 node + bundle 实跑验证 `GET :8787 → 200`（Mock provider 正常启动）。

### Added（M5-6 · 生产打包）
- `examples/desktop-tauri/build-server.mjs`：esbuild 打包 server（`import.meta.url` 在 CJS 下用 define + banner 注入等价实现）+ 复制 Node 运行时 + 复制静态资源

### Fixed（M5-6 · 生产打包验证）
- `src-tauri/tauri.conf.json`：`beforeBuildCommand` 接 `build-server.mjs`；`externalBin` 改 `binaries/node`（原 `agent-server` 缺 target triple 后缀导致 release 编译失败）；`resources` 平铺 `agent-server.js` 与 `public`（`frontendDist` 上越路径不被复制，app 内缺 `index.html`）；`frontendDist` 指向真实静态目录
- `src-tauri/src/lib.rs` + `Cargo.toml`：Tauri v2 sidecar 已迁至 `tauri-plugin-shell`（`tauri::process::Command` 不存在），改用 `app.shell().sidecar("node")` + args/env，新增 `tauri-plugin-shell` 依赖
- `examples/web/server.ts`：静态控制台目录支持 `AGENT_CONSOLE_PUBLIC_DIR` 覆盖（生产由壳指定 `Resources/public`，dev/demo 默认行为不变）
- `examples/desktop-tauri/package.json`：去掉 `"type": "module"`（无扩展名 sidecar 需按 CommonJS 解析）
- `src-tauri/tauri.conf.json`：`beforeDevCommand` 改 `npm --prefix ../../ run demo:web`（见 M5-4 Fixed）

---

**M5-5 · 刷新产品化可前置清单状态**（2026-09-07，dev 分支）：同步 `docs/m5-productization.md` 现状与清单状态——#3 Desktop 壳由 🟡 改为 ✅（壳 + sidecar + 图标已建、`cargo check` 通过，生产 externalBin 二进制打包归入 #5）；§1 现状补 `desktop-tauri/` 并标注 M2~M4 操作面缺口已通过 #1/#2/#3 补齐；§6 Desktop 验收细化 dev（`npm run tauri dev`）/ 生产（`tauri build` + sidecar 二进制）两条路径。

### Docs（M5-5）
- `docs/m5-productization.md`：§1 现状 + #3 状态 + §6 Desktop 验收刷新

---

**M5-4 · Desktop 壳（Tauri v2，含 sidecar + 图标）**（2026-09-07，dev 分支）：为 M5 交付物补 Desktop 壳，技术栈定为 **Tauri v2**。窗口加载 `examples/web` 控制台——`devUrl=http://localhost:8787`，`beforeDevCommand` 启 `npm run demo:web`（Node server 提供 API + 静态）。仅依赖 `core` 公共 API，未来 C8 host 不白做。release 构建以 Tauri sidecar 拉起 `agent-server`（窗口 `url` 固定 8787），dev/生产共用同一控制台；`bundle.externalBin` 待打包二进制后启用。已生成 `src-tauri/icons/`（tauri icon）。环境 `cargo 1.98`+`node v22`+Xcode CLI+@tauri-apps/cli 齐备，`cargo check` 通过。`docs/m5-productization.md` #3 状态由待定改为 Tauri 已定。

### Added（M5-4 · Desktop 壳 Tauri）
- `examples/desktop-tauri/package.json`：Tauri CLI 脚本（dev/build/tauri）
- `examples/desktop-tauri/src-tauri/Cargo.toml` `build.rs` `src/main.rs` `tauri.conf.json`：Tauri v2 应用骨架（窗口 label/url/尺寸、csp 放开 demo）
- `examples/desktop-tauri/src-tauri/src/lib.rs`：release 构建以 sidecar 启 agent-server，窗口加载控制台地址
- `examples/desktop-tauri/src-tauri/icons/`（tauri icon 多尺寸）+ `icon-source.png`：桌面图标资源

### Fixed（M5-4 · 验证）
- `examples/desktop-tauri/src-tauri/tauri.conf.json`：`beforeDevCommand` 由 `npm run demo:web` 改为 `npm --prefix ../../ run demo:web`（`demo:web` 脚本在根 package.json，Tauri 在 `examples/desktop-tauri/` 查找会 `Missing script: "demo:web"`）；`tauri dev` 现可正常拉起 `:8787` 控制台并创建窗口（2026-09-07 验证通过：`cargo` 编译 Tauri 运行时 → `Running target/debug/desktop-tauri` → `GET :8787` 200）。

### Docs（M5-4）
- `docs/m5-productization.md`：#3 状态改 Tauri 已定（骨架已建 + sidecar 接入），§5 技术栈待定点改为已定 Tauri，新增 #3 明细

---

**M5-3 · 产品化示例补齐（Web 演示面 + 存储后端演示 + 文档子系统化）**（2026-09-07，dev 分支）：为 `examples/web/` 控制台暴露 M1~M4 完整操作面——新增常驻 SSE 治理事件流 `/api/events`（`permission:request|approved|denied`、`sandbox:write`），前端渲染「需要授权」卡片（批准/始终允许/拒绝）与沙箱写入 diff；新增会话/artifact/checkpoint/resume 端点并配右侧栏承载。examples 支持 `--storage=sqlite`，验证 M5-1 外置包 `store-sqlite` 可即插即用（含 Node ≥ 22.13 校验）。README 补 M3/M2 事件与「能力参考（M1~M4）」小节。`npm run typecheck` 全绿，Web 端点 curl 验证通过。

### Added（M5-3 · Web 演示面 + 存储后端演示）
- `examples/web/server.ts`：新增 `/api/events` 常驻治理 SSE + `/api/approve` `/api/deny`；新增 `/api/sessions` `/api/new` `/api/artifacts` `/api/artifact/:id` `/api/checkpoints` `/api/resume`；storage 可选 `SQLiteStorage`（`--storage=sqlite`，Node ≥ 22.13 校验）；Web agent 并入 `demo_write_file`
- `examples/web/public/index.html`：审批卡片 + 沙箱写入渲染、侧栏（会话列表/切换、artifact 面板、续跑入口）、`EventSource` 常驻治理流与 `fetch` 驱动 resume
- `examples/cli.ts`：支持 `--storage=sqlite`（同款 Node ≥ 22.13 校验），验证外置 `store-sqlite` 包

### Docs（M5-3 · 文档子系统化）
- `README.md`：事件表补 `permission:*` / `sandbox:write` / `checkpoint:*`；新增「能力参考（M1~M4）」小节
- `docs/m5-productization.md`：#2 #4 #6 状态勾选完成，明细同步进度

---

**M5-2 · 产品化示例补齐（CLI 演示面）**（2026-09-07，dev 分支）：为 CLI demo 暴露 M3 治理面——新增演示写工具 `demo_write_file`（`kind: "write"`），让 M3 审批/沙箱在 demo 中可见。零侵入 core：工具经 `defineTool` 声明写类，由默认策略 gate 为 ask，沙箱校验路径并 emit `sandbox:write`（含 diff）；CLI 订阅 `permission:request` 与 `sandbox:write` 两条事件，run 阻塞等待授权时仍可接收 `/approve` `/deny`（事件驱动，不挂起）。`npm run typecheck` 全绿。

### Added（M5-2 · CLI 演示面）
- `examples/cli.ts`：新增 `demo_write_file`（`meta: { kind: "write", pathArgs: ["path"] }`）并入 agent 工具集，相对工作区写入文件；订阅 `sandbox:write` 展示工具名/路径/最佳努力 diff；启动提示加入「把结论写入 demo.txt（会触发授权）」

### Docs（M5-2 · CLI 演示面）
- `docs/m5-productization.md`：#1 状态勾选为「✅（CLI 完成）」，#1 明细补演示写工具，#5 注意点更新为「审批挂起风险已解除（CLI）」
- `docs/crate-split-todo.md`：新增 M5 拆包执行清单（C3~C6/C8/facade 跟踪，与 `docs/crate-architecture.md` §6 并行参考）

---

**M5-1 · 拆包收口 C7/C9**（2026-09-07，dev 分支）：`provider-openai` 与 `store-sqlite` 两个「接缝包」从 core 外置为独立 workspace 包。core 继续只留接缝（`ModelProvider` trait 与 `MockProvider`、`Storage` trait），不 import 具体后端——HTTP/IO（fetch）与 SQLite（`node:sqlite`，engine ≥22.13）不再拖累 core 的零依赖定位。examples 已切到新包导入。`npm run typecheck` + `npm test` 全绿。

### Added（M5-1 · 外置包）

- **C7 `@agent-runtime/provider-openai`**（`packages/provider-openai/`）：`OpenAIClientProvider`/`OpenAIClientOptions` 从 core 迁出（`packages/core/src/providers/openai-compatible.ts` 删除），core `providers/` 仅留 `MockProvider`；`examples/cli.ts`、`examples/web/server.ts` 改用新包导入
- **C9 `@agent-runtime/store-sqlite`**（`packages/store-sqlite/`）：`SQLiteStorage`（`node:sqlite` `DatabaseSync`，docs/blobs/streams 三表）按 `Storage` trait 实现，作为可选存储后端（`engines: node >=22.13.0`）

### Changed（M5-1 · 拆包）

- 根 `package.json` 的 build/test 纳入两新包；根 `tsconfig.json` paths 新增两包映射；`package-lock.json` 同步
- `packages/core/src/index.ts`：移除 `OpenAIClientProvider`/`OpenAIClientOptions` 导出，改注释说明外置（C7）

### Docs（M5-1 · 拆包）

- `docs/crate-architecture.md`：§6 里程碑表 M5 行标注「C7/C9 已落地、C8 host 与 facade 收窄待决」，§9 修订记录新增 v0.4
- README：`ModelProvider` / `Storage` 说明补充外置包来源；项目结构树新增 `provider-openai` / `store-sqlite` 两包

---

**M4 · 外部能力**（2026-09-07，dev 分支）：MCP client（stdio + streamable HTTP）+ `Artifact` 落地。沿用「引擎只留接缝、协议翻译在适配层」：MCP 的唯一接缝是 `ToolDefinition`——`McpRegistry` 把远端 server 物化为 `mcp__server__tool` 前缀的本地工具后，校验 / gate / sandbox / 错误回填与本地工具完全同路径；`mcp/` 与 `artifact.ts` 实现仍在 C2 内（C6 拆包随 M5，与 crate-architecture §6 一致）。`npm test` types 4 + core 99 通过 0 失败。

### Added（M4 · 外部能力）

- **MCP 适配层** `packages/core/src/mcp/`（architecture §5.3）：`jsonrpc.ts`（JSON-RPC 2.0 消息构造/解析 + `McpError`/`McpTimeoutError`/`McpConnectionError`）；`transport.ts`（`StdioTransport` spawn 子进程走行式协议、`StreamableHttpTransport` 用 fetch POST 并兼容 `text/event-stream` 与纯 JSON 两种响应解码）；`client.ts`（`McpClient` 实现 `McpServerHandle`：`initialize` 握手 + `notifications/initialized`、`tools/list`（含 cursor 分页）、`tools/call`、`close`，按请求超时拒绝）
- **McpRegistry 物化** `mcp/registry.ts`：注册即 connect + 枚举，把每个远端工具物化为本地 `ToolDefinition`（名字 `mcp__server__tool` 前缀防碰撞）；`normalizeSchema` 把 MCP inputSchema 归一化到引擎本地 JsonSchema 子集（剥掉 `$schema`/`title` 等）；敏感类由远端工具名 `classifyToolName` 推断、`pathArgs` 由 schema 中路径参数键识别；`execute` 透传 `tools/call` 并在远端 `isError` 时抛错让模型自纠；`unregister`/`resolve(ref)`/`closeAll`
- **测试基建**：独立实现的双 mock MCP server（stdio 子进程 fixture `test/fixtures/mock-mcp-server.mjs` + 进程内 HTTP server，均不与被测 client 共享协议代码），真实子进程与 HTTP 两条链路端到端
- **Artifact** `packages/core/src/artifact.ts`（architecture §8.1）：`Artifact`（kind `text`/`file`/`chart`/`mcp-resource`/`url`，mime 按 kind 归一化，`locator` = `blob:<key>` 或 url）；`ArtifactManager.save/get/list(sessionId, runId?)/readBytes/readText/remove` 全部基于 Storage；`DocDomain` 新增 `artifact`（元数据行入 KV，payload 入 Blob 域）
- **宿主集成**：`SessionManager` 新增 `artifacts` 门面（默认 over storage），`deleteSession` 级联清理会话的 artifact 元数据与 blob
- **测试**：新增 `mcp`（15 例：SSE/纯 JSON 双路径解码、远端错误透传、请求超时、协议版本协商拒绝、未连接拒绝、schema 归一化与路径参数键识别、前缀物化与 `resolve`、幂等注册、execute 透传、unregister 清理、真实子进程握手/枚举/调用、**runtime 端到端：模型调用物化 MCP 工具（§11 验收）**、SessionManager 默认治理放行无害 MCP 工具）与 `artifact`（8 例：文本/二进制往返、url 无 payload、mime 覆盖与 upsert、按 run 过滤、remove 幂等、输入校验、deleteSession 级联清理）用例

### Changed（M4 · 外部能力）

- `Storage.DocDomain` 新增 `artifact`；`SessionManager` 增加 `readonly artifacts`

### Docs（M4 · 外部能力）

- `docs/architecture.md`：§2 模块表 `MCP`/`Artifact` 标 ✅ M4，§5.3 / §8.1 补实现注记，§11 M4 行标 ✅，§13 修订记录新增 v1.6 (M4)
- `docs/crate-architecture.md`：§6 里程碑表 M4 行标注「功能已在 C2 内落地，C6 拆包留待 M5」
- README：核心概念表新增 `MCP` / `Artifact` 说明

---

**M3 · 治理**（2026-09-07，dev 分支）：`Permission` 授权决策（allow/deny/ask 审批流）+ `Sandbox` 运行层执行域落地。沿用「引擎只留接缝、宿主注入策略与执行域」的分层：引擎新增 `RunOptions.gate` 单一授权调用点，`sandbox.ts`/`permission.ts` 实现仍在 C2 内（C4/C5 拆包随 M5，与 crate-architecture §6 一致）。`npm test` types 4 + core 77 通过 0 失败。

### Added（M3 · 治理）

- **Permission** `packages/core/src/permission.ts`（architecture §6.1）：`ToolKind` 敏感分类（无害 / 只读网络 / 写 / 执行 / 凭据，`ToolDefinition.meta.kind` 声明，缺省按工具名归类）；`DefaultPermissionPolicy` 按 `ToolKind × SandboxMode` 决策矩阵（写/执行在 read-only 档 deny、可写与全权限档 ask；凭据全档 deny）；`PermissionManager.gate/approve/deny` 审批流，ask 挂起等宿主、**超时=按拒绝处理**；`approve({ always: true })` 沉淀会话级白名单；`combinePolicies` 多策略命中取最严（对齐 codex execpolicy）；`StaticPolicy`/`toolListPolicy` 便捷策略
- **Sandbox** `packages/core/src/sandbox.ts`（architecture §6.2）：`Sandbox.begin(mode, scope, ctx)` 建立 Run 执行域；`LocalSandbox` 对每个工具执行：read-only 档拦截副作用类、`scope.network === "deny"` 拦网络类、写工具 path 越界拒绝（`isPathAllowed` + `pathArgsOf`）、每调用超时（默认 30s）、写类工具执行后发 **`sandbox:write`（含尽力行级 diff，`simpleDiff`）**——拦截抛 `SandboxViolationError`/`SandboxTimeoutError`，由引擎回填给模型自纠
- **引擎接缝** `runtime.ts`：`RunOptions.gate`（每次工具执行前调用，拒绝理由回填为工具错误）；新增 `permission:request/approved/denied`（§7 已预留的 `timedOut` 字段落地）与 `sandbox:write` 事件
- **宿主默认治理** `session.ts`：默认注入 `LocalSandbox`（`workspace: cwd`、`network: deny`、`sandboxMode: workspace-write`）与 `PermissionManager`（发布到统一总线）；每个 run 绑定一次执行域并把工具 wrap 后再交给引擎；公开 `pendingApprovals()` / `approve(decisionId, { always })` / `deny(decisionId)`
- **测试**：新增 `permission`（13 例：决策矩阵、ask 审批 / 拒绝 / **超时即拒**、`approve({always})` 记住白名单、迟到审批被忽略、`combinePolicies` 最严胜出）与 `sandbox`（13 例：分类、越界判定、三档边界、禁网与放行、路径逃逸拒绝且未落盘、超时、写 diff、集成：read-only 拒 exec 并回填模型、**write ask → approve → 落盘 + `sandbox:write` diff**、**策略 allow 过不了 read-only 沙箱**（纵深防御））用例

### Changed（M3 · 治理）

- `ToolDefinition` 新增可选 `meta: { kind?: ToolKind; pathArgs?: string[] }`；内置演示工具（weather/geocode/exchange）读本地静态数据，按 harmless 处理（修正 §6.2 旧"归入只读网络"表述）

### Docs（M3 · 治理）

- `docs/architecture.md`：§2 模块表 `Permission`/`Sandbox` 标 ✅ M3，§6.1/§6.2 补实现注记与口径确认，§11 M3 行标 ✅（验收全自动化），§13 修订记录新增 v1.5 (M3)
- `docs/crate-architecture.md`：§6 里程碑表 M3 行标注「功能已在 C2 内落地，C4/C5 拆包留待 M5」
- README：核心概念表新增 `Permission` / `Sandbox` 说明

---

**M2 · 记忆与续跑**（2026-09-07，dev 分支）：`Memory` 门面 + 步级 `Checkpoint` + `resume()` 续跑落地。引擎只新增「每步快照回调」一个扩展点，落盘与编排仍在宿主 `session.ts`（与 `docs/crate-architecture.md` §6「先做功能、后做拆包」一致：C3 拆包留待 M5）。`npm test` 54 通过（types 4 + core 50）0 失败。

### Added（M2 · 记忆与续跑）

- **Memory 门面** `packages/core/src/memory.ts`（architecture §8.2）：`SessionMemory` 同时提供会话层（对话流，复用 per-session 追加式消息流，跨实例/重启可读）与长期事实层 `remember/recall`（每会话一个 KV 文档，`recall` 为零依赖词面 + CJK bigram 打分，后续可换向量后端而不动引擎）
- **Checkpoint** `packages/core/src/checkpoint.ts`（architecture §9）：步级快照（`messages` + `usage` + `agentSnapshot{agentId, toolsHash}`）；`CheckpointStore` 提供 save/load/listByRun/listByTask/latest；`computeToolsHash` 生成与工具顺序无关的稳定指纹，`assertResumable` 在工具集漂移时抛 `CheckpointMismatchError`
- **宿主续跑** `SessionManager.resume(checkpointId, continuation?)`：载入 checkpoint → 校验 toolsHash → 重放 transcript 继续跑同一 task；新 run 记录 `parentCheckpointId`，无 `continuation` 时不追加用户轮次，保证续跑 transcript 与一次性跑完逐条一致
- **每步增量落盘**：run 每完成一步即把新增消息追加进消息流并写一份 checkpoint（M1 为 run 结束后一次性落盘），中断/崩溃至多丢失一步
- **引擎扩展点** `runtime.ts`：`RunOptions.onStepEnd`（步级快照回调，宿主据此落 checkpoint）、`initialUsage`（续跑累加用量）、`appendUserMessage`（续跑不重复插入用户轮次）；新增 `StepSnapshot` 类型
- **事件**：`checkpoint:saved`（每步）、`checkpoint:restored`（续跑起跑）并入统一总线
- **存储域扩展**：`DocDomain` 新增 `checkpoint`（步级快照文档）与 `memory`（每会话长期事实 KV）；`deleteSession` 一并清理二者
- **测试**：新增 `memory`（9 例：顺序 / `limit` / 跨实例 / 坏行容错 / 会话隔离 / 事实层读写覆盖）与 `checkpoint`（10 例：指纹稳定性与工具漂移、CheckpointStore 增删改查、每步 checkpoint、**中断后续跑等价新跑**（§11 M2 验收）、重启后由新 manager 续跑、continuation 追加、工具漂移拒绝续跑、删除清理）用例

### Changed

- `SessionManager` 的 run 编排重构为 `prepareRun` / `executeRun` / `finishTask`：事务准备（会话关闭/并发锁、置 running）与执行分离；`RunRecord` 新增 `checkpointId` / `parentCheckpointId`；`messages()` 与新增的 `memory(sessionId)` 统一由 Memory 门面提供

### Docs

- `docs/architecture.md`：§2 模块表 `Memory`/`Checkpoint` 现状标 ✅ M2，§8.2 / §9 补实现注记，§11 路线图 M2 行标 ✅，§13 修订记录新增 v1.4 (M2)
- README：核心概念表新增 `Memory` / `Checkpoint` / `resume` 说明
- `docs/crate-architecture.md`：§6 里程碑表 M2 行标注「功能已在 C2 内落地，C3 拆包留待 M5」

## [v0.2.0] - 2026-09-05

**M1 · 生命周期 + C1/C2 workspace 收敛**（正式发布，dev 合并 main，commit `06edd1a`）：M1 完成 Session/Task/Run 实体化、统一持久化层与运行时上下文注入；在此基础上把代码收敛为 npm workspaces monorepo（C1 `@agent-runtime/types` 叶子包 + C2 `@agent-runtime/core` 引擎包）。`npm test` 35 通过 0 失败。

### Added（M1 · 生命周期）

- **Storage 抽象** `store/`（随包迁入 C2 `packages/core/src/store/`）：统一持久化门面（文档域 `saveDoc/loadDoc/listDocs/deleteDoc`、Blob 域、追加式流域），内置 `MemoryStorage`（核心，零依赖）与 Node 版 `FileStorage`（按 domain 落目录，JSON/NDJSON 行式，写入走临时文件 + rename 原子化）
- **Session / Task / Run 实体化** `session.ts`（随包迁入 C2 `packages/core/src/session.ts`）：`SessionManager` 管理会话生命周期（create/list/close/delete，支持外部指定 id、首轮自动标题），`Task` 状态机 created→running→done/failed/cancelled，Run 落库为 `RunRecord` 实体
- **会话级持久化消息流**：每次对话自动把新产生的消息追加到 storage，`history` 不再由调用方手动维护；进程重启后基于同一 storage 恢复会话即可携带完整上下文继续
- **Context 门面** `context.ts`：`buildRunContext` 注入运行上下文（conversation/run/session/task + now），runtime 主循环与工具执行统一使用
- **事件契约扩展**：`session:created/updated/closed`、`task:created/status` 并入统一总线（新增事件均为追加，既有 run 级事件不变）
- **examples 演进**：CLI（会话持久化到 `.runtime-data/`，新增 `/new` `/list` `/use <id>`，重启自动续最近会话）；Web 控制台（RUNTIME_DATA 目录持久化，浏览器 localStorage 固定会话跨刷新/跨服务重启恢复）
- **测试**：新增 `store`（Storage 契约双实现 13+1 例）与 `session`（生命周期 / 重启恢复 / 并发锁 / 事件序）用例；全量 `npm test` 35 通过

### Changed

- 运行时版本升至 `v0.2.0`，代码迁移至 npm workspaces monorepo 包（C1/C2）
- `src/` 死代码清理（2026-09-05）：移除无消费方的 `prettyJson` 与演示工厂 `createDemoAgent`；`builtin.ts` 5 个内置工具改为模块私有常量（仅经 `builtinTools` 暴露）、`CURRENCY_ALIASES` 改 `export const` 消除重复导出；`schema.ts` 精简恒等三元判断；公共 API 其余导出不变
- **C1/C2 收敛为 npm workspaces monorepo**（v0.2-with-workspaces，2026-09-05）：根包改 workspace 容器（`workspaces: ["packages/*"]`），按 `docs/crate-architecture.md` §7.1 方案 A 拆分——契约层（`schema/types/util`）入 C1 叶子包 `@agent-runtime/types`（零依赖），引擎实现（runtime/agent/context/events/session/tool/provider/tools/providers/store）入 C2 `@agent-runtime/core`（显式依赖 C1）；`packages/core/src/index.ts` 顶部 `export * from "@agent-runtime/types"` 保持公共 API 兼容；`examples` 与各包测试改为从包名导入；测试随包迁移（schema→types/test，runtime/session/store/calculator→core/test）；删除旧根 `test/`、`src/`、`tsconfig.examples.json`；`npm run typecheck` / `npm run build` / `npm test`（types 4 + core 31，1 有意 skip）全绿

### Docs

- 在 README / `docs/architecture.md` / CHANGELOG.md 中统一标注文档作者信息：wangzhiyong · GitHub：0end1 · 联系邮箱：y1378379002@gmail.com
- README：新增 `SessionManager` / `Storage` 概念、会话管理示例（M1）、事件表补充 session/task 事件、项目结构与提示更新
- `docs/architecture.md`：模块表"现状"列、路线图 M1 行标记为 ✅ 已完成；修订记录新增 v1.1 (M1)
- `docs/architecture.md` §6/§7/§11 修订（v1.2，2026-09-05）：**Sandbox 由工具装饰器升格为运行层执行域边界**——引入 `SandboxMode` 三档（read-only / workspace-write / full-access，对齐 Codex）与 `SandboxScope`（workspace 可写域、网络默认禁网、环境变量精简），文件/命令访问先过 `gate()`、越界 deny，写操作发布 `sandbox:write`（含 diff）事件；`PermissionContext` 携带 sandbox 边界；Run 循环增加 `sandbox.begin()`；路线图 M3 验收更新
- 新增 `docs/codex-reference.md`（2026-09-05）：**Codex-rs 可借鉴实现清单**——按 nodeRuntimes 里程碑（M3 沙箱/审批、M2 持久化、M4 MCP、模型切换层、多 Agent 前瞻）映射 `codex-rs` 各 crate 的机制与关键源码落点；仅作独立参考，不并入 architecture.md
- 新增 `docs/crate-architecture.md`（v0.1，2026-09-05）：**crate 化边界与依赖图草案**——按 codex-rs workspace 形态把 `architecture.md` §2 模块树重排为 types 底座 + 单颗零依赖 core + 外置接缝包（memory/sandbox/policy/mcp/provider/store-sqlite）+ host + apps（C1~C9+A1 映射表、依赖图、边界规则、npm workspaces 与 Rust workspace 形态对比与待决清单）；纯设计研究，不改代码
- `docs/crate-architecture.md` 升 v0.2（2026-09-05）：标注 §7.1 方案 A 已落地（C1/C2 两包、C2 re-export C1、测试随包、paths 别名 typecheck + 逐包 build/test），§5.5 测试归属、§8 待决项 #1/#6 决策状态与修订记录同步更新
- `docs/architecture.md` 修订（v1.3，2026-09-05）：§10 目标目录结构下加 C1/C2 已落地现状注记，路线图 M0 行与修订记录补充 workspace 化说明

## [v0.1.0] - 2026-09-04

首个可运行版本：从零实现的最小 Agent 运行时（TypeScript / Node.js，零第三方运行时依赖），并附架构演进设计。

### Added

- **引擎核心**：ReAct 式多步推理事件循环（`AgentRuntime.run`），支持
  - 模型决策 → 工具调用 → 结果回填 → 继续推理 → 最终回答的完整闭环
  - 本地 JSON Schema 参数校验（工具失败自动回填错误，模型可自纠）
  - 未知工具 / 工具异常 / 重复工具名 的健壮处理
  - `maxSteps` 上限防死循环、`AbortSignal` 中止支持
- **事件总线**：类型化 `EventBus`，覆盖 run / step / model / tool / error 全生命周期事件，UI 与日志可流式还原推理过程
- **工具系统**：`ToolDefinition` 抽象（名称 + 描述 + JSON Schema + `execute`）
  - 内置 `calculator`（Pratt 解析安全求值，绝不使用 `eval`）
  - 演示工具集 `now` / `geocode` / `weather` / `exchange`
- **模型接入层**：`ModelProvider` 接口
  - `OpenAIClientProvider`：兼容任意 OpenAI 兼容端点（OpenAI / DeepSeek / 通义千问 / Ollama）
  - `MockProvider`：免密钥规则模型，离线可演示完整多步推理
- **演示**：交互式终端 CLI（`demo:cli`）、SSE 流式 Web 控制台（`demo:web`，内存会话）
- **Schema 校验器**：零依赖 JSON Schema 子集实现
- **测试**：node:test 自动化测试 14 例（事件循环 / 多步推理 / 工具安全 / 参数校验 / 中止）

### Docs

- **架构设计文档** `docs/architecture.md`：目标产品架构（Desktop / Product Host / Runtime / Storage 分层）与 Runtime 模块树（Session / Task / Run / Step、Context / Model / Tool / MCP、Permission / Sandbox、Event / Memory / Artifact / Checkpoint / Persistence）的接口草案与演进路线图 M0~M5
- README：快速开始、核心概念、事件表、运行验证指南
