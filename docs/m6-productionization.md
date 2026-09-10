# M6 生产级改造执行清单（Production-Grade Upgrade）

> 记录时间：2026-09-07
> 定位：**阶段执行清单**。前置 demo 阶段（M1~M5：生命周期引擎 → 记忆/续跑 → 审批/沙箱治理 → MCP/Artifact → CLI/Web/Desktop 产品化与打包验证）已全部完成，本清单承接"**demo → 可用于生产的项目**"改造，分 6 批（P1~P6）逐项可勾选。
> 事实源与同步：本计划**吸收并重排** `docs/remaining-tasks.md` 的 A（验收收口）/B（拆包批次）/C（开放决策）/D（远期）——C 决策提前到 P1 冻结、B 拆包作为发布前置在 P1 收口、A1/A2/A3 分别落入 P5/P2/P2、A4 落入 P6、D2 config/features **拉近**至 P3、D1/D3 维持远期。执行级细节仍以各自源清单为准（`crate-split-todo.md`、`crate-architecture.md` §8）；完成时**回填本文 + 源清单 + CHANGELOG 同一 commit**（延续维护约定）。
> **回填（2026-09-10）——桌面端移出底座**：底座收敛**取消桌面端**，`examples/desktop-tauri/`、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs` 与 **P5.1~P5.4 整体移出底座范围，方向与投入归产品侧**（判定见 `docs/base-convergence.md` §2.3；产品侧承接见 `docs/product-direction.md` §4）。本文 §5 的「挂起决定」据此**修订为「移出决定」**：P5.1~P5.4 不再是底座的保留项，Gate 5 的底座交付物仅剩 P5.5 / P5.6（均已完成）；P5.5（`store-sqlite` 生产基线）与 P5.6（Web 容器交付）属底座，不受移出影响。

---

## 0. 生产化差距基线（2026-09-07 盘点）

| 维度 | 现状 | 缺口 |
|---|---|---|
| 工程护栏 | 仅 `typecheck`/`test` 脚本，无 CI、无 lint、无 format | 无 PR 必绿门禁、无覆盖/审计门 |
| 包形态 | 4 包全 `private: true`、version 0.2.0、内部互依固定版本 | 无法对外发布，无版本编排 |
| 运行环境 | 根 `node>=18.17` vs `store-sqlite>=22.13`（node:sqlite）不一致 | engines 口径未统一 |
| 模块边界 | C6 mcp/C8 host/C3 memory/C4 sandbox/C5 policy 仍在 core 内 | 对外发布前需拆包收口（facade 收窄） |
| 可观测性 | 事件流完备，无结构化日志/错误码/成本上限 | 生产排障与成本控制缺位 |
| 安全 | 有沙箱/审批矩阵，但 Web server 无鉴权、事件载荷无脱敏 | 本地/远程 API 面需加固 |
| 测试 | node:test 逐包，无覆盖率门禁、无跨形态 E2E | 覆盖阈值与 A2 E2E |
| 分发 | macOS .app/.dmg 打包验证通过 | 无签名/公证、无三平台矩阵、无自动更新 |
| 治理 | 无 LICENSE/CONTRIBUTING/SECURITY | 开源发布治理文件缺失 |

---

## 1. P1 · 决策冻结 + 包边界收口（发布前置，Gate 1）

目标：在**任何对外发布之前**落定开放决策并拆完包，冻结公共 API 面，此后不因拆包产生破坏性变更。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P1.1 | 落定 remaining-tasks C1~C4 四项开放决策 | 决策记录回填 `remaining-tasks.md` §3 + `crate-architecture.md` §8 | 四项各有结论与影响行 | ✅（2026-09-07：C1 经重评**修订为拆 host** / C2 独立两包 / C3 类型下沉 C1 + 实现并 C3 / C4 **已触发下沉**：工具 + 事件契约入 C1；2026-09-08 追注：C3 的 Artifact 实现于 M6-9 自查后**独立成包**，见 `p1-review.md` §3.1） |
| P1.2 | 拆包批次 B1：C6 `@agent-runtime/mcp` | 迁移 `core/src/mcp/` + `core/test/mcp.test.ts` | 新包独立 typecheck/测试绿 | ✅（mcp 15 pass） |
| P1.3 | 拆包批次 B2：C8 `@agent-runtime/host` | 迁移 `core/src/session.ts`(721 行) + `session.test.ts` | 单向依赖 host → core，无环 | ✅（原「移出」经重评恢复并完成：host 8 pass，`SessionManager` 导入源变更为破坏性变更并已切换全部引用点） |
| P1.4 | 拆包批次 B3：C3 memory / C4 sandbox / C5 policy | 迁移对应 src+test | 同上 | ✅（memory 17 / sandbox 13 / policy 13 pass） |
| P1.5 | 拆包批次 B4：core facade 收窄 | `core/src/index.ts` 改逐包 re-export | 全仓测试绿、examples 导入经 facade 兼容 | ✅（re-export memory/sandbox/policy；mcp 与 host 因方向所限不反向 re-export） |
| P1.6 | 公共 API 冻结快照 | 记录每包对外导出清单（人工清单或 api-extractor 报告）至 docs | 后续变更需走 break-change 评审 | ✅（`docs/api-surface.md`：12 包导出面 + 变更规则 + 发布前复核要求；M6-11 起由 `npm run check:api` 脚本比对基线，见 P2.7） |

**Gate 1 退出标准**：`remaining-tasks.md` A~C 全部 ☑；全仓 `typecheck` + `npm test` 绿；API 快照入库；`examples/` 三种形态在拆分后全流程可用。

> **进度（2026-09-07，split 分支）——Gate 1 已关闭**：P1.1~P1.6 全部完成。9 个 workspace 包（types / memory / sandbox / policy / core / host / mcp / provider-openai / store-sqlite，含 C1 重评后新增的 C8 host），依赖单向无环；全仓 `typecheck` 绿、`npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 33+1skip / host 8 / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）；公共 API 冻结快照已入库 `docs/api-surface.md`。后续进入 **P2 工程护栏**。
>
> **追注（2026-09-08，M6-12）——12 包终局**：M6-9~11 自查整改在 P1 拆包基础上又完成两件外置与两处归位——`Artifact` 自 memory 拆为独立包 `@agent-runtime/artifact`（M6-9）、`MockProvider` 与内置工具分别外置为 `@agent-runtime/mock` / `@agent-runtime/tools-basic`（M6-9）、checkpoint 归位 memory（M6-10）、`classifyToolName` 下沉 C1（M6-9/11）；`core` 收窄至 1005 行。Gate 1 口径现按 **12 包** 计（新增 artifact/tools-basic/mock），依赖仍单向无环，`npm run check:api` 0 差异。P2.7 快照复核脚本已随之落地（M6-11）。

