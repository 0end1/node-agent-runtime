# 项目开发清单（已完成 / 未来规划）

> 记录时间：2026-09-07
> 定位：**总览索引**。一张表看清「已做了什么 / 接下来做什么」。执行级细节以事实源为准——`m6-productionization.md`（M6 生产化执行清单）、`remaining-tasks.md`（遗留池 A~D）、`crate-split-todo.md`（拆包执行级）、`architecture.md` §11（演进路线图）、`m5-productization.md`（M5 验收依据）。本文与各源清单**状态同步回填，同一 commit**。
> 状态图例：✅ 完成 · 🟡 主体完成/收口中 · ☐ 待办 · ⏸ 远期（未排期）
> 一句话现状：**能力层 M0~M4 与产品化 M5 主体已完成并验证，当前进入 M6 生产级改造阶段**。

---

## 0. 阶段总览

| 阶段 | 主题 | 状态 | 关键交付 |
|---|---|---|---|
| M0 | 引擎原型 | ✅ | 主循环 · 事件总线 · 工具系统 · 双 provider |
| M1 · 生命周期 | `Session`/`Task`/`Run` + Storage + Context | ✅ | 会话可重启恢复；C1/C2 workspace 化 |
| M2 · 记忆与续跑 | Memory · Checkpoint · resume | ✅ | 步级快照 + 工具指纹校验后续跑 |
| M3 · 治理 | Permission 审批 + Sandbox 执行域 | ✅ | ask 审批流、三档沙箱、`sandbox:write` diff |
| M4 · 外部能力 | MCP + Artifact | ✅ | 远端工具物化同路径过治理；产物管理 |
| M5 · 产品化 | 分包 + CLI/Web/Desktop 三形态 | 🟡 | 三形态与生产打包已验证；A1~A4 收口移交 M6 |
| **M6 · 生产级改造** | demo → 可用于生产 | 🟡 进行中 | **P1 已完成（Gate 1 关闭）**：C1~C4 决策落定 + C6 mcp / C8 host / C3 memory / C4 sandbox / C5 policy 外置 + facade 收窄，经 M6-9~11 自查整改形成 **12 包终局**（Artifact 独立、mock/tools-basic 外置、checkpoint 归位 memory，core 收窄至 1005 行）+ 公共 API 冻结快照（`docs/api-surface.md`，P2.7 ✅ 脚本化复核）；**P2 主体已完成（M6-14）**——P2.1 CI / P2.2 Lint·Format / P2.5 audit 门 / P2.6 `npm run ci` 总闸 ✅，P2.7 随总闸接入 CI，P2.3 覆盖率水位已出（阈值待评审）、P2.4 跨形态 E2E ☐；P3~P6 待办（见 §3.1） |
| M7+ | 待规划 | ⏸ | 候选池（见 §3.3），M6 收口后定优先级 |

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

> **M5 收口（🟡）**：主体（三形态 + 生产打包）已验证完成；`remaining-tasks` A1 安装分发实机验证 / A2 自动化 E2E / A3 全量质量门 / A4 路线图回填 **移交 M6**（对应 P5 / P2.4 / P2.6 / P6）。其中 **A3 全量质量门已于 M6-14 完成**（`npm run ci` + CI 常态化），A1 / A2 / A4 仍在 P5 / P2.4 / P6 待办。

---

## 3. 未来要做

### 3.1 M6 · 生产级改造（进行中，执行清单见 `docs/m6-productionization.md`）

| 批次 | 主题 | 关键项 | 状态 |
|---|---|---|---|
| **P1** | 决策冻结 + 包边界收口（**发布前置**） | 落定 C1~C4 决策 → 拆包 B1 mcp / B2 host / B3 memory·sandbox·policy / B4 facade 收窄 → M6-9~11 自查整改（Artifact 独立 / mock·tools-basic 外置 / checkpoint 归位，**12 包终局**）→ 公共 API 冻结快照 | ✅ 全部完成（Gate 1 已关闭，快照见 `docs/api-surface.md`，基线复核见 P2.7） |
| **P2** | 工程护栏与质量门 | GitHub Actions CI（typecheck/lint/test/build）、ESLint+Prettier、覆盖率门禁、跨形态 E2E（吸收 A2）、`npm audit` 门、收敛为 `npm run ci`（吸收 A3） | 🟡 **P2.1 / P2.2 / P2.5 / P2.6 ✅**（M6-14）：`.github/workflows/ci.yml`（quality / coverage / audit 三 job）+ ESLint 9 + Prettier 基线 + `npm run ci` 总闸；**P2.7 ✅** 已随总闸接入 CI；**P2.3 🟡** 覆盖率水位已出（行 58.62%），阈值待评审；**P2.4 ☐** 跨形态 E2E 未做 |
| **P3** | 可观测 · 安全 · 配置 | 结构化日志+错误码、事件/日志脱敏、审批审计与白名单持久化、成本/速率上限、Web/本地 server 鉴权与防跨站、MCP 防 SSRF、默认安全策略包、config/features（吸收 D2） | ☐ |
| **P4** | SDK 发布工程 | LICENSE、去 `private` + `publishConfig`、engines/Node 基线统一、changesets 版本编排 + `npm publish --provenance`、依赖策略（`workspace:`）、包体积基线 | ☐ |
| **P5** | 分发与部署矩阵 | 桌面实机验证（吸收 A1）、macOS 签名+公证、Windows/Linux 三平台产物、auto-updater、store-sqlite 生产基线（WAL/索引/迁移）、Web 容器化部署样例 | ☐ |
| **P6** | 治理 · 文档 · 社区 | `CONTRIBUTING`/`SECURITY`、README 生产用法、路线图回填 v1.8（吸收 A4）、双源收敛、CHANGELOG M6 条目 | ☐ |

执行约束：**P1 先行且必须早于 P4**（发布即冻结 API 边界）；P3 与 P5 可在 P2 后并行；P6 全期并行。

### 3.2 遗留池（`remaining-tasks.md`，已重排入 M6）

| 组 | 内容 | 去向 |
|---|---|---|
| A 验收收口 | A1 安装分发实机 / A2 自动化 E2E / A3 质量门 / A4 路线图回填 | → P5 / P2.4 / **P2.6（✅ 已完成，M6-14）** / P6 |
| B 拆包批次 | C6 mcp、C8 host、C3 memory + C4/C5 sandbox·policy、facade 收窄 | → P1.2~P1.5 |
| C 开放决策 | Session/Task 是否出 core；sandbox·policy 分合；`Artifact` 归属；tool 契约是否下沉 C1 | → P1.1（先行） |
| D 远期 | **D2 config/features**（已拉近 P3.8）；D1 Rust workspace 移植、D3 参考机制采纳 | D1/D3 维持 ⏸ |

### 3.3 M7+ 候选池（未排期，M6 收口后按反馈定优先级）

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

- M6 执行清单：`docs/m6-productionization.md`
- 遗留任务总池：`docs/remaining-tasks.md` · 拆包执行级：`docs/crate-split-todo.md`
- 路线图与修订记录：`docs/architecture.md` §11 / §13
- M5 验收依据：`docs/m5-productization.md`
- 模块边界与决策：`docs/crate-architecture.md` §8
