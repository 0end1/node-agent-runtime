# Runtime crate 化边界与依赖图（workspace 形态草案 v0.2）

> 本文是 `docs/architecture.md` 的**研究附篇**：把 §2 的 Runtime 模块树按 codex-rs 的 workspace 组织方式重排为一张「模块边界 / 依赖图」，供后续决定是否及如何拆包 / 移植。
> 约定：v0.1 只产出边界设计，不改代码、不承诺落地；**v0.2 起按 §7.1 方案 A（npm workspaces）落地 C1/C2，公共 API 不变**。
> 相关机制出处见 `docs/codex-reference.md`。
> 日期：2026-09-05 · 状态：**C1~C9 边界落地完成 —— 12 包终局（2026-09-08，M6-12）**；§3~§8 为研究/决策史，当前进度见 §0 与 §9 修订记录

---

## 0. 结论速览

- 学 codex-rs 得到的组织精髓**不是「一个模块一个 crate」**，而是「**一颗收敛的 core + 外置的接缝 crate**」。
- 拟议拓扑（自底向上）：**types 底座 → core（引擎唯一实现面）→ 外置能力面（memory / sandbox+policy / mcp / model 后端）→ host（Session 等产品面）→ apps**。
- 边界是否落地的两个候选形态：**npm workspaces（TS，保留现码）** 与 **Rust workspace（对齐 codex，等于重写）**；本文给出两者的迁移路径对比与建议（见 §7）。
- 无论最终选哪种形态，现在即可执行且两形态通用的收敛动作见 §7.3。
- **v0.2 落地进度**：已按 §7.1 方案 A 完成 C1（types 底座）与 C2（core 引擎）两包的 npm workspaces 收敛，公共 API 不变；§8 待决项中 #1（形态）、#6（createDemoAgent）已定，其余待里程碑推进。
- **后续进度**：M2（memory/checkpoint，2026-09-07）与 M3（sandbox/permission，2026-09-07）功能均先落 C2 包内（`packages/core/src/`），C3~C5 拆包留待 M5 收口。
- **当前进度（2026-09-08，M6-12）**：M6 P1 拆包（B1~B4，§9 v0.4~v0.10）已全部完成；M6-9~11 自查整改把 `Artifact` 拆为独立包 `@agent-runtime/artifact`（原 §8-4 / §3「归属待定」就此落定）、`MockProvider`/内置工具外置为 `mock`/`tools-basic`、`checkpoint` 归位 memory、`classifyToolName` 下沉 C1，形成 **12 包终局**（types ← {memory, artifact, sandbox, policy} ← core ← {tools-basic, mock, host, mcp, provider-openai, store-sqlite}）；core 收窄至 1005 行，`npm run check:api` 0 差异。详见 §9 v0.11 与 `crate-split-todo.md` 归档注记。

---

## 1. codex-rs 的可迁移组织原则（对应 codex-reference.md §1/§2）

codex-rs 的真实布局：`core` 是唯一大 crate（内含 `session/`、`context/`、`tools/`、`agent/`、`compaction/` 等目录），真正独立成 crate 的是它周边的**接缝**：

| codex-rs 实际形态 | 提炼原则 | 对本项目的含义 |
|---|---|---|
| 主循环与产物处理收敛在 `core`；目录即模块 | **大 core + 内部分目录**，不追求每模块一 crate | `runtime`/`agent`/`context`/`tools`/`events` 应收敛为单颗 `core`，内部按目录分 |
| `sandboxing/`、`execpolicy/` 独立 crate，经 trait 挂到 core | **边界实现外置**：隔离/审批这种平台相关、要独立测试的代码不与主循环耦合 | M3 的 `sandbox.ts`/`permission.ts` 立项即独立包，不写进 `runtime.ts` |
| `rollout/`、`thread-store/`、`agent-graph-store/` 独立于 core | **持久化是独立子系统**：存储有自己的真相源语义，core 只认读写 trait | `store` 接口已抽好（§9），其文件/未来 SQLite 实现可外置 |
| `model-provider` + `ollama`/`lmstudio` 各为独立 crate | **模型接入面 trait 独立，后端实现可插拔** | `provider.ts` 的 trait 与 openai/mock 后端分属不同单元，core 不 import 具体后端 |
| `mcp-server` / `rmcp-client` 独立 crate | **协议翻译外置**，产物（Tool）送回 core | M4 的 `mcp/` 独立成包 |
| `tui` / `exec` / `app-server` 三个 bin 共享同一 core | **库与入口分离**，入口只消费公开 API | `examples/*` 与未来 desktop 只依赖包的 public API |
| `config/`、`features/` 独立 | 配置与能力开关自成一模块 | 本项目尚无 config，列入远期注记（不展开） |

