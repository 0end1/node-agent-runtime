# 底座收敛（Base Convergence）

> 记录时间：2026-09-10
> 定位：**收敛决策事实源**。把项目从「桌面产品驱动」叙事收敛为「**可发布 SDK 底座驱动**」：底座是唯一一等公民，其余形态降级为验证载体；**桌面端整体移出至产品侧**（2026-09-10，§2.3）。
> 前置状态：M6 Gate 1（包边界）/ Gate 2（质量门）/ Gate 3（可观测与安全）/ Gate 4（SDK 发布工程）/ Gate 6（治理文档）已关闭；**桌面端（`examples/desktop-tauri/` 与 P5.1~P5.4）已自底座范围移出，方向与投入归产品侧**（回填见 `docs/m6-productionization.md` §5；产品侧承接见 `docs/product-direction.md` §4）。
> 与其它文档的关系：本文件定「**边界与取舍**」，`docs/product-direction.md` 定「**方向与里程碑**」，`docs/architecture.md` §11 定「**路线图**」。三者口径冲突时以本文件为准，并顺手修正另两处。

---

## 0. 一句话结论

| 项 | 结论 |
|---|---|
| **一等公民** | `packages/*` **12 个 workspace 包**（`@node-agent-runtime/*`）+ 公共 API 快照 + 质量门 + 发布编排 |
| **降级** | `examples/cli.ts`、`examples/web/`、`deploy/`、`scripts/e2e/`、`scripts/smoke-web.mjs` → **验证载体**（只验证底座，不演进产品） |
| **移出（产品侧）** | `examples/desktop-tauri/`、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs`、P5.1~P5.4 → **移出底座范围（HANDOFF）**：底座不再投入、也不再对其立项与否作判定，**方向与投入归产品侧**（见 §2.3） |
| **不立项** | 垂直行业应用、Rust 移植、多 Agent 协同（维持远期/否决，见 §2.4）；**桌面形态不在底座判定范围**（见 §2.3） |
| **M7 立项口径** | 只对**底座**立项：任何 M7 项必须能落到「某个包的 API / 测试 / 发布物」上，否则降级为示例增强或不做 |

---

## 1. 为什么要收敛（判断依据）

1. **资产结构决定主次**：底座是「治理纵深强」，外围是「应用表层弱」（`docs/product-direction.md` §1）。12 包里真正稀缺的是 **沙箱 × 审批 × 审计 × 可恢复** 的产品级闭环（含 `resume` 指纹校验、`Redactor` 脱敏、审批审计落库、`RunLimits` 限额），这些是第三方可 `npm i` 直接消费的资产；而 CLI/Web/Desktop 是**同一份资产的三种展示方式**，不构成第二份资产。
2. **外围在吃维护预算**：`examples/desktop-tauri/` 跟踪 **65 个文件**（含全套图标、Android/iOS 资源、`Cargo.lock` 与第二个 `package-lock.json`），配套还有三平台构建矩阵、sidecar 构建、`verify-desktop` 验收脚本、auto-updater 与签名链。这条链依赖**外部凭证与平台工具链**（Apple Developer ID、Rust/cargo、Tauri CLI），已经因缺凭证挂起 —— 继续投入只有成本，没有差异化回报。**处置因此不是「底座内冻结」，而是「移出至产品侧」**：桌面形态是否投入、以什么形态投入属产品侧决策，不由底座口径裁定（§2.3）。
3. **叙事漂移已经发生**：`architecture.md` §1 把「Desktop 壳层」画在最顶层，README「快速开始」以 `demo:cli` / `demo:web` 开头，M5 「产品化」的定义是三形态 —— 外部读者会误判这是一个**桌面应用**，而不是一个**可复用的运行时底座**。定位漂移直接伤害底座的采纳（开发者看不到「我怎么把它装进我的服务」）。
4. **单人产能约束**：12 包已在维护半径边缘（`product-direction.md` §7）。收敛的本质是**把有限的工程预算从「展示面」收回到「交付面」**。

> 收敛不是「删代码」，而是「**改口径 + 定边界 + 停投入**」：外围代码保留（它们仍是回归资产），但不再作为产品演进方向。

---

## 2. 收敛后的边界（二分类 + 移出 + 出局）

### 2.1 底座（KEEP · 唯一一等公民）

| 包 | 职责 | 边界规则 |
|---|---|---|
| `@node-agent-runtime/types` | 契约叶子包（消息/工具/事件/Storage/Artifact + schema 校验器 + 零 IO 纯函数） | 零依赖，任何包可依赖；公共面已冻结快照 |
| `@node-agent-runtime/core` | 引擎（run loop / Agent / Context / 事件总线 / 工具与 provider 契约 / Memory·FileStorage） | 不感知产品概念（会话标题、审批弹窗、多窗口） |
| `@node-agent-runtime/host` | `SessionManager`：Session → Task → Run 生命周期与落盘 | 唯一「产品策略」承接层，但不含 UI |
| `@node-agent-runtime/memory` | `SessionMemory` + `Checkpoint`（步级快照） | 依赖 types |
| `@node-agent-runtime/artifact` | `ArtifactManager` 产物管理 | 依赖 types，一包一职责 |
| `@node-agent-runtime/sandbox` | `LocalSandbox` 三档执行域 + 声明域 + 禁网 + 超时 | 依赖 types |
| `@node-agent-runtime/policy` | `PermissionManager` / `DefaultPermissionPolicy` 授权决策 | 依赖 types，与 sandbox 正交 |
| `@node-agent-runtime/mcp` | MCP 适配（stdio / streamable HTTP / 物化为本地工具） | 协议翻译，无产品概念 |
| `@node-agent-runtime/provider-openai` | OpenAI 兼容 fetch 后端 | 模型中立，凭 `ModelProvider` 接缝 |
| `@node-agent-runtime/store-sqlite` | `SQLiteStorage`（迁移/索引/在线备份） | `node:sqlite`，可选后端 |
| `@node-agent-runtime/tools-basic` | 内置基础工具集（演示与开箱可用） | 非引擎必需，可被替换 |
| `@node-agent-runtime/mock` | 免密钥 `MockProvider`（离线可跑/测试桩） | 非引擎必需，测试与示例专用 |

**底座附带设施（同属一等公民）**：`docs/api-surface.md`（API 快照，`npm run check:api` 门禁）、`npm run ci`（typecheck → lint → test → coverage:gate → check:api → size）、changesets + `.github/workflows/release.yml`、`CONTRIBUTING.md` / `SECURITY.md` / `LICENSE`。

**判定「这算不算底座」的四条**（任一不满足即不属于底座）：
- a) 有**独立第三方消费者**场景（能被别人单独 `npm i` 用上）；
- b) **零运行时依赖**，或依赖关系明确为 peer/注入（不引入框架）；
- c) 有**独立测试 + API 快照 + 体积基线**三件套；
- d) **不引入产品概念**（不含标题生成、审批弹窗、多窗口路由、品牌 UI）。

### 2.2 验证载体（KEEP AS FIXTURE · 只验证，不演进）

| 载体 | 存在理由（唯一） | 纪律 |
|---|---|---|
| `examples/cli.ts` | 最小消费者 + 审批/续跑/MCP 的操作面；人肉验收底座能力 | 只随**底座接口变化**改动；不新增业务功能 |
| `examples/web/`（`server.ts` + `public/` + `security.ts`） | SSE 事件流、审批卡片、`sandbox:write` diff、artifact 面板的**可视化验收面**；web 安全（CORS/CSRF/Bearer/体上限）的测试载体 | 同上；不视为产品界面，不做产品级 UX 投入 |
| `deploy/`（Dockerfile / compose / systemd / nginx / env 分层） | 证明底座可被**容器化交付**（`/healthz` + SSE 代理配置） | 仅随底座运行要求更新（如新环境变量） |
| `scripts/e2e/`（CLI + Web） | 跨形态端到端回归，守护底座契约不烂 | 用例只增不减；失败即阻断发布 |
| `scripts/smoke-web.mjs` | 部署形态冒烟（启动 → 探活 → 关闭） | 随 `deploy/` 变化 |

> **纪律总纲**：验证载体的一切改动，必须在提交说明里回答「**这条改动在验证底座的哪一项能力？**」——答不出就不改。

### 2.3 移出至产品侧（HANDOFF · 2026-09-10 决策）

**底座收敛取消桌面端**：桌面端不再属于本文件的任何分类（既不是底座，也不是验证载体），而是**整体移出至产品侧**——底座不再投入，也不再对其立项与否作出判定。

| 移出对象 | 移出含义 | 产品侧承接位置 |
|---|---|---|
| `examples/desktop-tauri/`（65 跟踪文件） | 底座侧不再新增功能、不升级 Tauri / 插件版本、不调整图标与打包链 | `docs/product-direction.md` §4（形态归属）· `docs/product-build-paths.md`（形态成本评估） |
| `.github/workflows/desktop.yml` | 底座侧不再维护其触发策略（现为 `tag v*` / 手动，不进常规 CI 前置） | 同上；是否保留该工作流由产品侧决定 |
| `scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs` | 保留脚本作为回归资产，但不作为底座验收门槛（E2E 默认跳过 desktop） | 同上 |
| P5.1 桌面实机 / P5.2 签名公证 / P5.3 三平台 CI / P5.4 自动更新 | 自 M6 P5 移出，**不再是底座的保留项**（回填见 `docs/m6-productionization.md` §5） | 由产品侧按自身里程碑重新立项；前置条件不变（Apple Developer 证书 + 仓库 secrets） |

**移出 ≠ 删除，也 ≠ 放弃**：不删文件、不删 workflow、不删脚本；底座侧只停止投入与判定。桌面形态**是否做、何时做、以什么形态做**属产品侧问题——其成本与替代路径评估见 `docs/product-build-paths.md`。

### 2.4 出局（DROP · 明确不立项）

| 对象 | 处置 | 理由 |
|---|---|---|
| 垂直行业 Agent 应用（代码/运维/数据分析） | 不立项（可做示例） | 需领域数据与交付能力，丢弃底座差异化（`product-direction.md` §3-C） |
| Rust workspace 移植（D1） | 维持远期，不进 M7 | 无单二进制/性能诉求触发（`crate-architecture.md` §7） |
| 多 Agent 协同 / 子任务编排 | 维持远期 | 属编排表达力竞争，非底座强项（`development-checklist.md` §3.3） |

> **注（2026-09-10）**：原「消费级桌面助手 → 不立项」条目**已撤销**——桌面端整体移出至产品侧（§2.3），其取舍不再由底座口径裁定，改由 `docs/product-direction.md` §4/§8-3 评估。

---

## 3. 防止再次发散的准入规则

**新提案三问**（任何功能请求、示例改动、文档新增都要先答）：
1. 它属于**底座的哪一层/哪个包**？（答不出 → 不属于底座）
2. 它的**验收物**是「包 API / 测试 / 发布物」中的哪一个？（答不出 → 不可验收）
3. 如果是验证载体改动：**在验证底座的哪项能力**？（答不出 → 不做）

**准出（从底座移出）**：只服务 demo、依赖外部凭证或平台工具链、无第三方复用可能 —— 满足任一条即移出。移出去向有两种：**验证载体**（仍服务于底座验证）或**产品侧**（属产品形态，底座不再判定，如桌面端 §2.3）。

---

## 4. 收敛后的项目视图

```
packages/             ← 底座：12 包（唯一一等公民，随 npm 发布）
  types core host memory artifact sandbox policy mcp
  provider-openai store-sqlite tools-basic mock