## 2. P2 · 工程护栏与质量门（Gate 2）

目标：所有改动经 CI 校验；质量要求代码化而非靠自觉。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P2.1 | GitHub Actions CI 主流程 | `.github/workflows/ci.yml`：PR/推送触发，job=typecheck→lint→test→build（matrix Node 覆盖支持区间） | 每个 PR 全绿才可合并 | ✅（2026-09-08）：`.github/workflows/ci.yml` 三个 job —— `quality`（typecheck→lint→test→build→`check:api`，Node 22.x）、`coverage`（报告，不设门槛）、`audit`（`npm audit --omit=dev --audit-level=high`）；matrix 暂固定 22.x（`@agent-runtime/store-sqlite` 依赖 `node:sqlite` ≥22.5，engines 统一待 P4.3） |
| P2.2 | Lint/Format 基线 | ESLint + Prettier 配置 + `lint`/`format` 脚本入根与各包 | CI 含 lint job；`npm run lint` 0 error | ✅（2026-09-08）：`eslint.config.js`（ESLint 9 flat config + typescript-eslint）+ `.prettierrc`/`.prettierignore`；脚本 `lint`/`lint:fix`/`format`/`format:check` 入根（一次跑全仓，避免 12 包重复配置）；首次全仓格式化已执行，`npm run lint` 0 error 0 warning |
| P2.3 | 覆盖率门禁 | 每包 `node --experimental-test-coverage`（或 c8）阈值 ≥ 80%（语句/分支），低水位区经评审豁免 | CI 覆盖 job 全绿 | ✅（2026-09-08，M6-16）：① 统计口径修正为**只统计本包**（`--test-coverage-include=src/**\|dist/**`，消除依赖包 dist 拉低）；② 补齐 `types`（util/tools 纯函数）与 `tools-basic`（now/geocode/weather/exchange）测试；③ 阈值定档 —— 逐包 行≥80 / 分支≥60 / 函数≥55，全仓均值 行≥90 / 分支≥78 / 函数≥85；④ `npm run coverage:gate` 阻断，已接入 `npm run ci` 与 CI `coverage` job（纯报告仍用 `npm run coverage`） |
| P2.4 | 跨形态自动化 E2E（吸收 A2） | `scripts/e2e/`：CLI → Web → Desktop 全流程脚本化（新会话→对话→ask 审批→approve 落盘→artifact→续跑）；作为 CI 独立 job（Desktop 用 headless/受控启动） | CI E2E job 通过；本机脚本 `npm run e2e` 可跑 | ✅（2026-09-08，M6-17）：`scripts/e2e/`（lib + cli/web/desktop + run-all）；CLI + Web 两形态全流程验证通过（14 步），`npm run e2e` 可跑并接入 CI `e2e` job；Desktop 形态默认跳过（需 Tauri/Rust 环境，设 `E2E_DESKTOP=1` 启用，见 `scripts/e2e/desktop.mjs`） |
| P2.5 | 依赖审计门 | CI job `npm audit --omit=dev`；`package-lock.json` 提交并校验 | 高危 0 阻断；变更记录在案 | ✅（2026-09-08）：CI `audit` job 已配 `npm audit --omit=dev --audit-level=high`；`package-lock.json` 在库，当前 0 vulnerabilities |
| P2.6 | 质量门总闸固化（吸收 A3） | 上述脚本集合为 `npm run ci`（typecheck+lint+test+coverage+build） | `npm run ci` 一键全绿 | ✅（2026-09-08）：`npm run ci` = `typecheck && lint && test && coverage && check:api`（`test` 的 `pretest` 已含 build），本地一键全绿 |
| P2.7 | API 表面复核（P1 审查建议，防公共面漂移） | `scripts/check-api-surface.ts` 以冻结口径提取各包 `dist/index.d.ts` 导出面，与基线 `scripts/api-surface.baseline.json` 比对；脚本 `npm run check:api` | CI job `api-surface`（build 后运行）全绿；变更按 `docs/api-surface.md` §13 评审 | ✅ 脚本 + 基线已落地（M6-11），已随 P2.6 接入 `npm run ci` 与 CI `quality` job |