> 判断：nodeRuntimes 不必仿照「crate 文件数」而应仿照「**可独立编译 / 独立测试 / 显式依赖声明的单元划分**」。

---

## 2. 迁移前依赖快照（src，2026-09-05，单包平铺；v0.2 已拆为 packages/{types,core}）

```
L4 生命周期  session.ts ─────────────▶ runtime.ts（AgentRuntime 主循环）＋ store/types
L3 执行      runtime.ts ◀── tools/builtin（依赖 tool/util/calculator）
             providers/{openai-compatible,mock}（依赖 provider/types/tool/util/builtin）
L2 装配      agent.ts / context.ts / tool.ts / provider.ts / store/{types,memory,file}
L1 叶        types.ts · schema.ts · util.ts（零内部依赖）
聚合出口     index.ts（一次性导出全部，含 createDemoAgent 演示工厂）
```

对照 crate 化的**缺口**：

1. 无包级显式依赖声明——边界只靠目录与 import 纪律。
2. `tool.ts` 与 `provider.ts` 承载了「契约类型」与「可执行面」，未来 MCP / 远程后端要外置时会牵扯引擎内部类型。
3. `store` trait 已抽好，但内存/文件实现与接口同居（可整体视为 core 内置，或将非零依赖实现外置）。
4. `runtime.ts` 主循环承担 Step/Run，且 M1 起被 `session.ts` 依赖——这是现状依赖，拆包时 `session.ts` 天然归属上层（host）。
5. M2~M4 模块（memory/checkpoint/sandbox/permission/mcp/artifact）尚无代码，边界可「先立规矩后实现」。

---

## 3. 拟议 workspace 布局（模块边界主表）

> 每行给出 TS 包名（`@agent-runtime/*`，npm workspaces）与 Rust crate 名（`agent-runtime-*`，cargo workspace）两套标签；**命名不锁定，形态二选一**。
> 「依赖」列仅列 crate 之间的方向性依赖；同包内目录不算。

