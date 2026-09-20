# DeepSeek Harness（dsh）参考：插件化 Agent Runtime 可借鉴清单

> 入库日期：2026-09-06（来源为官方 GitHub 仓库主页/README + 官方文档站 `deepseek-harness.github.io/deepseek-harness/` 的 reference 子系统页；个别二手综述仅作线索并已显式标注，**实现时一律以官方仓库源码与文档为准**）
> 范围：**仅作参考文档入库**（`deepseek-harness-reference.md`），不并入 `architecture.md` / 路线图，不参与 CHANGELOG 版本条目；是否在后续设计中被采用由人工决定。
> 开源对象：`deepseek-ai/deepseek-harness`（MIT）。DeepSeek 于 2026-08-13 随 V4 Pro 同日发布 **v0.1 developer preview**（Technical Preview）——开源的正是 **Agent 运行层（harness/runtime）**，不是模型。
>
> **采纳复核（P6.6，2026-09-09）**：
> - **已采纳**：「沙箱 × 审批预设 + 可持久化切档」→ P3.7 默认安全策略包与 P3.3 `always` 白名单持久化；「能力即插件子系统」→ 插件化包边界（tools-basic / mock / mcp / provider-openai / store-sqlite）与 P4.5 的 `core`/`types` peer 边界；配置分层诉求 → P3.8 `loadConfig()`（env > 默认 + 特性开关）。
> - **可采纳（列入 next）**：① Cordis 式插件生命周期与依赖注入（**轻量采纳**：只用于宿主装配层，不引入框架）；② UI 插件化 —— Web 控制台按工具 `kind` 定制渲染卡片（当前为通用 JSON 视图）；③ 配置 schema 校验与类型推导（现为手写校验，可生成 schema）。
> - **不采纳**：整体迁移 Cordis 插件模型 —— 生态绑定成本高，与本项目"零运行时依赖"取舍冲突。

---

## 0. 一句话结论

dsh 与本项目是**同代产物、同构命题**（TS/Node 的 agent harness），但它把「**一切皆插件 + 极薄内核**」走到了我们目前只按 crate 分包的深度之后——对本项目价值是 **M5 包化形态的参照物 + M3 治理「预设」语义的直接蓝本**，而不是可套用基座：Cordis 插件模型是自洽生态，强行迁移得不偿失；照抄其「沙箱×审批预设」「可持久化切档」「能力即插件子系统」三条机制即可。

---

## 1. 项目概况（官方一手事实，2026-09-06 快照）

| 项 | 内容 |
|---|---|
| 仓库 | `deepseek-ai/deepseek-harness`（GitHub）；文档站 https://deepseek-harness.github.io/deepseek-harness/ |
| 许可 | MIT；第三方依赖与许可披露于根目录 `THIRD_PARTY_NOTICES.md` |
| 定位 | 开源 **Agent 工具链 / Agent 运行框架（agent harness）**，官方定位为**插件化 SDK**：介于模型与真实执行环境之间的运行层 |
| 核心理念 | **Everything is a Plugin（一切皆插件）**：模型适配器、工具、会话、沙箱、审批、UI、存储全部是插件 |
| 内核 | 基于 **Cordis** 插件元框架（挂载/卸载/依赖/生命周期/事件/配置/HMR），不把 Agent 业务写进主干 |
| 技术栈 | Node.js + TypeScript；pnpm workspace monorepo（`pnpm-workspace.yaml`）；tsdown 构建；Vitest（e2e/snapshot/web/perf/stress）；oxlint/lefthook/jscpd |
| 顶层目录 | `apps/`（含 `apps/cli`、Web UI）、`packages/`（**插件包**，命名 `dsh-*`，如 `dsh-permission-presets` 位于 `packages/interaction/permission-presets`）、`docs/`、`python/`（Python SDK）、`native/`、`scripts/`、`vendor/`、`website/` |
| 运行 | `npx @deepseek-ai/dsh web` 默认 Web UI http://127.0.0.1:3080；支持本地与 SSH 两种场景（`--no-open` 不自动开浏览器）；源码运行 `pnpm install && pnpm run build && pnpm dsh web` |
| 官方文档结构 | 快速入门（Web UI）→ 插件开发（基础/框架/实战 + 7 篇 Cordis 连载）→ Reference 含 **40+ 子系统页**：内核/作用域、会话持久化、LLM 流式与 Token 计量、执行工具（Bash/子进程/PTY/文件系统/LSP/代码运行时/Web）、策略交互（审批/沙箱/计划/目标）、平台接入（HTTP 服务器/Web Client/设置/凭据） |
| 状态 | Developer / Technical Preview，官方加粗警告 **THERE WILL BE COMPATIBILITY-BREAKING CHANGES**；另有 `SAFETY.md`（运行前必读）、`BENCHMARK.md`、`AGENTS.md`、`BRAND_GUIDELINES.md` |

