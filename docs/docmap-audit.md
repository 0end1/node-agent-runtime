# Agent Runtime 文档全量盘点与维护审计

> 盘点范围：`main` 分支（`9142ec3`，M6-12）仓库内全部 **16 个 Markdown 文档**
> 盘点时间：2026-09-08 ｜ 判定基线：**12 workspace 包最终事实**（M6-9~M6-11 审查整改 + M6-12 元数据对齐，`npm run check:api` 0 差异）
> 图例：✅ 与基线一致 ｜ 🟡 局部滞后/需同步 ｜ ⚠️ 已陈旧（历史决策被后续推翻而未回填）
> **更新（2026-09-08，M6-13）**：§6 的 P0/P1 修正清单已全部执行（README / crate-split-todo / m6-productionization / development-checklist / remaining-tasks / crate-architecture / desktop-tauri README）。§1~§5 为审计时点（M6-12）快照；修正后各目标文档均已对齐 12 包终局口径，执行记录见 §7。

---

## 1. 目录树总览（含维护状态）

```
20260904182803/  (main @ 9142ec3)
│
├── README.md ......................... 🟡 拆包后 SDK 视图未同步（结构树/示例导入过时）
├── CHANGELOG.md ...................... ✅ 活跃维护（Unreleased M6-1 ~ M6-12，随 commit 同步）
│
├── docs/
│   │   ── 架构与设计 ──
│   ├── architecture.md ............... ✅ v1.9（§5.3/6.1/6.2/8.1/9 实现注记位置旧，建议补迁出注记）
│   ├── crate-architecture.md ......... 🟡 修订止于 v0.10，缺 12 包（artifact/tools-basic/mock）修订行
│   ├── codex-reference.md ............ ✅ 静态参考（明确不参与主线修订，无时效义务）
│   ├── deepseek-harness-reference.md . ✅ 静态参考（同上）
│   │   ── API / 契约 ──
│   ├── api-surface.md ................ ✅ 已脚本化复核（12 包，与 baseline.json 0 差异）
│   │   ── 执行清单 / 里程碑 ──
│   ├── m5-productization.md .......... ✅ 归档型验收依据（#5 移交注记清晰）
│   ├── m6-productionization.md ....... 🟡 P1 段仍写「9 包」，未并 12 包 & M6-9~11 摘要；P2.7 ✅ 已标
│   ├── development-checklist.md ...... 🟡 §0/§3.1 停在 M6-8 视图（未体现 P2.7 ✅ 与整改闭环）
│   ├── remaining-tasks.md ............ 🟡 池子停在 M6-7 视图，正文含「B1 进行中」旧态，可归档化
│   ├── crate-split-todo.md ........... ⚠️ §5 决策 C1 仍写「不出 core」——与最终「拆 host」矛盾
│   │   ── 审查 / 封板 ──
│   ├── p1-review.md .................. ✅ P0/P1/P2 整改结果完整（M6-11 回填）
│   └── final-review.md ............... ✅ 单一核对入口（Gate 4 前置总表）
│
└── examples/desktop-tauri/README.md .. 🟡 「C8 host 未拆」的未来态描述已过时（host 已拆出且已接线）
```

---

## 2. 逐文档档案（路径 / 类别 / 概述 / 最后内容变更）