| # | 单元（TS 包 / Rust crate） | 内容（源文件 ↔ 未来模块） | 职责 | 依赖 | codex 参照 | 里程碑 |
|---|---|---|---|---|---|---|
| C1 | `@agent-runtime/types` / `agent-runtime-types` | `schema.ts`（JsonSchema+validate）、`types.ts`（ChatMessage/ToolCall/RunUsage…）、`util.ts`（纯函数）+ 事件**类型** + tool/message 契约**类型** | 全仓库最底层共享语言：类型、校验器、零 IO 纯函数；不 import 本仓库任何其他模块 | 无 | wire-api / shared | 收口拆分（M5 前可随时做，不动公共 API） |
| C2 | `@agent-runtime/core` / `agent-runtime-core` | `runtime.ts`、`agent.ts`、`context.ts`、`events.ts`（EventBus 实现）、`tools/`（tool 注册、builtin、calculator）、`store/`（Storage 接口 + `MemoryStorage`/`FileStorage` 内置） | 引擎唯一实现面：Run/Step 主循环、Agent 配方、Context 门面、事件总线、内置工具；认识 trait 不认识具体后端。内部再按 codex 方式分目录 | C1（type-only + 校验） | `core/`（含 session/context/tools 目录）+ 内置 rollout 雏形 | 现有 M0/M1 已实现，仅目录收敛 |
| C3 | `@agent-runtime/memory` / `agent-runtime-memory` | 未来 `memory.ts` + `checkpoint.ts`（Checkpoint 结构 + resume 恢复协议，toolsHash 一致性校验） | M2：会话记忆接口 + 事实层 + Run/Step 级可恢复快照；只读写 Storage 契约，独立测试 | C1、C2（store trait 与事件类型） | `rollout/`、`rollout-trace/`；core/src/session 的 turn/step 冻结 | M2 |
| C4 | `@agent-runtime/sandbox` / `agent-runtime-sandbox` | 未来 `sandbox.ts`：SandboxMode 三档、SandboxScope 声明域、gate()、LocalSandbox（超时/越界拒绝），网络默认禁网 | M3 运行层执行域边界；平台翻译/隔离实现放这里而非 runtime | C1（事件类型 `sandbox:write`） | `sandboxing/`、`linux-sandbox/`、`bwrap/`、`exec-server/` | M3 |
| C5 | `@agent-runtime/policy` / `agent-runtime-policy` | 未来 `permission.ts`：PermissionPolicy.decide、PermissionManager.gate、审批流事件；默认 FileAccessPolicy/NetworkPolicy | M3 授权决策：allow/deny/ask + ask 结果持久化为规则；与 sandbox 二维正交（沙箱=能力、审批=授权） | C1、C2（run 主循环的 gate 调用点） | `execpolicy/`、core/tools/approvals.rs、network_approval.rs | M3 |
| C6 | `@agent-runtime/mcp` / `agent-runtime-mcp` | 未来 `mcp/`：types（Handle/Meta/Ref）、registry（物化为本地 ToolDefinition）、transport（stdio/http-sse）、client（JSON-RPC 2.0） | M4：远端 MCP Server 的唯一产物是「动态 Tool 集合」，注册后走 core 本地工具路径；资源映射为 Artifact | C1、C2（Tool 契约与 registry） | `rmcp-client/`、`mcp-server/`、core/tools/mcp.rs | M4 |
| C7 | `@agent-runtime/provider-openai` / `agent-runtime-provider-openai` | `providers/openai-compatible.ts` | OpenAI 兼容后端（wire_api：chat 线路）；由调用方注入，core 不 import | C1（消息/工具契约）+ ModelProvider trait（归 C2 或独立 model-trait） | `model-provider/`、`responses-api-proxy/` | M5（或随 M0 现状即外置） |
| C8 | `@agent-runtime/host` / `agent-runtime-host` | `session.ts`（SessionManager/Task/RunRecord）+ 默认 PermissionPolicy（M3）+ Memory/Checkpoint 注入（M2） | 产品/生命周期面：Session 状态机、Task 编排、Run 落库；依赖 runtime 公开 API（现状已如此） | C2、C3、（M3 起 C4/C5） | core/src/session 的 turn/step 语义 | M1 现有，随里程碑扩展 |
| C9 | `@agent-runtime/store-sqlite` / `agent-runtime-store-sqlite` | 未来 SQLiteStorage（依赖 better-sqlite3，**不进 core**） | 可选存储后端；只实现 Storage trait | C1 + Storage trait | `thread-store/`、`agent-graph-store/`（索引可重建侧） | M5（architecture §10 已预留） |
| A1 | apps：`examples/cli`、`examples/web`、[desktop] | 入口壳，消费 C1~C9 public API | 二进制/宿主形态，不参与引擎内部 | 上述任意 | `tui/`、`exec/`、`app-server/` | 持续 |

**聚合出口**：现有 `src/index.ts` 在 crate 化后收窄为 **facade**（逐包 re-export）；`createDemoAgent` 属演示工厂，移入 examples 或留在 facade 顶部（决策项，见 §8）。

**归属（已定，M6-9）**：`Artifact`（architecture §8）—— 类型入 C1（v0.7 落地）；实现未并入 C6/C3，而是于 M6-9 自查后**独立拆包 `@agent-runtime/artifact`**（一包一职责，`packages/artifact/`），见 §9 v0.11。

**远期注记**：仿 codex `config/`+`features/` 的配置/特性开关模块目前不存在于本项目，不入近期拓扑（§8）。

---

## 4. 依赖图（拓扑方向自底向上；箭头 = 依赖方向）

```
A1  apps        cli / web / [desktop]            （入口壳，只消费 public API）
     │
C8  host        session.ts（Session/Task/RunRecord）· 默认 Policy · Memory 注入
     │
     ├─────────────────────┐                    ┌──────────────────┐
C3  memory/checkpoint（M2）│                   │ C4 sandbox（M3） │
     │                    │                    │ C5 policy（M3）  │
     ▼                    │                    └────────▲─────────┘
C2  core：runtime 主循环 / agent / context /             │ gate() 单点
     │       tools（内置）/ events 总线 /                 │（run 循环内调用）
     │       store 接口 + memory/file 内置实现 ◀─────────┘
     │      · 认识 trait，不 import 任何具体后端
     │
     ├─────────────── C7 provider-openai / mock（注入式，core 不依赖）
     │
     ├─────────────── C6 mcp（M4）：Server → 物化为 Tool 交回 registry
     │
     ▼
C1  types 底座：schema / types / util / 事件类型 / tool·message 契约
     （零依赖，全仓库唯一被所有人引用的叶子）
```