> ⚠️ 存疑待核：多个二手中文渠道称 dsh 含「标准 / PTC（TypeScript 编排）/ 极简 / 创造」四种运行预设——官方 README、quickstart 与已抓 reference 页**均未出现该命名**，仅证实官方确有「权限预设（permission presets）」子系统与「其他 CLI 模式」。该四档名**暂不采信**，待直接读仓库源码或对应文档页后再入库。

---

## 2. 按本项目里程碑的借鉴映射

### → M3 治理（最值得抄，P0）：预设 = 沙箱 × 审批 的显式组合

dsh 官方 `permission-presets` 子系统（`dsh-permission-presets` / `PermissionPresetService`）把两个强制 knob 绑成一个具名预设：

| 预设名 | 沙箱档 `sandbox/mode` | 审批策略 `approval/policy` |
|---|---|---|
| `workspace-write` | `workspace-write` | `ask` |
| `danger-full-access` | `danger-full-access` | `never` |

机制要点与本项目映射：

| dsh 机制 | 借鉴点 | 本项目对应 |
|---|---|---|
| 预设只是**两个 knob 的命名组合**（`dsh-sandbox-policy` 管沙箱档、`dsh-user-approval` 管审批策略），预设层自身无强制逻辑 | 印证 architecture v1.2「沙箱=能力 / 审批=授权二维正交」：治理模块应暴露 setter 而非揉在一起 | §6.1 Permission × §6.2 Sandbox 两模块两调用点（crate C4/C5 各自独立） |
| `custom` 是**派生态非预设**：当前（sandboxMode, approvalPolicy）组合不在预设表时返回 custom，可展示不可切换、不进事件 payload | 「当前生效档」与「可命名档」分离建模，UI 层才有意义 | Permission/Sandbox 的当前态查询接口设计 |
| 切换预设 = 追加**仅日志、持久化的 `permission/preset` 事件**，再分别 setter 写入，生效值未变则不写 | 治理变更本身作为可审计事件入流（复用现有 EventBus 通道即可） | §7 RuntimeEvent 扩展 `sandbox:mode` / `permission:policy` / 组合预设事件 |
| 新会话默认档由配置 `defaultPreset` 决定，缺省取「默认沙箱×默认审批」能匹配到的预设 | 治理默认值来自组装层配置，而非引擎硬编码 | Agent/Recipe 装配期可带 sandboxMode/policy 默认 |
| 前置校验：当前 shell 执行器若不支持 `sandboxMode`（无能力施加隔离的 `ctx.shell`）则组合抛错 | 能力面需**声明式能力探测**：工具/执行器先声明支持档位，宿主再绑治理 | Sandbox 注入前的能力协商（可对照 codex `sandboxing` 的平台翻译器） |
| `workspace-write` 语义 = 工作区可写 + 越界/敏感 ask（对齐 codex 同名档） | 命名直接沿用 codex/dsh 三档词汇，避免自造 | §6.0.1 `SandboxMode` 表格同步勘误源 |

### → M5 产品化/包化（P1 形态参考）：极薄内核 + 能力全插件

| dsh 事实 | 借鉴点 | 本项目对应 |
|---|---|---|
| 官方文档将全部能力划分为 40+ **子系统**（subsystems），每个子系统一个插件包与一页 reference | 「能力即子系统」的组织粒度：每个子系统 = 接口契约 + 独立实现包 + 独立文档页 | crate-architecture C3~C9 的外置清单可照此粒度细化成「子系统目录」 |
| 平台接入也是插件（HTTP 服务器 / Web Client / 设置 / 凭据管理），**UI 与配置面不内建于内核** | UI/控制台是注入件而非引擎层；进程内/子进程桥只是又一个 adapter | A1 apps + C8 host 之上再接 UI 子系统插件 |
| 有**多语言 SDK 面**（官方 Python SDK、apps/cli、Web UI 三种入口共用同一 harness） | 印证「Desktop/Host 只是消费同一引擎」；且 SDK 多形态是产品化的自然产物 | M5 的 examples 多形态（codex-reference 也指向同一结论） |
| Cordis 提供配置重组合 + HMR 热重载，能力替换不改源码 | 宿主层可做「配置驱动装配」，作为未来（architecture §11 未排期）能力开关的基础 | crate-architecture 记录过「本项目无 config 模块」待决项 |
| 一切皆插件的代价：**语义分散在插件间**，会话/审批/执行的行为需阅读大量插件组合才能推导 | 反例提醒：**不要为本项目引入 Cordis 级插件内核**；保持「固定内核 + 少量接缝 trait」更利于按里程碑交付 | 维持 C2 core 收敛哲学，不扩散插件运行时 |