> **进度（2026-09-08，M6-17）**：P2.1 / P2.2 / P2.3 / P2.4 / P2.5 / P2.6 已完成，P2.7 随总闸接入 CI；**Gate 2 关闭**。P2.4 跨形态 E2E 已落地（CLI + Web 全流程验证通过、CI `e2e` job 接入；Desktop 形态默认跳过，需 Tauri/Rust 环境）。
>
> **覆盖率水位（口径修正后 + 补测后，2026-09-08）**：11 个包有测试（`@agent-runtime/mock` 无 `test/*.test.ts`，跳过）；列顺序为 Node 22 内置输出的行 / 分支 / 函数；统计范围为**本包** `src` 与 `dist`。
>
> | 包 | 行% | 分支% | 函数% |
> | --- | --- | --- | --- |
> | types | 85.67 | 87.21 | 73.68 |
> | memory | 96.39 | 84.93 | 90.91 |
> | artifact | 100.00 | 98.08 | 100.00 |
> | sandbox | 100.00 | 84.21 | 100.00 |
> | policy | 98.17 | 77.14 | 96.00 |
> | core | 86.51 | 72.79 | 90.91 |
> | tools-basic | 84.86 | 76.38 | 80.00 |
> | mock | —（无测试） | — | — |
> | host | 81.69 | 66.23 | 74.36 |
> | mcp | 90.53 | 64.74 | 90.41 |
> | provider-openai | 92.35 | 73.13 | 90.91 |
> | store-sqlite | 100.00 | 100.00 | 100.00 |
> | **全仓均值** | **92.38** | **80.44** | **89.74** |
>
> **口径修正说明（重要）**：首测（M6-14）把**依赖包的 dist** 计入本包统计，导致数值严重失真（例如 `policy` 自身 `permission.js` 已达 98.13%，却被 `types/dist/*.js` 拉低到 34.65%；`artifact.js` 实为 100%）。M6-16 起以 `--test-coverage-include=src/**\|dist/**` 只统计本包，水位如上。
>
> **分支低水位豁免（经评审）**：`mcp` 64.74 / `host` 66.23 / `core` 72.79 / `provider-openai` 73.13 / `tools-basic` 76.38 / `policy` 77.14 低于文档口径的 80%，本期按 60% 门槛通过；提升路径：下一档 分支 ≥70（补边界用例），最终目标 ≥80。