关键语义：

- **C1 是唯一叶子**：所有 type-only 的共同语言都在底座，避免上层互相 import。
- **core 是全引擎唯一实现面**：Step/Run/工具执行只在 C2；C3~C7 通过 trait + 事件接入，各自可独立测试。
- **sandbox/policy 从立项起就独立包**（对齐 codex `sandboxing`/`execpolicy`），不写进 `runtime.ts`。
- **host 依赖 core 而非相反**：`session.ts` 现状 import `runtime.ts` 恰好印证其上层归属。

---

## 5. 边界规则（落包 / 落 crate 时照此执行）

1. **单向依赖**：只允许上 → 下（C2 可用 C1，C8 可用 C2…）；同层横向一律通过 C1 底座或事件解耦，禁止 core ↔ host、core ↔ memory 的双向。
2. **type-only 不算依赖**：TS 中 `import type` 不构成运行时环，但**新增包之间仍尽量把共享契约下沉 C1**；若未来转 Rust，trait 归属主 crate、实现 crate 单向依赖（与 §3 C7/C6 标注一致）。
3. **接缝即 trait**：`Storage` / `ModelProvider` / `ToolDefinition` / `PermissionPolicy` / `Sandbox` 五条接缝（architecture §12-4）；core 只认 trait，实现在 C3~C9 注入。
4. **事件类型进 C1、总线实现在 C2**：所有包都能发/订阅 `RuntimeEvent`，但只经 C2 的 EventBus（或每包自带事件，靠类型 union 进 C1）。
5. **可独立验证**：每个单元都有独立 `typecheck` 与测试入口——v0.2 起已随包迁移：`schema.test.ts`→`packages/types/test`（C1）；`runtime/store/calculator.test.ts`→`packages/core/test`（C2）；`session.test.ts` 随 session 暂留 C2（C8 拆分待定，见 §8-5）。Rust 形态对应 `cargo test -p`。
6. **IO 与协议翻译永远外置**：HTTP/MCP/SQLite 等不进 core（architecture §12-3），维持「core 零依赖」。

---

## 6. 与 architecture.md §10 目录结构、§11 路线图的关系

- §10 `packages/` 的四包设想（core / store-sqlite / mcp / host）在此扩展为 C1~C9 + A1 的完整边界图；§10 的「core+store/memory 永远零依赖」作为 C2 的硬约束保留。
- 里程碑承接（**先做功能、后做拆包**，拆包不阻塞功能交付）：

| 里程碑 | 本布局动作 |
|---|---|
| 现状 M0/M1 | src 按 C2 内部目录收敛（runtime/agent/context/tools/events/store），不改变公共 API；现有 35 测试必须全绿 |
| M2 记忆与续跑 | 已在 C2 `packages/core/src/memory.ts`、`checkpoint.ts` 内实现（含随包测试），**遵循§6 前言「先做功能、后做拆包」**：C3 `@agent-runtime/memory` 拆包留待 M5，避免 core ↔ memory 双向依赖 |
| M3 治理 | 已在 C2 `packages/core/src/sandbox.ts`、`permission.ts` 内实现（含随包测试），**遵循§6 前言「先做功能、后做拆包」**：C4 `@agent-runtime/sandbox`、C5 `@agent-runtime/policy` 拆包留待 M5；run 循环的 gate 接入点已由 C2 的 `RunOptions.gate` 提供 |
| M4 外部能力 | 已在 C2 `packages/core/src/mcp/`（types/jsonrpc/transport/client/registry）与 `artifact.ts` 内实现（含随包测试），**遵循§6 前言「先做功能、后做拆包」**：C6 `@agent-runtime/mcp` 拆包留待 M5；registry 物化结果复用 C2 工具注册路径 | **更新（2026-09-07，M6 批次 1 / split 分支）**：C6 已外置为 `packages/mcp/`（`@agent-runtime/mcp`），core `index.ts` 移除 mcp 导出，依赖方向 **mcp → core（工具契约）单向** |
| M5 产品化 | 包化收口：facade index、provider-openai 外置、store-sqlite 可选包、host 承接 Session 全流程；Desktop 壳只依赖 C8/C1 |

