# M6 生产级改造执行清单（Production-Grade Upgrade）

> 记录时间：2026-09-07
> 定位：**阶段执行清单**。前置 demo 阶段（M1~M5：生命周期引擎 → 记忆/续跑 → 审批/沙箱治理 → MCP/Artifact → CLI/Web/Desktop 产品化与打包验证）已全部完成，本清单承接"**demo → 可用于生产的项目**"改造，分 6 批（P1~P6）逐项可勾选。
> 事实源与同步：本计划**吸收并重排** `docs/remaining-tasks.md` 的 A（验收收口）/B（拆包批次）/C（开放决策）/D（远期）——C 决策提前到 P1 冻结、B 拆包作为发布前置在 P1 收口、A1/A2/A3 分别落入 P5/P2/P2、A4 落入 P6、D2 config/features **拉近**至 P3、D1/D3 维持远期。执行级细节仍以各自源清单为准（`crate-split-todo.md`、`crate-architecture.md` §8）；完成时**回填本文 + 源清单 + CHANGELOG 同一 commit**（延续维护约定）。

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
| P1.1 | 落定 remaining-tasks C1~C4 四项开放决策 | 决策记录回填 `remaining-tasks.md` §3 + `crate-architecture.md` §8 | 四项各有结论与影响行 | ✅（2026-09-07：C1 经重评**修订为拆 host** / C2 独立两包 / C3 类型下沉 C1 + 实现并 C3 / C4 **已触发下沉**：工具 + 事件契约入 C1） |
| P1.2 | 拆包批次 B1：C6 `@agent-runtime/mcp` | 迁移 `core/src/mcp/` + `core/test/mcp.test.ts` | 新包独立 typecheck/测试绿 | ✅（mcp 15 pass） |
| P1.3 | 拆包批次 B2：C8 `@agent-runtime/host` | 迁移 `core/src/session.ts`(721 行) + `session.test.ts` | 单向依赖 host → core，无环 | ✅（原「移出」经重评恢复并完成：host 8 pass，`SessionManager` 导入源变更为破坏性变更并已切换全部引用点） |
| P1.4 | 拆包批次 B3：C3 memory / C4 sandbox / C5 policy | 迁移对应 src+test | 同上 | ✅（memory 17 / sandbox 13 / policy 13 pass） |
| P1.5 | 拆包批次 B4：core facade 收窄 | `core/src/index.ts` 改逐包 re-export | 全仓测试绿、examples 导入经 facade 兼容 | ✅（re-export memory/sandbox/policy；mcp 与 host 因方向所限不反向 re-export） |
| P1.6 | 公共 API 冻结快照 | 记录每包对外导出清单（人工清单或 api-extractor 报告）至 docs | 后续变更需走 break-change 评审 | ☐ **P1 唯一剩余项** |

**Gate 1 退出标准**：`remaining-tasks.md` A~C 全部 ☑；全仓 `typecheck` + `npm test` 绿；API 快照入库；`examples/` 三种形态在拆分后全流程可用。