**Gate 2 退出标准**：任一 PR 未过 `ci.yml` 无法合入；无 lint error；覆盖率达标（逐包 行≥80 / 分支≥60 / 函数≥55，全仓均值 行≥90 / 分支≥78 / 函数≥85）；E2E 脚本在 CI 通过（P2.4 ☐）。

## 3. P3 · 可观测性 · 安全加固 · 配置驱动（Gate 3）

目标：运行时"看得见、管得住、配得动"，堵住本地/远程 API 与密钥泄露风险。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P3.1 | 结构化日志 + 错误码 | 包内 Logger 接口（可注入/默认 console）；错误分级与错误码枚举贯穿 events/CLI/HTTP 响应 | 宿主可注入 logger；错误码到文案映射表入库 | ✅（2026-09-08，M6-18）：`Logger`/`ConsoleLogger`/`toLogger`/`errorPayload` 落地；`types` `ErrorCode`/`errorInfo` 归一化，多类错误标注 `code`，HTTP/CLI 稳定错误体 `{ error: { code, message } }` |
| P3.2 | 事件/日志脱敏 | 事件与日志载荷脱敏钩子：API key/secret 类字段永不进事件、日志与 diff | 用含 key 的 fixture 验证事件流无泄露 | ✅（2026-09-08，M6-19）：`core` `redact()` 强密钥字段 + 类密钥值（`sk-`/JWT/base64）全量脱敏；`ConsoleLogger` 与 `AgentRuntime` 在 `tool:start`/`tool:end` 事件与日志中对工具参数脱敏（密钥永不进事件流/日志）；`core/test/log.test.ts` 覆盖；**评审后加固（M6-21）**：深度上限改为整值脱敏 + `WeakSet` 防循环引用，键名支持 `x-`/`proxy-` 等前缀并补充厂商 token 形态 |
| P3.3 | 审批审计 + 白名单持久化 | 审批记录（decision/工具/参数指纹/时间/结果）落库；`always` 白名单持久化存储 | 审计可导出；重启后白名单生效 | ✅（2026-09-08，M6-19）：`types/audit.ts`（`ApprovalRecord`/`ApprovalStore`/`ToolGrant`）+ `host/approval-store.ts`（`StorageApprovalStore`）；`policy` 审批审计 + `always` 白名单持久化、`host/session` 接线；审计仅留参数指纹不存原文；`packages/types/test/audit.test.ts`、`packages/policy/test/permission.test.ts` 覆盖 |
| P3.4 | 成本与速率上限 | run/session 级 usage 上限（步数/费用/时长）、工具调用速率限制 | 超限即中止并产 run:error（可配置） | ✅（2026-09-08，M6-19）：`types/limits.ts`（`RunLimits`/`LimitViolation`/`checkRunLimits`）+ `core/config.ts`（`buildLimits`，`AGENT_LIMIT_*` 分层）+ `runtime` 集成（每步 `checkRunLimits`，超限产 `run:error`）；`packages/types/test/limits.test.ts` 覆盖；**评审后加固（M6-20）**：`maxSteps` 预算与循环上界解耦，越界即产 `run:error(limit_exceeded)` 而非静默收敛 |
| P3.5 | Web/本地 server 鉴权与防跨站 | Web server：CORS 白名单化、请求体上限、会话/请求鉴权；本地 console 端口加 loopback token 或同源校验，防任意网页调用本地 API | 无凭据/跨域请求被拒 | ✅（2026-09-08，M6-19）：`examples/web/security.ts` 纯函数守卫（`isLoopbackHost`/`decideCors`/`decideAuth`/`missingTokenWhenExposed`——非 loopback 监听无令牌拒启）；`server.ts` 接线 CORS 白名单 + Bearer 鉴权 + 请求体 256KB 上限；`examples/web/security.test.ts` 覆盖；**评审后加固（M6-20）**：OPTIONS 预检经 `decidePreflight()` 回完整 CORS 头，`AGENT_CORS_ALLOW_ORIGINS` 才真正可用；**评审后加固（M6-21）**：令牌恒定时间比较 + `decideCsrf()` 拦截无 Origin 的跨站写请求 |
| P3.6 | MCP 供应链防护 | stdio 超时；streamable HTTP URL 白名单（防 SSRF）；注册 server 的凭据经 env 注入不入日志 | 越白名单 URL 拒绝连接 | ✅（2026-09-08，M6-19）：`mcp` `validateMcpServerUrl()` 仅 http/https + 可选白名单（防 SSRF），`StreamableHttpTransport` 构造即校验；`StdioTransport` `startTimeoutMs` 启动超时 SIGKILL 并 reject；凭据经 env 注入不入日志；`packages/mcp/test/transport.test.ts` 覆盖；**评审后加固（M6-20）**：HTTP 传输逐跳校验重定向（堵住白名单 SSRF 绕过）、stdio 默认最小 env（`inheritEnv` 显式放开） |
| P3.7 | 默认安全策略包 | `DefaultPermissionPolicy` 生产模板（默认 deny 类 + 最小权限 sample），沙箱默认关闭网络（full-access 显式开启） | 文档示例开箱即生产默认 | ✅（2026-09-08，M6-18）：`policy/secure.ts` `PRODUCTION_MATRIX`/`createProductionPolicy`/`secureScope`/`createProductionDefaults`；examples 默认套用生产预设（最小权限 + 锁域），`packages/policy/test/secure.test.ts` 覆盖 |
| P3.8 | config/features 模块（吸收 D2） | 配置 schema + 环境分层校验 + 特性开关；Provider 密钥仅经配置/环境注入 | 无魔法 env 硬读；缺必配报可读错误 | ✅（2026-09-08，M6-18）：`core/config.ts` `loadConfig()` 分层（env > 默认）+ 校验 + 特性开关；Provider 密钥仅经配置/环境注入，非法配置报可读 `ConfigError`；`packages/core/test/config.test.ts` 覆盖；**评审后加固（M6-21）**：空串 `OPENAI_API_KEY` 与 openai 缺密钥均抛 `ConfigError`，不再静默降级 mock |