---

## 7. 落地形态二选一（决策参考）

| 维度 | 方案 A：npm workspaces（保留 TS） | 方案 B：Rust workspace（对齐 codex） |
|---|---|---|
| 对现有资产 | 直接搬移 + 改 import 包名；35 测试与 CLI/Web 示例原样可跑 | 等于新引擎：TS 代码与测试全部不可复用，需重写 |
| 「crate」语义强度 | 包边界靠 package.json + lint（如 no-restricted-imports）显式化；编译期不强制私有 | 原生 crate 边界 + 可见性编译期强制 |
| 生态 | 与现有 MCP SDK / 前端 / 多 provider 生态无缝 | Agent/LLM 生态在 Rust 侧相对窄 |
| 适合诉求 | 快速迭代、Web/Electron 嵌入、产品演示、多模型后端 | 单二进制分发、深层并发/性能、向 codex 形态完全看齐 |
| 迁移成本 | 低（多为文件移动与导入改写） | 高（逐模块移植，C1→C2→… 自底向上） |

**建议**：阶段 1 用 **npm workspaces** 把 C1~C9 边界先立起来——代码资产不变，收益即「显式边界 + 独立测试 + 可插拔包」，风险最低；若将来确有单二进制或性能诉求，再做 Rust 移植，届时本文件即移植蓝本（C 表逐行对应）。

### 7.1 若先走 npm workspaces 的最小动作

- 根包改 workspace 容器（`workspaces: ["packages/*"]`），`packages/` 下 C1/C2 先行（现在就能拆），其余按里程碑增补。
- 保留当前 `src/` 不动或原地收敛（§6 表格），`tsc -p` 项目引用代替全局单 tsconfig。
- 测试命令改为逐包 `--test`（先保持一条总命令全绿）。

**已按本条落地（v0.2-with-workspaces，2026-09-05）**：

- 根包成为 workspace 容器：`workspaces: ["packages/*"]`；`packages/types`（C1）与 `packages/core`（C2）两个私有包，`core` 显式声明 `@agent-runtime/types` 依赖。
- `src/` 单包平铺拆为两包：契约层（`schema/types/util`）入 C1；引擎实现（runtime/agent/context/events/session/store/tools/providers）入 C2。
- C2 聚合出口 `packages/core/src/index.ts` **顶部 re-export C1 全部导出**（`export * from "@agent-runtime/types"`），公共 API 面与拆包前一致，`examples` 与测试改为从 `@agent-runtime/core` / `@agent-runtime/types` 包名导入。
- 类型检查：根 `tsconfig.json`（paths 别名直指 `packages/*/src`，覆盖 packages + examples，`noEmit`）；构建：逐包 `tsc -p` 产出 `dist`（`main/types/exports` 指向 dist）。
- 测试随包迁移（§5.5）：`test/schema.test.ts`→`packages/types/test`（C1）；`runtime/session/store/calculator`→`packages/core/test`（C2，session 暂留 C2 而非 C8，见 §8-5）；根命令 `npm test` 先 `pretest` build 再逐包 `tsx --test`。
- 已清理：旧根 `src/`、`test/`、`tsconfig.examples.json`（被根 tsconfig 覆盖）删除。

---

## 8. 待决清单（开放问题，未定不阻塞 C1/C2 收敛）

> 状态标注：`[已定]` = 已落地 / 已明确；其余为开放项。

