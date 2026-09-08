# M6 P1 拆包审查（Architecture Review）

> 审查时间：2026-09-08（split 分支，基线 `09e01be`）
> 方法：① 依赖矩阵（package.json 声明 + 源码 `from "@agent-runtime/*"` 实际引用，已剔除注释）② 体量统计（`src/**/*.ts` 行数）③ 职责抽查（关键文件 grep）
> 定位：**审查不改代码**。结论与整改建议供 P2~P6 及发布决策参考；事实源：`docs/api-surface.md`、`docs/crate-architecture.md`、`docs/crate-split-todo.md`。

---

## 0. 结论速览

| 审查项 | 判定 | 一句话结论 |
|---|---|---|
| 包间反向依赖 | ✅ 通过 | 依赖图无环；core 内部模块**只依赖 types**（子包引用仅出现在 `index.ts` 的 facade 转发与注释） |
| core 是否过重 | ⚠️ **偏重** | 1804 行中 **656 行（36%）是演示资产**（MockProvider 306 + builtin/calculator 350），引擎本体仅约 1150 行 |
| host 是否越界 | ✅ 基本合理 | 纯编排（会话/任务 + 能力装配 + 审批/产物/记忆编排），**唯一越界点：直接借用 `runtime.events` 发会话事件** |
| memory / sandbox / policy 解耦 | ✅ 真实解耦 | 三者均只依赖 types（policy→sandbox 为 **type-only**）；但存在职责外溢（见下） |
| MCP 是 Runtime 还是扩展 | ⚠️ **扩展能力，但依赖偏重** | 依赖 core（`defineTool`）+ sandbox（`classifyToolName`），后者是"工具分类"而非"执行域"，属多余耦合 |
| Provider / Storage 可替换性 | ✅ 成立 | 接口在 core（`ModelProvider` / `Storage`）+ 注入点明确（`AgentRuntime({provider})` / `SessionManager({storage})`），外置实现已验证 |
| public API 稳定性 | ⚠️ **已冻结但面偏大** | core 导出 61 项 + facade 转发 4 包，含 4 个演示资产符号；双入口（core 与子包）带来来源歧义 |
| 是否为拆包而人为分层 | ⚠️ **存在 3 处** | ① memory 包装 ArtifactManager（名实不符）② sandbox 包装工具分类函数 ③ types 含纯函数实现（可接受，需注明） |

---

## 1. 逐包审查

| 包 | 规模 | 声明依赖 | 实际引用 | 判定 |
|---|---|---|---|---|
| **types**（C1） | 570 行 / 8 文件 | —（零依赖） | 无 | ✅ 干净叶子包。含 `validate`/`newId`/`fmtNumber` 等**零 IO 纯函数**，属"契约 + 纯工具"，需在包描述中明示边界 |
| **memory**（C3） | 301 行 / 3 文件 | types | types | ⚠️ 解耦达标，但**同时承载 SessionMemory 与 ArtifactManager**，包名与内容不符（C3 决策产物） |
| **sandbox**（C4） | 302 行 / 2 文件 | types | types | ⚠️ 执行域实现合格，但导出 `classifyToolName`/`toolKind`（**工具分类**，非执行域职责），导致 mcp 反向依赖本包 |
| **policy**（C5） | 344 行 / 2 文件 | sandbox + types | sandbox（**仅 type-only**：`SandboxMode`/`SandboxScope`）+ types | ✅ 真实解耦：决策需知执行域档位，类型依赖合理，无运行期耦合 |
| **core**（C2） | 1804 行 / 13 文件 | types | types（16 处）+ facade 转发 3 包 | ⚠️ 引擎本体健康（`runtime.ts` 453，`gate()` 为单一治理接缝，不依赖任何治理实现）；**但含 656 行演示资产** |
| **host**（C8） | 737 行 / 2 文件 | core + memory + policy + sandbox + types | 同声明 | ✅ 编排层合格：`runtime.run()` 仅 1 处调用，无工具执行/模型调用；⚠️ 11 处 `runtime.events.emit(...)` 借用引擎内部事件总线 |
| **mcp**（C6） | 1046 行 / 6 文件 | core + sandbox + types | 同声明 | ⚠️ 扩展能力定位正确（远端工具物化为本地 `ToolDefinition`），但 `classifyToolName` 依赖 sandbox 属多余耦合 |
| **provider-openai**（C7） | 224 行 / 2 文件 | core + types | 同声明 | ✅ 合格（HTTP/IO 外置，注入使用） |
| **store-sqlite**（C9） | 167 行 / 2 文件 | core | core | ✅ 合格（Storage 实现外置） |