**Gate 3 退出标准**：安全项均有自动化测试覆盖；demo 三种形态切"生产配置"后默认行为收紧仍全流程可用。

> **进度（2026-09-08，M6-19）**：P3.1~P3.8 全部完成（P3.1/P3.7/P3.8 @ M6-18 `e7e8e53`；P3.2~P3.6 @ M6-19 `6883bc6`），**Gate 3 关闭**。安全项均有自动化测试覆盖（`core/test/log.test.ts`、`packages/mcp/test/transport.test.ts`、`examples/web/security.test.ts`、`packages/types/test/audit.test.ts`、`packages/types/test/limits.test.ts`、`packages/policy/test/permission.test.ts`、`packages/policy/test/secure.test.ts` 全绿）；`npm run check:api` 0 差异；生产默认收紧（最小权限策略 + 沙箱锁域 + 无凭据/跨域拒绝）由单测与既有 `scripts/e2e/` 验证。

## 4. P4 · SDK 发布工程（Gate 4）

目标：对外可发布、可消费、可升级的 npm 包与版本流程。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P4.1 | LICENSE 选型 | 根与各包 LICENSE（建议 MIT 或 Apache-2.0，含声明作者） | 每包发布元数据含 license | ✅（2026-09-08，M6-22）：根 + 12 包 MIT LICENSE（Copyright 2026 wangzhiyong），各包 `license: "MIT"` |
| P4.2 | 去 private + 发布元数据 | 各包 `private:false` + `publishConfig.access=public` + `sideEffects:false`；包描述/关键词/仓库地址核对 | `npm pack --dry-run` 产物清单正确 | ✅（2026-09-08，M6-22）：12 包去 `private`，补 `publishConfig.access=public`/`sideEffects:false`/`author`/`repository`(含 directory)/`homepage`/`bugs`/`keywords`；产物为 dist + package.json + LICENSE |
| P4.3 | Node/engines 与打包决策 | 统一 engines（随 `node:sqlite` 取 `>=22.13` 或迁移后另定）；决策 ESM-only or 双格式（当前 tsc 仅 ESM） | 根 `.nvmrc` + `packageManager` 与 engines 一致 | ✅（2026-09-08，M6-22）：全仓 `engines.node >=22.13.0`（随 `node:sqlite`）；`.nvmrc=22.22.1`、`packageManager=npm@10.9.4`；维持 ESM-only（tsc 单格式） |
| P4.4 | 版本与发布编排 | 引入 changesets（或等价）管理 0.2.0 → 0.3.0 → 1.0.0；CI 发版 workflow（tag 触发 `npm publish --provenance` 逐包） | 试发布 canary 成功 + 实装消费验证 | ✅（2026-09-08，M6-22）：changesets（`.changeset/`，12 包 fixed 统一版本）+ `release.yml`（push main 走 changesets/action，tag `v*` 走 `npm publish --workspaces --provenance`）；canary 实测：12 包 tarball → 全新项目安装 → demo 跑通 + `tsc --noEmit` 通过（含/不含 `@types/node`） |
| P4.5 | 依赖策略 | 内部互依改 `workspace:` 协议或发布前对齐 version；对外声明 peer 依赖边界（core vs 插件） | 消费方 `npm i` 后 TS 类型与运行均正常 | ✅（2026-09-08，M6-22）：内部互依统一 `^0.2.0` 由 changesets 发版对齐（`workspace:` 协议在当前 npm 下不被支持）；`core`/`types` 提为插件包 `peerDependencies`；新增 `ProcessEnv` 让发布 d.ts 不依赖 `@types/node` |
| P4.6 | 包体积基线 | dist 产物大小登记 + CI 体积检查（超阈值告警） | 体积报告入库 | ✅（2026-09-08，M6-22）：`scripts/size-report.mjs`（`npm run size` / `size:update`）+ `scripts/size-baseline.json`，包体积增长 >+25% 阻断；已纳入 `npm run ci`，报告写入 `coverage/size-report.txt` |