| 路径 | 类别 | 行数 | 主要内容概述 | 最后变更(提交) |
|---|---|---|---|---|
| `README.md` | 入口·用户 | 209 | 快速开始（demo:cli/web、OpenAI 兼容接入）、核心概念表（ModelProvider→Artifact）、主循环伪码、代码示例、Session 管理示例、项目结构、事件表、能力参考（M1~M4）、内置工具、验证命令 | 2026-09-08 (`f06275c` M6-10) |
| `CHANGELOG.md` | 变更历史 | 428 | Unreleased M6-1~M6-12（拆包/整改/脚本化）+ M5~M0 各里程碑条目，分类 Added/Changed/Fixed/Docs，维护约定在头部 | 2026-09-08 (`9142ec3` M6-12) |
| `docs/architecture.md` | 架构设计 | 556 | 分层图（Desktop/Host/Core/Storage/接入层）、模块地图、生命周期语义、数据流与 Run 循环、Tool/Model/MCP 接缝、Permission/Sandbox 治理、Event 全集、Artifact/Memory、Storage/Persistence、目标目录、演进路线 M0~M6、12 条设计原则、修订表 v1~v1.9 | 2026-09-08 (`bcdc5f3`) |
| `docs/crate-architecture.md` | 架构·边界研究 | 202 | codex-rs workspace 借鉴、C1~C9+A1 模块边界主表、依赖图、6 条边界规则、与 architecture 的关系、落地形态 A/B 对比、待决清单、修订表 v0.1~v0.10 | 2026-09-07 (`d23f235` M6-7) |
| `docs/codex-reference.md` | 外部参考 | 106 | openai/codex 机制借鉴（沙箱三档、execpolicy、审批、rollout、MCP、模型层），按本项目里程碑映射，关键源码落点表，许可与注意事项 | 2026-09-05 (`797a2ca`) |
| `docs/deepseek-harness-reference.md` | 外部参考 | 109 | dsh 插件化形态分析（Cordis）、permission-presets 双 knob 语义、会话持久化/模型面，M3/M5 映射与注意事项（含二手信息存疑标注） | 2026-09-07 (`1687fcf`) |
| `docs/api-surface.md` | API 冻结 | 124 | 0.2.0 各包导出符号总览（12 包 + 依赖方向）、逐包导出清单、types 防腐红线、§13 变更规则与 check:api 复核流程 | 2026-09-08 (`bcdc5f3`) |
| `docs/m5-productization.md` | 里程碑清单 | 76 | M5 非拆包前置项 #1~#6（CLI/Web/Desktop/sqlite/E2E/文档），验收口径与移交注记 | 2026-09-07 (`66cd72d`) |
| `docs/m6-productionization.md` | 里程碑清单 | 137 | M6 P1~P6 六批执行清单、Gate 1~6 退出标准、差距基线表、顺序与依赖（P1 已完成 ✅，P2.7 ✅，其余 ☐） | 2026-09-08 (`7ca8b92` M6-11) |
| `docs/development-checklist.md` | 总览索引 | 103 | 0~M7+ 阶段总览表、M0~M4 能力交付、M5 产品化明细、M6 P1~P6 状态、M7+ 候选池、维护约定 | 2026-09-07 (`09e01be` M6-8) |
| `docs/remaining-tasks.md` | 遗留池索引 | 92 | A 验收收口 / B 拆包 / C 开放决策 / D 远期四池总表，A1~A4 与 D 仍 ☐（去向已重排 P5/P2/P2/P6），维护约定 | 2026-09-07 (`d23f235` M6-7) |
| `docs/crate-split-todo.md` | 拆包执行清单 | 75 | 拆包批次 1~4 执行与验收、C1~C4 决策记录、§6 通用验收标准（末项未勾选） | 2026-09-07 (`d23f235` M6-7) |
| `docs/p1-review.md` | 审查 | 131 | M6 P1 拆包审查结论速览、逐包审查、8 重点问题（Q1~Q8）、P0/P1/P2 整改建议与 §3.1 执行结果（全部 ✅，M6-11） | 2026-09-08 (`7ca8b92` M6-11) |
| `docs/final-review.md` | 审查封板 | 119 | 7+1 主题结论总表、逐项核验、MCP-as-Tools 落点、Gate 4 复核命令、关联文档清单 | 2026-09-08 (`bcdc5f3`) |
| `examples/desktop-tauri/README.md` | 示例文档 | 86 | Tauri v2 壳：目录结构、前置、dev 运行、图标生成、生产打包（sidecar/bundle 结构/产物路径）、C8 拆包关系说明 | 2026-09-07 (`1c105ef` M5-6) |

---