### → M2 / 会话持久化（P2 参考）

| dsh 事实 | 借鉴点 | 本项目对应 |
|---|---|---|
| 官方 reference 有「会话持久化」子系统（session/rollout 语义需读源码核实） | 会话恢复与回放是 harness 标配，方向再次确认 | M2 Checkpoint / storage 域（与 codex rollout 观察同源，互相印证） |
| 权限切换/审批操作**以事件形式入持久化日志** | 审计日志 = 事件流的一个只写投影，天然可重建 | §7 Event + Storage 审计域 |

### → ModelProvider 面（P2 参考）

| dsh 事实 | 借鉴点 | 本项目对应 |
|---|---|---|
| 官方子系统含「LLM 流式与 Token 计量」，与执行、策略平级 | 流式 + token 计量是 Provider 面应提供的标准能力，非引擎特性 | `provider.ts` / `ModelProvider` 的演进清单 |

---

## 3. 关键源码/文档落点（要抄时直接去这些路径）

| 目标 | 路径（deepseek-ai/deepseek-harness） |
|---|---|
| 权限预设（双 knob 组合语义） | `packages/interaction/permission-presets`（`dsh-permission-presets`）；文档 `reference/subsystems/permission-presets` |
| 沙箱档位写入 | `dsh-sandbox-policy`（`ctx.sandbox` / `sandbox/mode`） |
| 审批策略写入 | `dsh-user-approval`（`ctx.approval` / `approval/policy`） |
| 执行工具面 | 文档子系统：Bash/子进程/PTY/文件系统/LSP/代码运行时/Web |
| 会话持久化 / LLM 流式与计量 | 文档子系统对应页；实现散布于 `packages/` 与 `docs/` |
| 插件开发范式（Cordis） | 文档 `/develop/cordis-tutorial/`（7 篇）、`/reference/cordis-primer` |
| 仓库全貌 / 入门 | 根 README、`docs/architecture.md`、`apps/cli/README.zh.md`、`SAFETY.md` |

---

## 4. 借鉴注意事项

1. **许可**：MIT。可直接抄代码/文档，但仓库自带 `SAFETY.md`/`BRAND_GUIDELINES.md`/`THIRD_PARTY_NOTICES.md`，品牌与安全要求需遵守；本文档引述与「抄机制」无此负担。
2. **极不稳定**：v0.1 developer preview，官方明示**必有破坏性变更**（包名/插件 API/配置语义都会动）。只采**语义与分层思路**，别锁依赖其 API；任何字段名以开工时主分支为准。
3. **插件内核不可轻迁**：Cordis 是其组织核心，抄它的「子系统化」≠ 引入插件框架；本项目维持「core + 少量接缝」，控制引入面。
4. **二手信息未采信**：中文渠道的「标准/PTC/极简/创造」四模式未经官方文档证实（见 §1 存疑待核），不得据此设计本项目 preset 面。
5. **成本预期**：真正可落地省时点 = M3 的「沙箱×审批预设组合 + 切换即审计事件」语义，以及 M5 包化时的「子系统目录」粒度。模型路由/token 计量/UI 插件化属远期，仅存档。

---

## 5. 与主架构文档的关系

- 本文件为**独立参考文档**，不并入 `docs/architecture.md` / `crate-architecture.md` 各章节；§6、§11 等不因本文档产生条目改动，不参与 CHANGELOG 版本条目（与 `codex-reference.md` 同规则）。
- 若后续某里程碑真正借鉴其中机制（预期最早为 M3 治理），再在该里程碑设计修订或 CHANGELOG 条目中**引用本文件**并回填实现对照。
- 本文件与 `codex-reference.md` 构成两个正交样本：codex-rs（Rust，收敛 core + 外置 crate）与 dsh（TS，极薄内核 + 全插件）；二者在本项目文档中的角色均为**机制参考而非基座**。