**Gate 4 退出标准**：`npm publish --provenance` 模拟发布成功；在全新项目安装 `@agent-runtime/*` 可 typecheck 并跑通最小 demo。

> **进度（2026-09-08，M6-22）**：P4.1~P4.6 全部完成，**Gate 4 关闭**。MIT LICENSE 落地；12 包可发布元数据齐备且 `npm pack --dry-run` 清单正确；`engines`/`.nvmrc`/`packageManager` 统一到 Node `>=22.13.0`（ESM-only）；changesets 编排 0.2.0 → 0.3.0 并接入发版 workflow；`core`/`types` 提为插件 peer 边界；体积基线与 CI 门禁生效。退出标准已实测：12 包 tarball 在全新项目安装后 `tsc --noEmit`（含与不含 `@types/node` 两种场景）与最小 demo 运行均通过；对 registry 的实际 `npm publish --provenance` 待仓库配置 `NPM_TOKEN` 后由 tag 触发。

## 5. P5 · 分发与部署矩阵（Gate 5）

目标：**Web 形态与生产存储**在真实目标机与 CI 上可重复构建、部署、稳定运行。（原含桌面形态与签名分发；桌面项已于 2026-09-10 移出至产品侧，见本 §末「移出决定」。）

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P5.1 | 桌面实机验证（吸收 A1） | 双击 `.app` 验证 + `dmg` 安装到 /Applications 复验全流程 | 验收报告入库（勾选 m5 §6） | ⏸ **已移出至产品侧（2026-09-10）**；移出前状态——部分完成（2026-09-09，M6-25）：`npm run verify:desktop`（`scripts/verify-desktop.mjs`）已能给出结构/签名/Gatekeeper/dmg 结论；实跑发现旧产物缺 sidecar `node-<triple>` 且未签名，需重打并经 P5.2 签名后完成双击与 /Applications 复验 |
| P5.2 | macOS 签名 + 公证 | Developer ID 签名 + notarization 接入 `tauri build` | `spctl --assess` 通过、Gatekeeper 无告警 | ⏸ **已移出至产品侧（2026-09-10）**；移出前状态——待证书（2026-09-09，M6-25）：`desktop.yml` 已接入 `APPLE_*` 签名与公证变量，README 给出 `codesign`/`spctl` 验收命令；需提供 Developer ID 证书与 Apple 账号 secrets 后实跑 |
| P5.3 | 三平台构建矩阵 | CI 出 `.app`/`.dmg` + `.msi`/`.exe` + `.AppImage`/`.deb`（Linux 与 Windows 首次打通，含 sidecar node 三平台三元组） | 每平台产物可装可跑 | ⏸ **已移出至产品侧（2026-09-10）**；移出前状态——配置就绪（2026-09-09，M6-25）：三平台矩阵 workflow 已入库（macOS/Linux/Windows，含 sidecar 三元组与交叉编译 `NODE_BIN` 说明）；首次 CI 实跑与"可装可跑"复验待执行 |
| P5.4 | 自动更新（可选门） | Tauri updater 签名密钥 + 更新端点（GitHub Release） | 旧版→新版升级链路验证 | ⏸ **已移出至产品侧（2026-09-10）**；移出前状态——代码与配置就绪（2026-09-09，M6-27）：Rust 侧接入 `tauri-plugin-updater`（`check_update`/`install_update` 命令），`tauri.conf.json` 配 `plugins.updater`（endpoints → GitHub Release `latest.json`、pubkey）+ `createUpdaterArtifacts`，capabilities 放行 console 的 localhost origin IPC；控制台标题栏「检查更新→下载安装」入口（仅 Tauri 壳显示）；签名密钥对已生成（`src-tauri/.tauri/`，私钥不入库）；旧版→新版实机链路待首次 tag 发布验证（依赖 P5.2 签名/公证） |
| P5.5 | store-sqlite 生产基线 | schema 版本/迁移、WAL、索引（按 session/task 查询路径）；备份与恢复说明 | 大会话量查询耗时达标；迁移脚本可重复 | ✅（2026-09-09，M6-24）：`SCHEMA_VERSION`=2 存于 `PRAGMA user_version`，前向迁移幂等可重复（版本过高直接报错）；v2 表达式索引覆盖 session/task/run 与 `decidedAt`，`listDocs` 索引字段下推 SQL；`backup()` 走 `VACUUM INTO`；测试含 1k 记录规模查询耗时断言 |
| P5.6 | Web 部署形态样例 | Dockerfile / systemd + 反代示例；环境分层（dev/staging/prod）配置样例 | 容器内启动 → :8787 服务探活通过 | ✅（2026-09-09，M6-24）：`deploy/` 提供 Dockerfile（非 root + HEALTHCHECK）、compose（含 nginx edge profile）、systemd、nginx（SSE `proxy_buffering off`）、dev/staging/prod 环境分层与部署说明；新增 `GET /healthz` 与 `npm run smoke:web`（本地等价验证已通过，容器内 healthcheck 复用同一端点） |