### core 体量细分（1804 行）

| 组成 | 行数 | 性质 |
|---|---|---|
| `runtime.ts`（引擎主循环 + `gate` 接缝） | 453 | 引擎核心 |
| `providers/mock.ts`（MockProvider） | 306 | **演示/测试桩** |
| `tools/builtin.ts` + `tools/calculator.ts` | 350 | **演示工具集** |
| `checkpoint.ts` | 142 | 续跑快照（因依赖 `Agent` 类暂留 core） |
| `store/memory.ts` + `store/file.ts` | 187 | 零依赖默认存储实现（可接受） |
| `agent.ts`/`context.ts`/`tool.ts`/`provider.ts`/`events.ts`/`index.ts` | 366 | 引擎契约与出口 |

> 判定：**引擎核心 ≈ 819 行**；**演示资产 656 行（36%）** 是"过重"主因，且其中 `mock.ts` 依赖 `builtin.ts`（演示资产内部耦合）。

---

## 2. 八个重点问题

**Q1 包之间有没有反向依赖？** ✅ 无。
声明依赖与源码引用一致且无环：`types ← {memory, sandbox, policy} ← core ← {host, mcp, provider-openai, store-sqlite}`。
补充核查：`core/src` 中除 `index.ts`（facade 转发 + 注释）外，**没有任何文件引用子包**（grep 为空）；引擎 `runtime.ts` 的治理接缝是 `RunOptions.gate` 回调，不引用 sandbox/policy 的任何实现。

**Q2 core 是否仍然过重？** ⚠️ 是，主因是演示资产。
真正引擎（runtime/agent/context/tool/provider/events/index）+ 存储实现 ≈ 1006 行；演示资产（MockProvider 306 + builtin/calculator 350 = 656 行）与 checkpoint（142）可外置。外置后 core ≈ 1150 行，定位更纯。

**Q3 Host 是否承担了不该承担的职责？** ✅ 基本没有。
`SessionManager` 持有 runtime/storage/agents/checkpoints/permission/artifacts/sandbox 并做编排（会话 CRUD、任务调度、审批转发、产物/记忆/续跑门面），无工具执行、无模型调用、`runtime.run()` 仅 1 处。
⚠️ 唯一越界：11 处 `this.runtime.events.emit(...)` —— 宿主**借用引擎内部事件总线**发会话/任务事件。当前可工作（单一事件流便于消费），但使 host 依赖引擎内部构件；更干净的做法是事件总线由宿主创建并注入 runtime。

**Q4 Memory / Sandbox / Policy 是否真解耦？** ✅ 是（运行时无耦合）。
三者只依赖 types；policy→sandbox 仅为 type-only 的 `SandboxMode`/`SandboxScope`。
⚠️ 但有两处职责外溢：① memory 包装 ArtifactManager（应更名或拆为 `@agent-runtime/artifact`）② sandbox 包装 `classifyToolName`/`toolKind`（工具分类，应归 types 或 mcp 自带）。

**Q5 MCP 是 Runtime 能力还是扩展能力？** 扩展能力（与架构 §5.3「接缝在 Tool」一致），但依赖可再瘦身。
现状 `mcp → core`（`defineTool`）+ `mcp → sandbox`（`classifyToolName`）。前者合理（Tool 是引擎契约），后者不合理（分类函数非执行域职责）。若把工具契约与分类函数归入 types（C4 已下沉工具契约，分类函数可一并下沉），mcp 可只依赖 types，成为纯扩展包。

**Q6 Provider / Storage 是否真正成为可替换基础设施？** ✅ 是。
接口定义在 core（`ModelProvider` / `Storage`），注入点明确（`new AgentRuntime({ provider })`、`new SessionManager({ storage })`），外置实现（provider-openai / store-sqlite）已接入并测试通过；core 内置的 `MemoryStorage`/`FileStorage`/`MockProvider` 均为零依赖实现，不构成替换障碍。

**Q7 public API 是否已足够稳定？** ⚠️ 已冻结（`docs/api-surface.md`），但面偏大。
core 导出 61 项并 facade 转发 4 包，其中含 4 个演示资产符号（`MockProvider`、`builtinTools`、`CURRENCY_ALIASES`、`evaluate`）；同一符号可从 core 与子包两处导入（双入口）。建议发布前外置演示资产以收窄公共面，并在文档中明确"推荐直连子包"。