## 3. 一致性与过时审计（对 12 包基线）

### 🔴 需优先修正（事实冲突）

1. **`docs/crate-split-todo.md` §5 决策块**：仍记录早期决策「§8-5 已定：不出（不拆 C8 host）」；该决策已被 `remaining-tasks.md` §3-C1 **修订为「拆」** 并已执行（M6-7 拆出 host）。属被推翻而未回填。§2/§3 亦将 `artifact` 描述为「实现并入 C3 memory」「checkpoint 待迁」，与 M6-9 拆出 `artifact` 包、M6-10 checkpoint 归位 memory 矛盾。→ 建议收尾勾选后整体标注「M6 已执行完毕，归档」。
2. **`README.md` §项目结构**：core 子树仍含 `session.ts`（已迁 host）、`tools/`、`providers/`（已迁 tools-basic/mock），mcp 子树所列 `types/schema/util` 系 C1 旧文件——是拆包前的旧树残留，与同页 12 包外层列表自相矛盾。
3. **`README.md` 代码示例**：`import { MockProvider, builtinTools } from "./src/index.js"` —— 单包时代路径；M6-9 起二者属 `@agent-runtime/mock` / `@agent-runtime/tools-basic`（core facade 亦不再导出），示例无法被新消费者照抄。

### 🟡 局部滞后（有事实源兜底，但措辞/快照需同步）