**Gate 5 退出标准（2026-09-10 修订）**：生产存储与部署样例在干净环境复现成功（**P5.5 / P5.6，已完成**）。原「三平台 CI 产物 + 签名/公证后的 macOS 安装验证」随桌面端移出至产品侧，**不再是底座的 Gate 5 条件**；桌面形态的分发验收（若产品侧立项）按产品侧里程碑执行。

> **移出决定（2026-09-10）——桌面项移出至产品侧**（修订原「挂起为保留项」口径）：P5.1 桌面实机验证 / P5.2 签名 + 公证 / P5.3 三平台构建矩阵 / P5.4 自动更新链路**整体移出底座范围**，方向与投入归产品侧（判定见 `docs/base-convergence.md` §2.3；承接见 `docs/product-direction.md` §4）。四项的代码、脚本与 CI 配置均已就绪（P5.1~P5.3 @ M6-25，P5.4 @ M6-27），作为**产品侧资产**保留；前置条件不变（Apple Developer ID 证书、Apple 账号 secrets、`NPM_TOKEN`），由产品侧在自身里程碑中按 **P5.2 → P5.1 → P5.3 → P5.4** 顺序复验。**底座侧结论：Gate 5 不再包含桌面验收**，仅以 P5.5 / P5.6（已完成）为交付物；桌面端既不纳入 M7 关键路径，也不再作为底座的保留项/待办跟踪。