> **进度（2026-09-07，split 分支）**：包边界收口 P1.1~P1.5 已完成——9 个 workspace 包（types / memory / sandbox / policy / core / host / mcp / provider-openai / store-sqlite，含 C1 重评后新增的 C8 host），依赖单向无环；全仓 `typecheck` 绿、`npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 33+1skip / host 8 / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。**Gate 1 待 P1.6（公共 API 冻结快照）入库后正式关闭**。

## 2. P2 · 工程护栏与质量门（Gate 2）

目标：所有改动经 CI 校验；质量要求代码化而非靠自觉。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P2.1 | GitHub Actions CI 主流程 | `.github/workflows/ci.yml`：PR/推送触发，job=typecheck→lint→test→build（matrix Node 覆盖支持区间） | 每个 PR 全绿才可合并 | ☐ |
| P2.2 | Lint/Format 基线 | ESLint + Prettier 配置 + `lint`/`format` 脚本入根与各包 | CI 含 lint job；`npm run lint` 0 error | ☐ |
| P2.3 | 覆盖率门禁 | 每包 `node --experimental-test-coverage`（或 c8）阈值 ≥ 80%（语句/分支），低水位区经评审豁免 | CI 覆盖 job 全绿 | ☐ |
| P2.4 | 跨形态自动化 E2E（吸收 A2） | `scripts/e2e/`：CLI → Web → Desktop 全流程脚本化（新会话→对话→ask 审批→approve 落盘→artifact→续跑）；作为 CI 独立 job（Desktop 用 headless/受控启动） | CI E2E job 通过；本机脚本 `npm run e2e` 可跑 | ☐ |
| P2.5 | 依赖审计门 | CI job `npm audit --omit=dev`；`package-lock.json` 提交并校验 | 高危 0 阻断；变更记录在案 | ☐ |
| P2.6 | 质量门总闸固化（吸收 A3） | 上述脚本集合为 `npm run ci`（typecheck+lint+test+coverage+build） | `npm run ci` 一键全绿 | ☐ |

**Gate 2 退出标准**：任一 PR 未过 `ci.yml` 无法合入；无 lint error；覆盖率达标；E2E 脚本在 CI 通过。

## 3. P3 · 可观测性 · 安全加固 · 配置驱动（Gate 3）

目标：运行时"看得见、管得住、配得动"，堵住本地/远程 API 与密钥泄露风险。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P3.1 | 结构化日志 + 错误码 | 包内 Logger 接口（可注入/默认 console）；错误分级与错误码枚举贯穿 events/CLI/HTTP 响应 | 宿主可注入 logger；错误码到文案映射表入库 | ☐ |
| P3.2 | 事件/日志脱敏 | 事件与日志载荷脱敏钩子：API key/secret 类字段永不进事件、日志与 diff | 用含 key 的 fixture 验证事件流无泄露 | ☐ |
| P3.3 | 审批审计 + 白名单持久化 | 审批记录（decision/工具/参数指纹/时间/结果）落库；`always` 白名单持久化存储 | 审计可导出；重启后白名单生效 | ☐ |
| P3.4 | 成本与速率上限 | run/session 级 usage 上限（步数/费用/时长）、工具调用速率限制 | 超限即中止并产 run:error（可配置） | ☐ |
| P3.5 | Web/本地 server 鉴权与防跨站 | Web server：CORS 白名单化、请求体上限、会话/请求鉴权；本地 console 端口加 loopback token 或同源校验，防任意网页调用本地 API | 无凭据/跨域请求被拒 | ☐ |
| P3.6 | MCP 供应链防护 | stdio 超时；streamable HTTP URL 白名单（防 SSRF）；注册 server 的凭据经 env 注入不入日志 | 越白名单 URL 拒绝连接 | ☐ |
| P3.7 | 默认安全策略包 | `DefaultPermissionPolicy` 生产模板（默认 deny 类 + 最小权限 sample），沙箱默认关闭网络（full-access 显式开启） | 文档示例开箱即生产默认 | ☐ |
| P3.8 | config/features 模块（吸收 D2） | 配置 schema + 环境分层校验 + 特性开关；Provider 密钥仅经配置/环境注入 | 无魔法 env 硬读；缺必配报可读错误 | ☐ |

**Gate 3 退出标准**：安全项均有自动化测试覆盖；demo 三种形态切"生产配置"后默认行为收紧仍全流程可用。

## 4. P4 · SDK 发布工程（Gate 4）

目标：对外可发布、可消费、可升级的 npm 包与版本流程。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P4.1 | LICENSE 选型 | 根与各包 LICENSE（建议 MIT 或 Apache-2.0，含声明作者） | 每包发布元数据含 license | ☐ |
| P4.2 | 去 private + 发布元数据 | 各包 `private:false` + `publishConfig.access=public` + `sideEffects:false`；包描述/关键词/仓库地址核对 | `npm pack --dry-run` 产物清单正确 | ☐ |
| P4.3 | Node/engines 与打包决策 | 统一 engines（随 `node:sqlite` 取 `>=22.13` 或迁移后另定）；决策 ESM-only or 双格式（当前 tsc 仅 ESM） | 根 `.nvmrc` + `packageManager` 与 engines 一致 | ☐ |
| P4.4 | 版本与发布编排 | 引入 changesets（或等价）管理 0.2.0 → 0.3.0 → 1.0.0；CI 发版 workflow（tag 触发 `npm publish --provenance` 逐包） | 试发布 canary 成功 + 实装消费验证 | ☐ |
| P4.5 | 依赖策略 | 内部互依改 `workspace:` 协议或发布前对齐 version；对外声明 peer 依赖边界（core vs 插件） | 消费方 `npm i` 后 TS 类型与运行均正常 | ☐ |
| P4.6 | 包体积基线 | dist 产物大小登记 + CI 体积检查（超阈值告警） | 体积报告入库 | ☐ |

**Gate 4 退出标准**：`npm publish --provenance` 模拟发布成功；在全新项目安装 `@agent-runtime/*` 可 typecheck 并跑通最小 demo。

## 5. P5 · 分发与部署矩阵（Gate 5）

目标：桌面与 Web 形态在真实目标机与 CI 上可重复构建、签名分发、稳定运行。

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P5.1 | 桌面实机验证（吸收 A1） | 双击 `.app` 验证 + `dmg` 安装到 /Applications 复验全流程 | 验收报告入库（勾选 m5 §6） | ☐ |
| P5.2 | macOS 签名 + 公证 | Developer ID 签名 + notarization 接入 `tauri build` | `spctl --assess` 通过、Gatekeeper 无告警 | ☐ |
| P5.3 | 三平台构建矩阵 | CI 出 `.app`/`.dmg` + `.msi`/`.exe` + `.AppImage`/`.deb`（Linux 与 Windows 首次打通，含 sidecar node 三平台三元组） | 每平台产物可装可跑 | ☐ |
| P5.4 | 自动更新（可选门） | Tauri updater 签名密钥 + 更新端点（GitHub Release） | 旧版→新版升级链路验证 | ☐ |
| P5.5 | store-sqlite 生产基线 | schema 版本/迁移、WAL、索引（按 session/task 查询路径）；备份与恢复说明 | 大会话量查询耗时达标；迁移脚本可重复 | ☐ |
| P5.6 | Web 部署形态样例 | Dockerfile / systemd + 反代示例；环境分层（dev/staging/prod）配置样例 | 容器内启动 → :8787 服务探活通过 | ☐ |

**Gate 5 退出标准**：三平台 CI 产物 + 签名/公证后的 macOS 安装验证完成；生产存储与部署样例在干净环境复现成功。

## 6. P6 · 治理 · 文档 · 社区（Gate 6）

| # | 任务 | 交付物 / 动作 | 验收口径 | 状态 |
|---|---|---|---|---|
| P6.1 | 治理文件 | `CONTRIBUTING.md`（PR/分支/质量门约定）、`SECURITY.md`（漏洞报告渠道） | 文件入库，README 链接 | ☐ |
| P6.2 | README 生产用法 | 安装/升级/配置/观测/发布指引节 + badges（CI/coverage/version/license） | 新用户按 README 可完成接入 | ☐ |
| P6.3 | 路线图回填（吸收 A4） | `architecture.md` §11 新增 M6 行并标 ✅；§13 修订记录 v1.8 | 与本文状态一致 | ☐ |
| P6.4 | 文档收敛 | 用本文更新 `remaining-tasks.md` 状态（A/B/C 收口，D2 已拉近，D1/D3 留远期） | 双源无漂移 | ☐ |
| P6.5 | CHANGELOG 阶段条目 | Unreleased 记 **M6 生产级改造** 段落（分批随 commit 追加） | 代码与条目同 commit | ☐ |
| P6.6 | 参考机制复核（吸收 D3 部分） | codex/deepseek-harness 参考中与可观测/成本/UI 相关的机制标注"可采纳"，列入 next | 参考文档加采纳注记 | ☐ |

**Gate 6 退出标准**：仓库从"clone → npm ci → npm run ci → npm run demo:xxx"全链路有据可查；治理与文档齐备；可对外开源发布。

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
- **风险项**：P1.3 C8 host 拆包上次试行回滚，务必先落定 C1、先搬迁后拆依赖；P5.3 三平台为首度打通（sidecar 需 node 三平台三元组 + CI runner），预留排障余量。

## 8. 维护约定与相关文档

- 每项完成：**回填本文状态 + 源清单状态 + CHANGELOG 条目，同一 commit**；涉及公共 API 变更做全仓回归。
- 事实源：`docs/remaining-tasks.md`（A~D 池）、`docs/crate-split-todo.md`（拆包执行级与验收）、`docs/crate-architecture.md` §8（模块边界/决策）、`docs/m5-productization.md`（M5 验收依据）、`docs/architecture.md` §11/§13（路线图与修订）。