1. **形态二选一**：npm workspaces（推荐先做）还是 Rust workspace（长期向 codex 看齐）。`[已定]` 阶段 1 已按 **npm workspaces** 落地 C1/C2（v0.2）；Rust 移植保留为未来选项，届时本文即移植蓝本。
2. `tool.ts` 是否拆「契约描述层 → C1」与「执行门面 → C2」：TS 下靠 `import type` 可不拆；一旦转 Rust 必须拆。`[已定]` M6 已触发下沉：工具/事件契约入 C1（v0.8），`classifyToolName` 于 M6-9/11 下沉 C1。
3. permission 与 sandbox **是否独立两包**：本草案按 codex 推荐独立（C4/C5）。
4. Artifact（architecture §8）归 memory 包还是随 mcp 独立：草案倾向并入 C3 memory（同为 Storage 读写），M4 时定。`[已定]` M6-9 起**独立成包** `@agent-runtime/artifact`（v0.7 曾并入 memory，v0.11 修订）。
5. Session/Task/RunRecord 放 host（C8）：接受其依赖 runtime 公开 API 的事实；若想引擎侧也能用 Task，需再评估是否拆出 task 状态机。v0.2 暂留 C2，随 M5 收口再评估。`[已定]` M6 v0.10 已拆：C8 `@agent-runtime/host` 落地，core 不再导出 Session/Task（破坏性变更）。
6. `src/index.ts` 收窄为 facade 后，`createDemoAgent` 去向（保留顶部 vs 移 examples）。`[已定]` v0.2 死代码清理中移除 `createDemoAgent`（examples 均自行 `new Agent`）。
7. 远期是否引入 codex `config/features` 式的配置与特性开关模块（当前无，暂不入图）。

---