4. **`README.md` 核心概念 / 能力参考**：以「内置 MockProvider / builtinTools、core 自带」叙述，需补 12 包导入口径（指向 architecture §10 / api-surface §0）。
5. **`docs/m6-productionization.md` P1 段**：Gate 1 关闭注记仍写「9 个 workspace 包」；最终为 **12 包**（M6-9 增补 artifact/tools-basic/mock）。P2.7 已 ✅ 但 P1.6 行「9 包导出面」需顺带改为 12 包。
6. **`docs/development-checklist.md`**：§0 M6 行与 §3.1 P1 描述停在「9 包 + Gate1」视图；P2 行整体 ☐，未将 **P2.7（api-surface CI）✅** 拆出勾选；M6-9~11 审查整改（1804→1005 行等）未在 M6 行体现。
7. **`docs/crate-architecture.md`**：修订记录止于 **v0.10（M6-7）**；缺 v0.11 行记录 12 包终局（artifact/tools-basic/mock、checkpoint 归位 C3、classifyToolName 下沉 C1、事件总线可注入、M6-9~11 整改）。头部「状态：C1/C2 已落地 v0.2」亦旧。§3 C3 行「Artifact 实现并 C3」已被 M6-9 推翻。
8. **`docs/remaining-tasks.md`**：正文「当前执行：…B1（mcp）进行中」与「B2 移出 M6」为 M6-7 中间态叙述；现 B1~B4 与 C1~C4 全部完成。属历史索引，宜加「已于 M6 收口」注记归档。
9. **`examples/desktop-tauri/README.md` 末节**：「未来若拆 C8 host，examples 把 import 源从 core 换成 host 即可」——C8 host 已拆（M6-7）且 `examples/*` 已切至 `@agent-runtime/host`（M6-9/M6-10），该句描述的"未来"已发生，建议改写为现状说明。
10. **`docs/architecture.md` §5.3/§6.1/§6.2/§8.1/§9 实现注记**：仍注明「落地于 C2 `packages/core/src/{mcp,artifact,permission,sandbox}…`」。§10 v1.9 注记与 §13 已给出终局（12 包），故不算错，但按文件名/目录检索会误导——建议在各注记尾部补一行「M6 已迁出至 @agent-runtime/*」。
11. **`docs/architecture.md` §11 M6 行**：Gate 1 关闭注记内文「9 个 workspace 包」为 M6-8 措辞；v1.9 更新在同一格内补充了 12 包说明，需连读才不误解（建议精简为终局表述）。

### ✅ 与基线一致（无需动作）

12. `CHANGELOG.md`（活跃维护）、`docs/api-surface.md`（脚本化 0 差异）、`docs/p1-review.md`、`docs/final-review.md`、`docs/m5-productization.md`（归档定位）、`docs/codex-reference.md`、`docs/deepseek-harness-reference.md`（静态参考，无时效义务）。

---

## 4. 缺失 / 待补文档（映射 M6 未办批次）

| 缺失项 | 状态 | 映射批次 |
|---|---|---|
| `LICENSE`（根 + 各包） | 缺失 | M6 P4.1 ☐（发布前置，Gate 4） |
| `CONTRIBUTING.md` / `SECURITY.md` | 缺失 | M6 P6.1 ☐ |
| `.github/workflows/ci.yml`（含 typecheck/lint/test/build/coverage/e2e/audit/**api-surface** job） | 缺失 | M6 P2.1~P2.7 ☐（脚本与基线已就绪，仅差 CI 编排） |
| 根 `.nvmrc` / `packageManager`（engines 口径统一） | 缺失 | M6 P4.3 ☐ |
| README「生产用法」节（安装/升级/配置/观测/发布 + badges） | 缺失 | M6 P6.2 ☐ |
| `docs/` 目录索引页（本盘点即候选；目前索引职责压给 development-checklist §5） | 缺失 | — |
| `examples/cli` / `examples/web` 独立 README | 缺失 | —（desktop 已有） |
| `docs/crate-split-todo.md` §6 末项「文档同步」勾选 | 未勾选 | 随 #1 收尾归档 |

---

## 5. 重复内容与交叉引用关系

### 5.1 索引-清单嵌套链（有意为之，维护约定「双源同步」）
```
final-review.md（封板总表）
 ├─ architecture.md（v1.9 · §13 修订表）＋ crate-architecture.md（边界 · §9 修订表）
 └─ api-surface.md（API 冻结 · 脚本基线）
development-checklist.md（总览索引）
 ├─ m6-productionization.md（M6 执行清单） ── P1 吸收 crate-split-todo.md ── 引用 remaining-tasks.md A~D
 ├─ m5-productization.md（M5 验收依据）
 └─ architecture.md §11（路线图）
CHANGELOG.md（贯穿所有条目的变更事实）
```
> 风险点：链条越长，漂移窗口越大——本次审计发现的 🟡 项（m6/development-checklist/crate-architecture 未同步到 12 包）即漂移实例，与 §4 的 final-review「单一核对入口」设计意图正好印证。

### 5.2 事实重复点（多文档各自快照，口径须一致）
| 事实 | 出现位置 | 状态 |
|---|---|---|
| 依赖方向 / 12 包清单 | architecture §10(v1.9)、api-surface §0、p1-review §3.1、final-review §2 | architecture 与 api-surface/p1/final 一致；**m6 P1 注记与 development-checklist 仍写 9 包** |
| core 行数轨迹 1804→1146→1005 | architecture §10/§13、api-surface §0/§2、p1-review §0/§1/§3.1、final-review §2.1、CHANGELOG M6-9/10 | 均一致 |
| 事件全集（RuntimeEvent 判别联合 + EventEmitter） | architecture §7、api-surface §1 events、README 运行事件表、final-review §2.3 | 作用域不同（设计全集/实现全集/演示子集），一致 |
| C1~C4 决策记录 | remaining-tasks §3、crate-architecture §8、crate-split-todo §5、m6 P1.1 | **crate-split-todo §5 的 C1 记录已被后续修订推翻（未回填）** |
| Tool 接缝 / MCP-as-Tools | architecture §5.3、final-review §3、p1-review Q5 | 一致 |

### 5.3 版本号体系（互不冲突，各自域内自洽）
- `architecture.md` §13：v1 ~ **v1.9**（设计修订）
- `crate-architecture.md` §9：v0.1 ~ **v0.10**（边界/拆包修订；缺 12 包收尾）
- `api-surface.md`：修订轨迹 + `scripts/api-surface.baseline.json`（冻结快照）
- `CHANGELOG.md`：M0 → M6-**12**（变更条目）
> 跨域引用时须带版本号避免混淆（如「architecture v1.9 §13」vs「crate-architecture v0.10」vs「M6-11」）。

---

## 6. 维护建议（按优先级）

| 优先级 | 动作 | 涉及文件 |
|---|---|---|
| P0 | 回填 crate-split-todo §5 决策（C1 修订为「拆」）、批次表 artifact/checkpoint 终局，整体勾选归档 | `docs/crate-split-todo.md` |
| P0 | README 结构树与示例改 12 包形态（内置工具/Mock 移出 core 的导入口径），概念表补包名 | `README.md` |
| P1 | m6 P1 段补 12 包注记；development-checklist §0/§3.1 同步 P2.7 ✅ 与 M6-9~11 摘要 | `m6-productionization.md`、`development-checklist.md` |
| P1 | crate-architecture 补 v0.11 修订行（12 包终局）并刷新头部状态 | `docs/crate-architecture.md` |
| P1 | remaining-tasks 加「M6 已收口」归档注记；desktop README 末节改现状 | `remaining-tasks.md`、`examples/desktop-tauri/README.md` |
| P2 | architecture §5.3/6.1/6.2/8.1/9 注记尾部补「M6 已迁 @agent-runtime/*」；§11 M6 行精简为终局 | `docs/architecture.md` |
| P2 | 将本盘点沉淀为 `docs/` 索引页（可选），作为 P6.2/6.4 文档收敛的输入 | 新增（待定） |
| P3 | LICENSE / CONTRIBUTING / SECURITY / CI 编排等缺失项随 M6 P2/P4/P6 补齐 | 新增（见 §4） |

> 约定提醒：任何同步动作须按项目维护惯例「源清单 + CHANGELOG + 代码同一 commit」执行，并复跑 `npm run check:api` 确保未触碰公共面。

---

## 7. 修正执行记录（M6-13，2026-09-08）

| 修正项 | 目标文件 | 状态 |
|---|---|---|
| P0-1 结构树/示例/概念表改 12 包形态 | `README.md` | ✅ 已执行 |
| P0-2 决策回填与归档收尾 | `docs/crate-split-todo.md` | ✅ 已执行（归档注记 + C3 状态 + §6 勾选） |
| P1-1 m6 / checklist 对齐 12 包终局 | `docs/m6-productionization.md`、`docs/development-checklist.md` | ✅ 已执行（P1.1/P1.6/进度追注、P2.7 ✅） |
| P1-2 crate-architecture v0.11 与状态刷新 | `docs/crate-architecture.md` | ✅ 已执行（v0.11 行 + 头部状态 + §3/§8 落定） |
| P1-3 remaining-tasks 归档注记 | `docs/remaining-tasks.md` | ✅ 已执行（决策状态/B2 行/§3 修订注记） |
| P1-4 desktop README 现状改写 | `examples/desktop-tauri/README.md` | ✅ 已执行 |
| P2-1 实现注记补「M6 已迁出」追注 | `docs/architecture.md` | ✅ 已执行（§5.3/6.1/6.2/8.1/8.2/9 共 6 处） |
| P2+ 同类未来态表述（审计未列，顺带修正） | `docs/m5-productization.md` | ✅ 已执行（原则行 + Desktop 明细行） |
| 随批同步 | `CHANGELOG.md` | ✅ 已执行（M6-13 条目） |

**复核说明**：`docs/architecture.md` §10 现状注记（v1.9）与 §11 M6 行在审计时已含 12 包/1005 行表述，属历史递进叙述，本次未改写，仅补实现注记迁出追注；§3 审计项 #10/#11 据此视为已闭环。

**剩余建议（P3，未执行）**：缺失文档（LICENSE / CONTRIBUTING / SECURITY / CI 编排 / 根 `.nvmrc` / README 生产用法节 / docs 索引页）随 M6 P2/P4/P6 补齐，见 §4。