## 6. P6 · 治理 · 文档 · 社区（Gate 6）

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P6.1 | 治理文件 | `CONTRIBUTING.md`（PR/分支/质量门约定）、`SECURITY.md`（漏洞报告渠道） | 文件入库，README 链接 | ✅（2026-09-09，M6-23）：`CONTRIBUTING.md`（质量门/分支/changeset/API 面冻结/PR 清单）+ `SECURITY.md`（私密报告渠道、响应目标、范围与排除项、部署安全默认值）；README「参与贡献」已链接 |
| P6.2 | README 生产用法 | 安装/升级/配置/观测/发布指引节 + badges（CI/coverage/version/license） | 新用户按 README 可完成接入 | ✅（2026-09-09，M6-23）：badges（CI/Release/coverage/node/license）+「安装（作为依赖消费）」+「生产用法（配置 · 观测 · 安全）」三节；环境变量表、观测与安全默认、发布升级流程齐备 |
| P6.3 | 路线图回填（吸收 A4） | `architecture.md` §11 新增 M6 行并标 ✅；§13 修订记录 v1.8 | 与本文状态一致 | ✅（2026-09-09，M6-26）：`docs/architecture.md` §11 M6 行更新为「Gate 1~4 已关闭 + P5/P6 进度」，§13 修订记录新增 v1.10 |
| P6.4 | 文档收敛 | 用本文更新 `remaining-tasks.md` 状态（A/B/C 收口，D2 已拉近，D1/D3 留远期） | 双源无漂移 | ✅（2026-09-09，M6-26）：`docs/remaining-tasks.md` 同步 —— A1 ⏳（→P5.1，验收脚本就绪待签名）、A4 ✅（→P6.3）、D2 ✅、D1/D3 维持远期；顶部决策段与 §1 明细双处更新 |
| P6.5 | CHANGELOG 阶段条目 | Unreleased 记 **M6 生产级改造** 段落（分批随 commit 追加） | 代码与条目同 commit | ✅（持续，M6-18~M6-26）：`CHANGELOG.md` `[Unreleased]` 按批次（M6-18 … M6-26）随 commit 追加，本批即 M6-26 条目 |
| P6.6 | 参考机制复核（吸收 D3 部分） | codex/deepseek-harness 参考中与可观测/成本/UI 相关的机制标注"可采纳"，列入 next | 参考文档加采纳注记 | ✅（2026-09-09，M6-26）：`codex-reference.md` 与 `deepseek-harness-reference.md` 各加「采纳复核（P6.6）」——已采纳（执行边界/审批预设/会话持久化/插件化包边界/配置分层）、可采纳列入 next（token 计量与上下文压缩、traceId/OTEL、CLI TUI 审批、宿主装配轻量 DI、UI 按工具 kind 渲染）、不采纳（整体迁移 Cordis、绑 OpenAI 模型面） |

**Gate 6 退出标准**：仓库从"clone → npm ci → npm run ci → npm run demo:xxx"全链路有据可查；治理与文档齐备；可对外开源发布。

> **进度（2026-09-09，M6-26）**：P6.1~P6.6 全部完成，**Gate 6 关闭**。治理文件（`CONTRIBUTING.md` / `SECURITY.md`）与 README 生产用法（badges、安装、配置/观测/安全、发布升级、贡献入口）齐备；路线图与遗留清单双源已回填一致（`architecture.md` §11/§13 v1.10、`remaining-tasks.md`）；CHANGELOG 随批 commit（M6-18~M6-26）；参考机制完成采纳复核。全链路可复现：`npm ci` → `npm run ci`（typecheck/lint/test/coverage:gate/check:api/size）→ `npm run demo:cli|web` → `npm run smoke:web` / `npm run verify:desktop`。

---

## 7. 建议执行顺序与批次依赖

```
P1 决策+拆包 ──► P2 CI/质量门 ──► P3 可观测/安全/配置 ──► P4 发布工程
      │                │                 │                    │
      └────────────── 全仓回归（每批收口跑 typecheck+test+build）
P5 分发/部署矩阵（P4.4 后可启动桌面签名/公证，可与 P3 并行）
P6 治理/文档（全程并行，P6.5 CHANGELOG 随批 commit）
```

- **严格前置**：P1 必须先于 P4（发布即冻结边界）；P2 先于 P3/P5（护栏保护后续改动）。
- **可并行**：P3 与 P5 相互独立，可在 P2 后分头推进；P6 全期并行。
- **风险项**：P1.3 C8 host 拆包上次试行回滚，务必先落定 C1、先搬迁后拆依赖；（原 P5.3 三平台首度打通风险已随桌面端移出至产品侧转出，见 §5 移出决定。）

## 8. 维护约定与相关文档

- 每项完成：**回填本文状态 + 源清单状态 + CHANGELOG 条目，同一 commit**；涉及公共 API 变更做全仓回归。
- 事实源：`docs/remaining-tasks.md`（A~D 池）、`docs/crate-split-todo.md`（拆包执行级与验收）、`docs/crate-architecture.md` §8（模块边界/决策）、`docs/m5-productization.md`（M5 验收