**Q8 有没有为「拆包」而产生人为分层？** ⚠️ 有 3 处。
① **memory 装 artifact** —— 因"同为 Storage 读写"合包（C3 决策），但包名 `memory` 误导；② **sandbox 装工具分类** —— 造成 mcp 对 sandbox 的多余依赖；③ **types 含纯函数实现**（`validate`/`newId`/`fmtNumber`）—— 属合理（零依赖纯函数），但需在包描述与文档明示"契约 + 零 IO 纯工具"边界，避免后续被塞入有状态逻辑。

---

## 3. 整改建议（按优先级）

| 级别 | 建议 | 收益 | 影响面 |
|---|---|---|---|
| **P0** | 外置演示资产：`@agent-runtime/mock`（MockProvider）与 `@agent-runtime/tools-basic`（builtin/calculator/evaluate/CURRENCY_ALIASES） | core 由 1804 → 约 1150 行；公共面去掉 4 个演示符号；包体积下降 | examples 与 core/index 导入调整（约 3~5 处），`docs/api-surface.md` 快照更新 |
| **P1** | 工具分类函数 `classifyToolName`/`toolKind` 下沉 types（或 mcp 自带），解除 `mcp → sandbox` | mcp 成为纯扩展包（只依赖 types/core 契约） | sandbox 与 mcp 各 1~2 处 import；API 快照更新 |
| **P1** | 解决 memory/artifact 名实不符：更名包为 `@agent-runtime/store-content`，或拆出 `@agent-runtime/artifact` | 语义清晰，避免后续 artifact 能力膨胀污染 memory | 包名变更（破坏性），需在发布前完成 |
| **P2** | `checkpoint.ts` 解耦 `Agent` 类（改为接受结构化 `{ name, tools }` 或 `AgentSnapshot`），随后并入 memory 包 | core 进一步瘦身 142 行，C3 归位完整 | 中等（checkpoint API 形态微调） |
| **P2** | 事件总线反转：由宿主创建 `EventBus` 注入 `AgentRuntime`，host 不再借用 `runtime.events` | 消除 host 对引擎内部构件的依赖 | 中等（runtime/host 构造参数变更） |
| **P2** | API 快照复核脚本化，纳入 P2 的 CI 作业（`api-surface` job） | 防止公共面无意漂移 | 低（新增 CI 作业） |

> 说明：P0/P1 建议在 **P4 发布工程之前**完成（与 P1 拆包同理——0.x 且全包 `private`，破坏性变更成本最低）；P2 可随 P2~P6 或 M7 窗口处理。

### 3.1 整改执行结果（2026-09-08，已完成 P0 + P1）

| 建议 | 执行 | 结果 |
|---|---|---|
| P0 外置演示资产 | ✅ | 新增 `@agent-runtime/mock`、`@agent-runtime/tools-basic`；**core 1804 → 1146 行（-36%）**，公共面去掉 5 个演示符号 |
| P1 `classifyToolName` 下沉 | ✅ | 下沉至 C1 `types/src/tools.ts`；sandbox re-export 保持 API 不变；**mcp 去掉 sandbox 依赖**（现只依赖 core + types） |
| P1 memory/artifact 名实不符 | ✅ | 拆出独立包 `@agent-runtime/artifact`；memory 导出 13 → 5，一包一职责 |
| P2 checkpoint 解耦 `Agent` | ⏸ 未做 | 留待后续窗口（需 checkpoint API 形态调整） |
| P2 事件总线反转注入 | ⏸ 未做 | 同上（runtime/host 构造参数变更） |
| P2 快照复核脚本化 | ⏸ 未做 | 随 P2 的 CI 作业落地 |

**整改后依赖方向**：`types ← {memory, artifact, sandbox, policy} ← core ← {tools-basic, mock, host, mcp, provider-openai, store-sqlite}`（12 个 workspace 包，单向无环）。
**验收**：typecheck 绿；全仓 `npm test` 0 fail。`docs/api-surface.md` 已按整改后状态**重新冻结**。

---

## 4. 附：审查数据

```
包规模（src/**/*.ts）：
  types 570/8   memory 301/3   sandbox 302/2   policy 344/2   core 1804/13
  host 737/2    mcp 1046/6     provider-openai 224/2          store-sqlite 167/2

声明依赖（= 实际引用，无环）：
  types: —          memory: types        sandbox: types
  policy: sandbox,types                  core: types (+facade 转发 memory,sandbox,policy)
  host: core,memory,policy,sandbox,types
  mcp: core,sandbox,types                provider-openai: core,types
  store-sqlite: core

core 内部：除 index.ts 外无任何文件引用子包（已核验）
host：runtime.run 1 处；runtime.events.emit 11 处；无 executeTool / defineTool / EventBus 构造
```