## 9. 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v0.4 (M5-1) | 2026-09-07 | M5 拆包收口第一批：C7 `@agent-runtime/provider-openai`（openai-compatible 迁出，core `providers/` 仅留 mock）与 C9 `@agent-runtime/store-sqlite`（`SQLiteStorage`，node:sqlite，docs/blobs/streams 三表）外置为独立包；根 build/test、tsconfig paths、lock、examples 接线；typecheck + 全量测试绿。C8 host 拆包试行后回滚（Session 暂留 C2，重评见 §8-5）；facade 收窄随 C6 / C3~C5 / C8 后续推进 |
| v0.5 (M6-B1) | 2026-09-07 | 拆包批次 1 落地：C6 `@agent-runtime/mcp` 外置为独立包 `packages/mcp/`（client/jsonrpc/registry/transport/types + index），`mcp.test.ts` 与 `fixtures/mock-mcp-server.mjs` 随迁；`registry.ts` 改从 core 取 `defineTool`/`ToolKind`/`classifyToolName`（§8-2 决策：契约 M6 暂不下沉）；core 收窄 mcp 导出以避免 core↔mcp 循环；根 tsconfig paths / build / test 与 `examples/cli.ts` 接线；typecheck 绿、全仓测试 0 fail（core 84 pass + 1 skip、mcp 15 pass）。§8 四项阻塞决策全部落定（全文见 `remaining-tasks.md` §3），C8 host 移出 M6 |
| v0.6 (M6-B3 前置) | 2026-09-07 | 共享契约下沉：`Storage`/`DocDomain`/`StreamDomain` 由 C2 `core/src/store/types.ts` 下沉至 C1（新增 `packages/types/src/storage.ts` 并导出），core 内 6 处引用改为从 types 导入、`index.ts` 经 `export *` 转发（公共导入面不变）。目的：C3（memory/artifact）等外置包只依赖 types，消除 core↔子包循环（§8-5 / §8-4 决策的落地手段）；typecheck 绿 + 全仓测试 0 fail |
| v0.7 (M6-B3) | 2026-09-07 | 拆包批次 3 落地：`memory.ts` + `artifact.ts` 外置为 C3 `@agent-runtime/memory`（`packages/memory/`），测试随迁；`Artifact`/`ArtifactKind`/`ArtifactInput` 契约下沉 C1（新增 `packages/types/src/artifacts.ts`）；`session.ts` 改从新包导入，core `index.ts` 移除实现导出（类型经 `export *` 转发，公共面不变）。**`checkpoint.ts` 暂留 core**：其 `computeToolsHash`/`assertResumable` 依赖 `Agent` 与工具契约（§8-2 未下沉），外置会形成包级循环，待契约下沉或 facade 收窄再迁。验收：typecheck 绿 + 全仓 0 fail（types 4 / memory 17 / core 67+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip） |
| v0.8 (M6-B3) | 2026-09-07 | 拆包批次 3 收尾：`sandbox.ts` → C4 `@agent-runtime/sandbox`、`permission.ts` → C5 `@agent-runtime/policy`（§8-3 决策：独立两包），测试随迁。为消除包级循环，**触发 §8-2 下沉条件**：工具契约（`ToolDefinition`/`AnyTool`/`ToolKind`/`ToolMeta`/`ToolExecutionContext`）与事件契约（`RuntimeEvent` 等）下沉 C1（`types/src/tools.ts`、`events.ts`），core 对应文件改「re-export 类型 + 保留实现」；新增 `EventEmitter<E>` 供 policy 结构化解耦（不再反向依赖 core 的 `EventBus`）；`mcp` 的 `classifyToolName` 改依赖 sandbox 包。验收：typecheck 绿 + 全仓 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 41+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip） |
| v0.9 (M6-B4) | 2026-09-07 | 拆包收官：批次 4 facade 收窄——`core/src/index.ts` 由直出改为聚合出口，统一 `export *` 转发 C3 memory / C4 sandbox / C5 policy（C6 mcp 因方向为 mcp → core 不反向 re-export，避免循环）；宿主可从 core 单点导入（兼容面不变）或直连子包。`checkpoint.ts` 仍留 core（依赖 `Agent` 类）。至此 M6 P1 拆包批次 B1~B4 全部完成，包图：types ← {memory, sandbox, policy} ← core ← mcp / provider-openai / store-sqlite |
| v0.10 (M6-B2) | 2026-09-07 | **修订 §8-5 决策**：C8 host 由「不拆」改为「拆」。`session.ts`(721 行) + 测试外置为 `@agent-runtime/host`（`packages/host/`），依赖方向 host → {core, memory, sandbox, policy, types} 单向无环（实测 core 内无模块依赖 session）；core `index.ts` 移除 Session/Task 导出（host → core 不可反向 re-export，与 mcp 同理），故为**破坏性变更**——当前 0.x 且全包 `private`（无外部消费者）为成本最低窗口。引用点已切换：`examples/cli.ts`、`examples/web/server.ts` 与 core/memory/mcp/sandbox 四处测试。验收：typecheck 绿 + 全仓 0 fail（core 33+1skip / host 8 / 其余不变）。至此 C1~C9 中 C3~C8 全部落地，最终包图：types ← {memory, sandbox, policy} ← core ← {host, mcp, provider-openai, store-sqlite} |
| v0.11 (M6-9~12) | 2026-09-08 | **自查整改闭环为 12 包终局**：① §8-4 修订——`Artifact` 实现自 C3 memory 拆出，独立成包 `@agent-runtime/artifact`（`packages/artifact/`，v0.7 并入 memory 的决策就此修订）；② mock/tools-basic 外置——`MockProvider` 与内置工具集分别迁至 `@agent-runtime/mock` / `@agent-runtime/tools-basic`（core 不再导出，README/示例导入源同步）；③ checkpoint 归位——`checkpoint.ts` 借 ToolSurface 契约迁入 C3 memory（不再留 core，解除 v0.7/v0.9 的暂留问题）；④ `classifyToolName` 下沉 C1。`core` 收窄至 1005 行。最终包图：types ← {memory, artifact, sandbox, policy} ← core ← {tools-basic, mock, host, mcp, provider-openai, store-sqlite}；`npm run check:api`（M6-11 起）0 差异 |
| v0.1 | 2026-09-05 | 按 codex-rs workspace 形态把 architecture §2 模块树重排为 crate/包边界与依赖图；给出 C1~C9+A1 映射、边界规则、形态对比与待决清单；纯设计研究，未改代码 |
| v0.2 | 2026-09-05 | 落地 §7.1 方案 A：根包改 npm workspaces 容器，C1 `@agent-runtime/types` / C2 `@agent-runtime/core` 两包先行（`git mv` 代码、C2 顶部 re-export C1、导入改包名、测试随包）；`npm run typecheck` / `npm run build` / `npm test`（35 通过）全绿，公共 API 不变 |
| v0.3 (M4) | 2026-09-07 | 落地 M4 外部能力：MCP client（`packages/core/src/mcp/`：`McpClient` + `StdioTransport`/`StreamableHttpTransport` + `McpRegistry` 物化）与 `artifact.ts`（`ArtifactManager`）先在 C2 内实现并随包测试；C6 `@agent-runtime/mcp` 拆包留待 M5；§6 里程碑表 M4 行同步 |