examples/             ← 验证载体（不发布、不承诺接口）
  cli.ts              ← 最小消费者
  web/                ← 事件流/审批/安全 可视化验收面
  desktop-tauri/      ← 【移出至产品侧】保留代码，底座侧停止投入

deploy/               ← 验证载体：容器化交付冒烟
scripts/              ← 底座设施（api-surface/coverage/size/e2e）+ 移出脚本（verify-desktop）
docs/                 ← 决策与事实源
.github/workflows/    ← ci.yml · release.yml（底座）｜ desktop.yml【移出至产品侧】
```

**层级口径修正**：`architecture.md` §1 图 1 的「Desktop → Product Host → Runtime core」是**运行时分层**（描述依赖方向，仍然成立）；但**项目投入分层**是「底座 → 验证载体」，桌面端已移出至产品侧（§2.3），两者不是一回事，不得互相引用。

---

## 5. 对工程设施的影响（只改口径与触发，不改逻辑）

| 设施 | 处置 | 说明 |
|---|---|---|
| `.github/workflows/ci.yml` | 保留 | 底座质量门（typecheck / lint / test / coverage / audit） |
| `.github/workflows/release.yml` | 保留 | 底座发布编排（changesets + `--provenance`） |
| `.github/workflows/desktop.yml` | 移出标注 | 触发仍为 `tag v*` / 手动；注释标注「移出至产品侧」与承接位置（底座不再维护其触发策略） |
| `scripts/e2e/` | 保留（desktop 默认跳过） | CLI + Web 常规跑；desktop 用例仅在显式 `E2E_DESKTOP=1` 时执行 |
| `deploy/` | 保留 | 随底座运行要求更新 |
| README / architecture / checklist | **改叙事** | 不再以「桌面产品」为顶层定位 |

---

## 6. M7 立项口径（只对底座）

`docs/product-direction.md` §5 的候选按本口径重新归类：

| 候选 | 归类 | 处置 |
|---|---|---|
| M7-1 成本与上下文治理 | **底座** | 保留（`core` / `provider-*` 的计量与压缩 API + 测试 + 发布物） |
| M7-2 可观测与合规导出 | **底座** | 保留（事件/日志的 `traceId` 与 OTEL 导出、审计导出接口） |
| M7-3 策略工程化 | **底座** | 保留（`policy` 声明式规则 + 内联测试 + 预设矩阵） |
| M7-4 审批体验（CLI TUI / Web 批量审批） | **验证载体增强** | **降级**：CLI/Web 面改动，不占 M7 关键路径 |
| M7-5 编排能力 | **底座（部分）** | `compileAgent()` / 配方快照校验属底座；多任务并发调度需先论证 |
| M7-6 工具规模治理 | **底座** | 保留（`mcp` / `core` 的工具检索与契约快照） |
| M7-7 生态入口 | **底座（部分）** | 文档站 / 脚手架 / 示例库属**分发设施**（保留）；控制台 UI 定制渲染**降级** |

> 结论：**M7 首批 = M7-1 / M7-2 / M7-3 / M7-6**（全部落在 12 包上，可测试、可发布）；M7-4 与 M7-7 的 UI 部分转为「验证载体增强」，需要时才做。

---

## 7. 收敛验收口径

本次收敛以「口径与标注到位 + 质量门不回退」为验收：

| 项 | 验收物 | 状态 |
|---|---|---|
| 收敛决策成文 | 本文件（§2 三分类 + §3 准入规则 + §6 立项口径） | ✅ 2026-09-10 |
| 架构叙事改口径 | `architecture.md` §1 定位注记 + §11 路线图 M7 行 + §13 修订记录 | ✅ 2026-09-10 |
| 方向文档对齐 | `product-direction.md` §0 / §4 / §5（控制台降级为验证载体） | ✅ 2026-09-10 |
| 入口与索引对齐 | `README.md` 定位与快速开始口径、`development-checklist.md` §0/§3.3、`remaining-tasks.md` | ✅ 2026-09-10 |
| 移出标注 | `examples/desktop-tauri/README.md`、`.github/workflows/desktop.yml` 顶部注记由「冻结」改为「移出至产品侧」 | ✅ 2026-09-10 |
| **桌面端移出决策** | 底座取消桌面端分类，方向移入产品侧：本文 §0/§1/§2.3/§2.4/§3/§4/§5 + `product-direction.md` §4/§6/§7/§8 + `m6-productionization.md` §5 回填 | ✅ 2026-09-10 |
| 质量门不回退 | 本次仅文档与注释改动，不动 `packages/*`；`npm run typecheck` / `npm run lint` 均为绿 | ✅ 2026-09-10（`tsc --noEmit` 与 `eslint .` 通过） |

---

## 8. 相关文档

- 产品方向与 M7 里程碑草案：`docs/product-direction.md`
- 架构与路线图（§1 分层 / §11 路线图 / §13 修订记录）：`docs/architecture.md`
- 阶段总览与索引：`docs/development-checklist.md`
- 遗留任务总池：`docs/remaining-tasks.md`
- M6 执行清单（P5 桌面项移出回填）：`docs/m6-productionization.md` §5
- 产品侧形态评估（桌面形态成本与替代路径）：`docs/product-build-paths.md`
- 公共 API 面（底座冻结快照）：`docs/api-surface.md`
- 模块边界与拆包：`docs/crate-architecture.md`、`docs/crate-split-todo.md`
