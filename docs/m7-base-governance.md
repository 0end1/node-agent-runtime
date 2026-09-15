# M7 执行清单（底座治理交付：首批 M7-1 / 2 / 3 / 6 + 第二批 M7-5 底座部分）

> 记录时间：2026-09-10（第二批 M7-5 于 2026-09-15 补入）
> 定位：**执行清单（草案）**。把 `docs/product-direction.md` §5 的首批四项拆到「包 / 文件 / API / 验收用例 / 量级」粒度，使每项都能直接开单。
> 性质：**执行清单（草案）**。**12 项全部已定**（§8 无待拍板项；第 8 项 §8-8 随 M7-6b 于 2026-09-15 补入，第 9~12 项随 M7-5 底座部分立项同日补入）。本文不改变既有口径，立项需先按 `docs/development-checklist.md` §4 回填 `architecture.md` §11 M7 行与 §13 修订记录，再回填 §0 / §3.3。
> 口径依据：`docs/base-convergence.md` §3（三问准入）/ §6（只对底座立项）；首批口径与验收面见 `docs/product-direction.md` §5。
> 前置状态：M6 **Gate 1（包边界）/ Gate 2（质量门）/ Gate 3（可观测与安全）/ Gate 4（SDK 发布工程）/ Gate 6（治理文档）已关闭**；Gate 5 退出标准已修订为「P5.5 生产存储 + P5.6 Web 部署形态」（均已完成，M6-24）；桌面项已整体移出至产品侧。
> 纪律：任何改动不得引入运行时依赖（保持零依赖卖点）；公共 API 变更走 changeset + `npm run check:api:update` 重冻基线。

---

## 0. 首批四项一览

| # | 主题 | 归属包 | 主要改动面 | API 变更类型 | 量级 | 依赖 |
|---|---|---|---|---|---|---|
| **M7-1** | 成本与上下文治理 | `types` · `memory` · `core` · `provider-openai` | `RunUsage` 扩展 + 价格表 + `compactMessages` + `usage:update` / `context:compacted` 事件 | additive（minor） | 中 | `RunLimits` / `checkRunLimits`（已有）、`usage` 事件（已有） |
| **M7-2** | 可观测与合规导出 | `types` · `core` · `host` | traceId 贯穿 + OTEL 形状纯函数 + 审计导出（CSV/JSON） | additive（minor） | 中 | P3.1 `Logger`、P3.3 `ApprovalStore`（已有） |
| **M7-3** | 策略工程化 | `types` · `policy` · `core` | `PolicyDocument` 契约 + `compilePolicy` + `testPolicy` + ≥3 套组织预设 | additive（minor） | 中 | M3 `DefaultPermissionPolicy` / `combinePolicies`（已有） |
| **M7-6a** | 工具规模治理（首批） | `types` · `core` · `memory` | `tool_search` 检索式声明 + 步骤级工具面快照 | additive（minor） | 中 | `computeToolsHash`（已有） |
| **M7-6b** | MCP 只读资源（**已交付**，2026-09-15） | `mcp` | `resources/list` / `resources/read` + `searchTools` | additive（minor） | 中 | M4 `McpRegistry`（已有） |
| **M7-5**（底座部分） | Agent 配方编译与快照（**已交付**，2026-09-15） | `types` · `core` · `memory` | `validateSchema` + `compileAgent()` 编译期校验（重名 / Schema / MCP 可达性）+ 配方快照 `instructionsHash` | additive（minor） | 中 | `findDuplicateToolNames` / `computeToolsHash` / `assertResumable`（已有）；设计出处 `architecture.md` §3.2 |

**M7-1 / 2 / 3 / 6a** 合起来即 `product-direction.md` §5 所称的「企业能验收的最小治理交付包」：**成本可见 · 链路可查 · 策略可测 · 工具可控**。M7-6b 性质上更接近「MCP 适配完善」而非治理，延后不破坏四角齐全（拆分依据见 §8-7）；**已于 2026-09-15 同批交付**（见 §5.3 与 §8-8）。

---

## 1. 实施顺序与理由（批次 A 已定，§8-1）

```
批次 A（一次性动作，不写代码）   消费 p4-sdk-publishing.md → 12 包 bump 到 0.3.0 并提交（**不发布、不打 tag**）
        │
批次 B（横切面先行）             M7-2 的 traceId 贯穿  →  M7-1 计量与 compact
        │
批次 C（可并行）                 M7-3 策略工程化
        │
批次 D（工具面，不依赖 mcp）     M7-6a 工具面快照 + tool_search
        │
批次 E（依赖 mcp 扩展，**原定延后，2026-09-15 已交付**）    M7-6b MCP 只读资源
```

- **为什么批次 A 改为「只 bump、不发布」（2026-09-10 修订，§8-1）**：实发延后（npm 组织与发布凭据两项前置未具备，见 §6），但**版本语义不能因此让路** —— 若直接拿 0.2.0 叠 M7，P4 与 M7 的 minor 会挤进同一次跳跃，形成「0.3.0 未发、0.4.0 成堆」的空档，两类失败（版本语义**不可回收** / 代码**可回滚**）互相污染归因。`npm run version-packages` 只改 `package.json` 与 CHANGELOG，**不触碰 registry、不打 tag** → **完全可逆**，却能把 M7 的 changeset 干净地落在 0.3.0 → 0.4.0 这一段上。
- **为什么 traceId 先做**：它是横切面（事件契约 + 日志 + 每个 emit 点）。晚做的代价是所有已写事件与测试都要回头补，成本随时间上升。
- **为什么 M7-1 紧随**：它是 ACP 路径下的**协议义务**（ACP `usage_update` 要求 `used` / `size` 必填 token 数，`cost` 可选），不是纯内部完工项；见 `docs/product-build-paths.md` §2.1。
  - **交叉影响（构成硬顺序约束）**：ACP 把 token 计量从「内部指标」升级为「协议义务」，因此 **M7-1 必须先于 ACP 协议包与流式输出（G2）**。顺序倒置的代价是 ACP 侧只能先自造一套临时计量、待 M7-1 落地再拆除 —— 与「traceId 横切面必须先做」属同一类返工。反过来，先出 M7-1 则 ACP 只是消费既有 `usage:update` 事件，不产生额外改动。
- **为什么 M7-6 拆开、6a 进首批而 6b 延后（§8-7；**6b 已于 2026-09-15 交付，拆分结论不变**）**：6a（工具面快照 + `tool_search`）只依赖 `types` / `core` / `memory`，**不依赖 `mcp`**，可并入首批；6b（MCP 只读资源）是唯一需要 `mcp` 新能力的（`resources/list` / `resources/read`），延后不影响验收。且 `tool_search` 默认关闭、属 opt-in，即使 6a 内部也可先落工具面快照再落检索。

---

## 2. M7-1 · 成本与上下文治理

### 现状（代码锚点）

| 事实 | 位置 |
|---|---|
| `RunUsage` 只有 `inputTokens` / `outputTokens` / `modelCalls` | `packages/types/src/types.ts:40` |
| 成本靠**宿主钩子**：`RunOptions.costUsd?: (usage) => number \| undefined` | `packages/core/src/runtime.ts:108`、调用点 `:232` |
| 预算判定已是纯函数，已支持 `maxCostUsd` | `packages/types/src/limits.ts:70`（`checkRunLimits`） |
| provider 已解析 usage | `packages/provider-openai/src/openai-compatible.ts:199` |
| 宿主侧 Run 记录 `usage`，resume 用 `initialUsage` 续账 | `packages/host/src/session.ts:94`、`:469` |
| **上下文无任何预算或压缩**：`history` 全量透传 provider | `packages/core/src/runtime.ts:197`、`:249` |
| `RunContext` 只有 id 与 `now()`，无 token 视角 | `packages/core/src/context.ts:26` |

### 目标与落点

1. **内置计量（脱钩宿主钩子）**
   - `packages/types/src/types.ts`：`RunUsage` 增 `cachedInputTokens?: number`、`costUsd?: number`（additive）。
   - `packages/types/src/pricing.ts`（新增）：`PriceTable`（`{ inputPerMTok, outputPerMTok, cachedInputPerMTok? }`，可多模型键）+ 纯函数 `usageCost(usage, price)`。
   - `packages/core/src/runtime.ts`：`AgentRuntimeOptions` / `RunOptions` 增 `pricing?: PriceTable`；**优先级 `pricing` > `costUsd` 钩子**（钩子保留为回退，不破坏既有宿主）。
2. **上下文预算与压缩**
   - `packages/memory/src/compact.ts`（新增）：`ContextBudget { maxInputTokens?, contextWindow?, keepLastTurns? }` + `compactMessages(messages, budget, countTokens?): { messages, removed, estimatedTokens }`。
   - **零依赖纪律的硬约束**：不引 tokenizer。`countTokens` 可注入，缺省用**近似估算**（字符数 / 4，向上取整）；压缩策略为确定性纯函数（保留 system + 最近 N 轮 + 早期消息折叠为占位摘要）。
   - **形态已定（§8-2）**：首批只交付纯函数路径。签名预留 `summarize?` 注入钩子（默认 `undefined`），宿主可注入自己的模型摘要作为增强；**底座不承担摘要的不确定性**。钩子开启时有两项由宿主承担的责任：① 摘要文本必须落进 checkpoint 的 messages，否则 `resume()` 会重摘出不同文本，破坏 M2 的「续跑 transcript 一致」口径；② 该次调用不计入 `RunUsage`，否则 `maxCostUsd` 可能被治理调用顶爆、用量视图也会误导客户。
   - 折叠必须**结构化**而非粗暴丢弃：保留用户原始目标、全部 `deny` 决策记录与工具结果关键字段。（拦截本身由 `PermissionManager` 兜底，此处只影响模型是否会重试被拒操作。）
   - `packages/core/src/runtime.ts`：step 循环内、provider 调用**之前**（`assertWithinLimits` 附近）执行 compact；触发时发 `context:compacted`。
   - 可选增强（不属首批验收）：`summarize` 钩子由宿主注入（复用模型生成摘要），默认不启用；开启时的持久化与计量责任归宿主，见 §8-2。
3. **事件与配置**
   - `packages/types/src/events.ts`：新增 `UsageUpdateEvent`（`usage:update`，step 级累计 + `costUsd?` + `contextUsed` / `contextSize`）与 `ContextCompactedEvent`（`context:compacted`，`removed` / `estimatedTokens` / `step`）→ 追加进 `RuntimeEvent` 联合。
   - `packages/core/src/config.ts`：`RuntimeConfig` 增 `context?: ContextBudget`、`pricing?: PriceTable`；env `AGENT_CONTEXT_MAX_INPUT_TOKENS` / `AGENT_CONTEXT_WINDOW` / `AGENT_CONTEXT_KEEP_LAST_TURNS`。

### 验收用例（均可自动化）

- `usageCost` 对给定 usage + price 的金额精确（含缓存命中价与未配缓存价的回退）。
- `RunUsage` 在 `resume()` 后与一次性跑完等价（沿用 `initialUsage` 续账语义）。
- history 超过 `maxInputTokens` 时触发 compact：`context:compacted` 含正确 `removed` 与 `estimatedTokens`；**压缩后仍可续跑**（`computeToolsHash` 不变、`resume()` 通过）。
- 未配 `pricing` 且未传 `costUsd` 时 `maxCostUsd` 不参与判定（保持现行为，回归保护）。
- `run:end.usage.costUsd` 与 `usage:update` 末值一致。
- 新增文件行覆盖 ≥80%（沿用 P2.3 逐包阈值）。

### 风险

- 近似 token 估算与真实用量有偏差 → 验收只承诺「预算可触发、可续跑」，不承诺与厂商计费一致；`usage:update.contextSize` 仅在配置 `contextWindow` 时提供。
- compact 改变 transcript → 必须与 checkpoint 语义对齐，否则破坏 M2 已验收的「续跑 transcript 一致」。

> **落地状态（2026-09-15）**：**M7-1 已交付（批次 B）** —— `RunUsage` 增 `cachedInputTokens?` / `costUsd?`；`types/src/pricing.ts`（`PriceTable` + `usageCost` 纯函数，含缓存命中价与未配价回退）；`memory/src/compact.ts`（`ContextBudget` + `compactMessages` 确定性纯函数，零依赖、字符/4 估算、`countTokens` 可注入、结构化折叠保留用户原始目标与工具结果关键字段）；`core` 增 `pricing?` / `context?`（per-run 覆盖 runtime 默认，优先级 `pricing` > `costUsd` 钩子），step 循环内 provider 调用前执行 compact 并发 `context:compacted`、用量更新后发 `usage:update` 并在成本已知后补一次预算校验使 `maxCostUsd` 生效；`provider-openai` 解析 `prompt_tokens_details.cached_tokens`；`config.ts` 接入 `AGENT_CONTEXT_*` 环境变量。`npm run ci` 六门全绿；测试见 `packages/types/test/pricing.test.ts` / `packages/memory/test/compact.test.ts` / `packages/core/test/m7-1.test.ts`（共 19 例）。**M7-2 的目标 2（OTEL）与目标 3（审计导出）已于 2026-09-15 交付**（见 §3 落地状态）。

---

## 3. M7-2 · 可观测与合规导出

> **落地状态（2026-09-15）：M7-2 三项全部交付**。目标 1 traceId 贯穿（2026-09-11，见下）；**目标 2 OTEL 导出**：`core/src/otel.ts` 的 `toOtelSpans` 纯函数产出 OTLP-JSON 形状（确定性 id、`run→step→tool` 父子、`startTimeUnixNano` / `endTimeUnixNano` 单调），**不绑定传输、不新增包、零第三方运行时依赖**；**目标 3 审计导出**：`host/src/audit-export.ts` 的 `serializeAudit` / `exportAudit`（CSV RFC 4180 转义 + JSON 稳定键序，固定列序仅含 `argumentsFingerprint`，每条记录先过 `redact`）。前置缺口已补齐：`StepStartEvent` / `ToolStartEvent` / `ToolEndEvent` 增可选 `at?`（epoch ms，由 runtime 在发射点补齐，additive minor）。测试见 `packages/core/test/otel.test.ts`（7 例）与 `packages/host/test/audit-export.test.ts`（7 例），`npm run ci` 六门全绿。

### 现状（代码锚点）

| 事实 | 位置 |
|---|---|
| `Logger` 仅 4 个级别 + `meta`，**无 traceId / 无 span** | `packages/core/src/log.ts:12` |
| `ConsoleLogger` 输出为文本行 `[node-agent-runtime <level>] ...` | `packages/core/src/log.ts:41` |
| 事件统一经 `redact()` 后离开引擎（脱敏边界已收口） | `packages/core/src/runtime.ts:494`（`emit`） |
| 19 个事件类型全部以 `runId` 关联，`step:start` / `tool:start` 带 `step`；**无 traceId、无 span 父子、无事件时间戳** | `packages/types/src/events.ts:9`~`:203` |
| 审计记录已含 `decisionId` / `runId` / `toolName` / `argumentsFingerprint` / `verdict` / `source` / `reason` / `decidedAt` | `packages/types/src/audit.ts:28` |
| 审计查询已支持 run / session / task / tool 过滤 | `packages/types/src/audit.ts:52`、`packages/host/src/approval-store.ts:30` |
| **全仓无 `traceId` 实现** | 已核实 |

### 目标与落点

1. **traceId 贯穿（横切面）**
   - `packages/types/src/events.ts`：所有事件增可选 `traceId?: string`；`RunStartEvent` 增 `startedAt: number`，`RunEndEvent` 增 `endedAt: number`（epoch ms，additive）。
   - `packages/core/src/runtime.ts`：`RunOptions.traceId?: string`（缺省 `newId("trace")`），`emit()` 统一注入 `traceId` 与时间戳 —— 与现有 `redact()` 同点收口，保证「一处注入、全局一致」。
   - `packages/core/src/log.ts`：`Logger` 增可选 `child?(ctx: { traceId?; runId?; step? }): Logger`（additive；`toLogger` 兼容层不变），使日志行可携带 traceId。
2. **OTEL 导出：只产出形状，不引入依赖**
   - `packages/core/src/otel.ts`（新增）：`toOtelSpans(event | event[], ctx?): OtelSpan[]` 纯函数，输出 OTLP-JSON 形状（`traceId` / `spanId` / `parentSpanId` / `name` / `startTimeUnixNano` / `endTimeUnixNano` / `attributes` / `status`）；父子关系由 `runId` + `step` 推导（run → step → tool）。
   - **传输（OTLP exporter / HTTP / gRPC）不进底座**，由宿主或示例适配 —— 与「`deploy/` 是验证载体」口径一致；开箱即用的适配样例放 `examples/` 或 `deploy/`，不进 `packages/*`。
   - **形态已定（§8-3）**：**不新增 `@node-agent-runtime/otel` 包**，以同时保住「12 包终局」与「全仓 12 包零第三方运行时依赖」两条现行口径（`architecture.md` §1、`base-convergence.md` §6、`product-direction.md` §7 的维护半径）。仅在「多个宿主真实反馈各自重写传输」时，才按三问重新立项并修订 12 包口径 —— 用真实需求触发，不做预测性建包。
3. **审计导出**
   - `packages/host/src/audit-export.ts`（新增）：`serializeAudit(records, { format: "csv" | "json" })` 与 `exportAudit(store, query?, options?)`。
   - 归 `host` 的理由：需复用 `core` 的 `redact`；放 `types` 会因零依赖而拿不到脱敏实现（见 §8-4）。
   - 输出确定性：CSV 列序固定、RFC 4180 转义、ISO-8601 时间、UTF-8、`\n` 行尾；JSON 为稳定键序数组。

### 验收用例（均可自动化）

- 一次 run 的全部事件 `traceId` 一致，跨 run 不同。
- `toOtelSpans` 对「1 run + N step + M tool」事件序列产出正确父子结构与单调时间戳。
- `serializeAudit("csv")`：表头固定、含 `argumentsFingerprint`、**不含工具参数原文**；`reason` 含逗号/引号/换行时转义正确。
- 注入 `sk-xxxx` 形态参数后，导出物不含明文（复用 `redact` 的回归保护）。
- 审计导出行数与实际审批决策数一致（`approve` / `deny` / `timeout` / 策略放行全覆盖）。

### 风险

- 给所有事件加字段会触碰 `api-surface.md` 的全部事件导出 → 一次性完成并重冻基线，避免多次改动。
- 「链路可还原」依赖 `step` 粒度；若未来引入子步骤，需要重新设计 span 层级（届时属 major 级评估）。

---

## 4. M7-3 · 策略工程化

### 现状（代码锚点）

| 事实 | 位置 |
|---|---|
| `PermissionPolicy.decide(ctx, call)` 单一接缝 | `packages/policy/src/permission.ts:45` |
| `DefaultPermissionPolicy` = `DecisionMatrix` + allow / deny 名单 | `packages/policy/src/permission.ts:403`、`:383` |
| **「最严命中」已实现**（`combinePolicies`，严重度 allow < ask < deny） | `packages/policy/src/permission.ts:444` |
| 已有 **1 套**生产预设矩阵 | `packages/policy/src/secure.ts:15`（`PRODUCTION_MATRIX`） |
| 工具敏感度推断已在 C1（可被策略文件复用） | `packages/types/src/tools.ts:72`（`classifyToolName`） |
| 轻量 JSON Schema 校验器已具备（零依赖） | `packages/types/src/schema.ts`（`validate`） |
| 配置分层已具备（env > 默认 + overrides） | `packages/core/src/config.ts:162`（`loadConfig`） |

### 目标与落点

1. **声明式策略契约**（`packages/types/src/policy.ts` 新增，纯契约零依赖）
   - `PolicyDocument { version: 1; extends?: string; rules: PolicyRule[] }`
   - `PolicyRule { id: string; match: { tool?: string; toolPattern?: string; kind?: ToolKind; mode?: SandboxMode; pathGlob?: string }; verdict: "allow" | "ask" | "deny"; reason?: string }`
   - `PolicyTestCase { name: string; call: PermissionCall; ctx: PermissionContext; expect: Verdict }`
2. **编译与测试**（`packages/policy/src/document.ts` 新增）
   - `validatePolicyDocument(doc)`：复用 `types` 的 `validate` + 结构检查（未知 verdict / 缺 `id` / 版本不符直接报错）。
   - `compilePolicy(doc): PermissionPolicy`：规则 → policy；命中多条时按 `combinePolicies` 的**最严语义**求交（不新造语义）。
   - `testPolicy(doc, cases): PolicyTestResult[]`：内联测试运行器，返回逐条 pass / fail 与差异说明 → **可在 CI 内跑策略测试**。
   - `PRESETS`：≥3 套组织预设（建议 `prod-strict` / `dev-open` / `readonly-audit`），以 `PolicyDocument` 形式提供。
   - `toolPattern` 的 glob 匹配**自实现**（全仓无现成 glob 工具，已核实），保持零依赖。
3. **配置接入**
   - `packages/core/src/config.ts`：`RuntimeConfig.permission` 增 `preset?: string`、`documentPath?: string`；env `AGENT_POLICY_PRESET` / `AGENT_POLICY_FILE`。
   - 新增脚本 `npm run policy:test`（跑内置预设的内联测试），并纳入 `npm run ci`（见 §8-5）。

### 验收用例（均可自动化）

- 多规则命中取最严：`allow` + `deny` → `deny`；`ask` + `allow` → `ask`。
- `compilePolicy`（由等价 matrix 生成的文档）与 `DefaultPermissionPolicy` **逐格等价**：5 个 `ToolKind` × 3 个 `SandboxMode` 全 15 组合断言。
- `testPolicy` 对内置预设全绿；故意写错期望时输出差异条目而非静默通过。
- `validatePolicyDocument` 拒绝：未知 verdict、缺 `id`、`version` 非 1、`kind` / `mode` 取值非法。
- `documentPath` 指向非法文件时 `loadConfig()` 抛 `ConfigError`（沿用 P3.8 口径）。
- 三套预设各自通过内联测试，且 `prod-strict` 对 `credential` 类工具在三档模式下均为 `deny`（与 `PRODUCTION_MATRIX` 一致）。

### 风险

- 策略文件是**外部输入**，必须先在配置层校验再编译，否则会把非法规则带进运行时（release 前不能改回）。
- `pathGlob` 依赖调用方传入的参数形态；`pathArgs` 只在工具声明了 `meta.pathArgs` 时可靠（`packages/types/src/tools.ts:40`），需要在验收里明确「仅在声明了 pathArgs 时生效」。

> **落地状态（2026-09-15）**：**M7-3 已交付** —— `packages/policy/src/document.ts` 新增 `PolicyDocument` / `PolicyRule` / `PolicyTestCase` / `PolicyTestResult`、`validatePolicyDocument`（复用 `types` 的 `validate` + 结构检查）、`compilePolicy`（命中多条按 `combinePolicies` 最严语义求交，与 `DefaultPermissionPolicy` 逐格等价）、`testPolicy`（内联测试运行器）、`PRESETS`（`prod-strict` / `dev-open` / `readonly-audit` 三套，各带内联测试）；`core` 配置接入 `preset?` / `documentPath?` + `AGENT_POLICY_PRESET` / `AGENT_POLICY_FILE`（外部文件先校验后编译，非法即抛 `ConfigError`）；新增 `npm run policy:test` 并纳入 `npm run ci`。
> **架构取舍**：spec 草案写「契约落 `types/src/policy.ts`」不可行——`PermissionContext` / `PolicyRule.match.mode` 依赖 `SandboxMode`（在 `sandbox`），而 `sandbox` 已依赖 `types`，若 `types` 反向引入 `sandbox` 会破坏 `types ← sandbox` 的 DAG。故声明式契约随 `policy` 包落地（与既有 `PermissionPolicy` / `combinePolicies` 同处），仍是纯契约、零第三方依赖。`npm run ci` 六门全绿；测试见 `packages/policy/test/document.test.ts`（33 例）。

---

## 5. M7-6 · 工具规模治理

> **拆分（§8-7）**：M7-6 拆为 **6a（工具面快照 + `tool_search`，进首批）** 与 **6b（MCP 只读资源，原定延后、2026-09-15 已交付）**。下方 **目标 1 / 2 属 6a**，**目标 3 属 6b**。

### 现状（代码锚点）

| 事实 | 位置 |
|---|---|
| 工具**全量注入** provider：`requestTools = [...toolMap.values()]` | `packages/core/src/runtime.ts:240`、`:193` |
| provider 侧全量序列化工具 schema | `packages/provider-openai/src/openai-compatible.ts:77` |
| MCP 工具注册即**全量物化**（无检索、无懒加载） | `packages/mcp/src/registry.ts:63`（`register`）、`:142`（`materialize`） |
| MCP **无只读资源实现**（`resources` 仅作为能力声明字段出现） | `packages/mcp/src/types.ts:43`（已核实：无 `resources/list` / `resources/read`） |
| 工具集指纹已存在，且**已在续跑校验内** | `packages/memory/src/checkpoint.ts:118`（`computeToolsHash`）、`:128`（`assertResumable`） |
| 但 `StepSnapshot` **不记录**「本步声明/使用了哪些工具」 | `packages/core/src/runtime.ts:50` |
| **全仓无 `tool_search`** | 已核实 |

### 目标与落点

1. **检索式工具声明（`tool_search`）**（`packages/core/src/tool-search.ts` 新增）
   - `ToolIndex`：按 `name` / `description` / `kind` 建索引 + `search(query, limit)`（零依赖，倒排 + 子串打分）。
   - `packages/core/src/runtime.ts`：`RunOptions.toolBudget?: { maxDeclared?: number; search?: boolean }`（默认 `maxDeclared: 50`、`search: false`，**opt-in**）。
   - 当 `tools.length > maxDeclared` 且 `search: true`：注入 `tool_search` 元工具（`kind: "harmless"`）+ 仅注入命中工具；**`toolMap` 保留全量**，故未知工具错误提示、gate、sandbox 行为均不变（`runtime.ts:459`~`:480` 不受影响）。
2. **工具面快照**
   - `packages/core/src/runtime.ts`：`StepSnapshot` 增 `toolSurface?: { declared: readonly string[]; used: readonly string[] }`；`packages/types/src/events.ts` 的 `StepStartEvent` 增 `declaredTools?: string[]`。
   - `packages/memory/src/checkpoint.ts`：`Checkpoint` 增 `toolSurface?`（additive）。
   - 与 `toolsHash` 的关系要写清：`toolsHash` 校验的是**配方工具集**是否变化（续跑护栏），`toolSurface` 记录的是**本步声明与执行**的工具集（审计/对账用）。**两者独立**，不得互相替换。
3. **MCP 只读资源 ✅ 已交付（2026-09-15）**
   - `packages/mcp/src/types.ts`：新增 `McpResourceMeta` / `McpResourceContent` / `McpReadResourceResult`；`McpServerHandle` 增**可选** `listResources()` / `readResource(uri)`（可选 ⇒ additive，既有 handle 零改动）。
   - `packages/mcp/src/client.ts`：`McpClient` 记录 `initialize` 协商的 `capabilities` 并暴露 `resourcesSupported`；`listResources()`（cursor 翻页）与 `readResource(uri)`（校验 `contents` 数组）。**未声明 `resources` 能力 ⇒ `listResources()` 返回 `[]`**（无资源 ≠ 故障），协议层畸形响应仍抛 `McpError`。
   - `packages/mcp/src/registry.ts`：`register()` 顺带列取资源并物化为只读工具，命名 `mcpResourceToolName()` → `mcp__<server>__resource__<slug>_<fnv1a8>`（确定性 + 防碰撞），URI 在闭包内固定；`McpRegistry.listResources()` / `readResource(uri, server?)` / `searchTools(query, limit?)`（复用 `core` 的 `ToolIndex`）。
   - 敏感度按保守值（`network-read`），并走既有 gate / sandbox 链路（`network: "deny"` ⇒ 拒绝，**未新增旁路**）；资源文本经 `resourceText()` 摊平（二进制不进上下文、按 `maxResourceChars` 截断）。

### 验收用例（均可自动化）

- 工具数 60 + `maxDeclared: 50` → provider 实际收到 tools `≤ 51`（50 + `tool_search`）；`step:start.declaredTools` 与实际注入完全一致。
- `tool_search("天气")` 命中 `weather` / `geocode`；无命中时返回空列表且不抛错。
- 检索开启后，**未声明但被模型显式调用**的工具仍能执行（`toolMap` 全量语义未破坏）。
- checkpoint 的 `toolSurface.used` 与实际执行工具一致；`declared` 变化**不影响** `toolsHash` 续跑校验。
- MCP mock server 提供 `resources/list` → 只读资源物化成功、可 `read`；越权 URI 被 sandbox 声明域拒绝。
  - 映射：`packages/mcp/test/m7-6b.test.ts`（物化 + 可 `read` + 越权 URI 抛 `McpResourceError` 且不转发 + `LocalSandbox` 禁网拒绝 / 放行后成功）与 `packages/mcp/test/mcp.test.ts`（HTTP mock 与真实子进程的 `resources/list`·`read`）。
- 大工具集场景进 `scripts/e2e/`（沿用 M6-17 的跨形态 E2E 设施）。

### 风险

- `tool_search` 会改变模型可见工具面 → 需明确「检索是声明优化，不是权限收窄」，避免被误读为安全边界。
- MCP 资源读取扩大攻击面（URI 由远端给出）→ 必须复用既有 SSRF 白名单与沙箱声明域，不新增旁路。

> **落地状态（2026-09-15）**：**M7-6a 已交付** —— `packages/core/src/tool-search.ts` 新增 `ToolIndex`（倒排索引 + 子串打分，零依赖）+ `createToolSearchTool`（生成 `tool_search` 元工具）；`RunOptions.toolBudget`（opt-in，默认 `search: false`）按阈值裁剪声明面并注入 `tool_search`；`StepSnapshot.toolSurface` / `StepStartEvent.declaredTools` 记录本步工具面，`Checkpoint.toolSurface` 同步落库（host 接入）；`toolMap` 始终全量，故未声明工具仍可按名执行（**非权限收窄**）。测试见 `packages/core/test/tool-search.test.ts` + `m7-6.test.ts`（共 19 例），`npm run ci` 全绿。
>
> **M7-6b 亦已同日交付** —— `mcp` 增 `resources/list` / `resources/read`（`McpClient` + `McpRegistry`，`McpServerHandle` 上为可选方法）与 `McpRegistry.searchTools()`；资源物化为只读工具（`mcp__<server>__resource__<slug>_<fnv1a8>`，URI 闭包内固定），敏感度保守取 `network-read` 并走既有 gate / sandbox，读取仅接受已声明 URI（越权即 `McpResourceError`）。规模与上下文护栏：`maxResourceTools`（默认 50）/ `resourceTools`（可关）/ `maxResourceChars`（默认 32k）。测试见 `packages/mcp/test/m7-6b.test.ts`（13 例）+ `mcp.test.ts` 增 4 例，`npm run ci` 全绿。取舍见 §8-8。

---

## 6. API 面与发布影响

### 变更分级（首批四项全部 additive）

| 契约 | 改动 | 分级 |
|---|---|---|
| `RunUsage` | 增 `cachedInputTokens?` / `costUsd?` | minor |
| `RuntimeEvent` | 全部事件增 `traceId?`；`run:start` 增 `startedAt`；`run:end` 增 `endedAt`；新增 `usage:update` / `context:compacted` | minor |
| `StepSnapshot` / `Checkpoint` | 增 `toolSurface?` | minor |
| `StepStartEvent` | 增 `declaredTools?` | minor |
| `Logger` | 增可选 `child?()` | minor |
| 新增导出 | `usageCost`/`PriceTable`/`compactMessages`（M7-1）· `toOtelSpans`/`OtelSpan`（M7-2 OTEL）· `serializeAudit`/`exportAudit`/`AuditFormat`（M7-2 审计导出）· `compilePolicy`/`testPolicy`/`PRESETS`（M7-3）· `ToolIndex`/`createToolSearchTool`（M7-6a）**均已交付** | minor |
| `RunOptions` | 增 `pricing?` / `traceId?` / `toolBudget?` | minor |

**结论：首批无需 major。** 全部为可选字段与新增导出，符合「API 面冻结 + `check:api` 门禁」的兼容性口径。

### 必做动作

1. `.changeset/*.md`：按包登记 minor（当前待发的 `.changeset/p4-sdk-publishing.md` 已声明 12 包 minor，M7 首批应为**下一批**，不要合并进同一次版本跳跃）。
2. `npm run check:api:update` 重冻基线（`scripts/api-surface.baseline.json`），并同步 `docs/api-surface.md` 的导出符号数与新增符号。
3. `npm run ci` 全绿（typecheck / lint / test / coverage / `check:api` / size 六门）；`size` 门禁会拦住任何隐性依赖膨胀。
4. 每项新增 `*.test.ts`（本仓「测试即规格」），并满足 P2.3 逐包阈值（行 ≥80 / 分支 ≥60 / 函数 ≥55）。

### 与 0.3.0 的关系（2026-09-10 修订：延后实发，版本 bump 前置）

**决策（§8-1）：实发延后，但先把版本 bump 到 0.3.0 并提交（不发布、不打 tag），再叠 M7 首批。**

- **为什么延后实发**：三项前置尚未具备 —— ① npm 组织 `node-agent-runtime` 未创建；② 本机 npm `10.9.4` 且未登录（classic token 已撤销，首发无法走 OIDC）；③ 许可边界未定（`product-direction.md` §8-2）。详见 §6 前置条件。
- **为什么仍要先 bump**：直接用 0.2.0 叠 M7，会让 P4 与 M7 的 minor 挤进同一次跳跃，形成「0.3.0 未发、0.4.0 成堆」的空档，两类失败模式互相污染归因。
- **bump 是安全的**：`npm run version-packages` 只改 `package.json` 与 CHANGELOG，**不触碰 registry、不打 tag** → 完全可逆。
- **代价**：CHANGELOG 出现 0.3.0 条目而 registry 上暂时没有 0.3.0。首次实发时二选一：① **连发 0.3.0 + 0.4.0**（推荐，补齐空档）；② 只发 0.4.0（0.3.0 永久空档，npm 不介意，但对外叙事有缺口）。

**批次 A 执行步骤**：

```bash
npm run version-packages    # 消费 p4-sdk-publishing.md → 12 包 0.2.0 → 0.3.0 + 生成 CHANGELOG
git add -A && git commit -m "chore: version packages"
# 到此为止：不 build、不 publish、不打 tag
```

**现状**：`.changeset/p4-sdk-publishing.md` 已声明 12 包统一 minor（`fixed` 组），**0.2.0 → 0.3.0 尚未对 registry 实发**（已核实 E404：12 包在 registry 上从未存在）。

**执行路径**（`.github/workflows/release.yml` 已就绪，两条 `if` 条件互斥）：

| 路径 | 触发 | 动作 |
|---|---|---|
| **A（推荐，与 changesets 语义一致）** | push `main` | `changesets/action` 开 "Version Packages" PR（消费 changeset → 12 包统一 bump 到 0.3.0 + 生成各包 CHANGELOG）→ **合并该 PR** → 自动打 tag 并执行 `npm run release` |
| **B（直接发）** | push tag `v0.3.0` | `publish-tag` job 逐包 `npm publish --workspaces --access public --provenance`。**注意**：该 job 按仓库当前 `package.json` 版本发布，故必须先本地 `npm run version-packages`（消费 changeset → 12 包 bump 到 0.3.0）**并提交**，再打 tag；**否则会把 0.2.0 真实发出去** —— 因 0.2.0 从未实发（已核实 E404），registry **不会**拒绝，也就**没有安全网**，0.3.0 这个目标版本号反被 0.2.0 占掉，只能后续补发 |

**2026-09-15 实发前置核验（原三项闸门已全部解除，历史记载保留于下）**：

| 原闸门 | 状态 | 依据 |
|---|---|---|
| ① npm 用户/组织 `node-agent-runtime` | ✅ 解除 | granular token 的 `whoami` 返回 `node-agent-runtime`，与 scope 同名（npm 将同名 scope 授予该用户/组织）；registry 上 `@node-agent-runtime/*` 仍为 404 → 本次仍属**首次发布** |
| ② 发布凭据 | ✅ 解除 | 已签发 granular access token（scopes：全部自有包 + org `0end1`，非只读），配置为仓库 secret `NPM_TOKEN`。**首发不走 OIDC**（未发布包无 Trusted Publisher 配置入口），12 包上架后逐包配置 Trusted Publisher 转免 token |
| ③ 许可边界（`product-direction.md` §8-2） | ✅ 解除（2026-09-15 拍板） | **open-core**：L0 底座 12 包全部 Apache-2.0 实发；L1 治理增值层（审计导出对接、策略中心、配额与预算、SSO/RBAC）另行闭源，落在 12 包之外 |

> **npm ≥ 11.5.1 降级为非阻塞**（厘清下方第 309 行的原记载）：该要求是**转 OIDC** 的前置，不是首发的阻塞 —— 首发用 granular token，CI 由 `setup-node` 按 `.nvmrc`（22.22.1）装配 npm，只需 ≥ 9.5.0 即满足 provenance 门槛。**仅在上架后转 OIDC 时才需** `npm i -g npm@latest` 并同步 `packageManager` 字段。

> **provenance 结论（修订下方第 301 行的推断）**：首发**可以**带 provenance。npm 的真实门槛是「云托管 runner + `id-token: write` + npm CLI ≥ 9.5.0 + `access=public` + `repository` 字段匹配」，本仓 `release.yml:16-19`、`runs-on: ubuntu-latest`、`.changeset/config.json` 的 `access: "public"` 与 12 包 `repository.url`（2026-09-10 已核实一致）**全部满足**；只有 `access` 未设 public 才会触发 `Can't generate provenance for new or private package`（npm/cli#7706），本仓不受影响。**最终以首次发布日志是否出现 `Attestation` 为准。**

**前置条件（两项，缺一不可）**：

1. **发布凭据**（原写作「仓库 secret `NPM_TOKEN`」，**已按 npm 新规更正**）：本机 `npm whoami` 当前返回 `E401`（未登录）。
   - **npm 认证机制已变（2025-12-09 生效，必须按新规）**：classic token（含 Automation token）**已被 npm 永久撤销、不可恢复**；`npm login` 改为发放**2 小时会话令牌**，且**发布强制 2FA**；**新建包默认强制 2FA**。CI 发布只剩两条合法路径：**granular access token**（网页端 `npmjs.com/settings/~/tokens` 或 `npm token create`；非交互流程需开 **Bypass 2FA**；写权限有效期**上限 90 天**）或 **OIDC Trusted Publishing**。
   - **这是首次发布（已核实）**：`npm view @node-agent-runtime/core version` 与 `@node-agent-runtime/host` 均返回 **E404 Not Found** —— 12 包在 registry 上**从未存在过**（0.2.0 亦未实发，仅本地版本号）。
   - **首发无法走 OIDC**：Trusted Publisher 的配置入口在**已发布包**的 `Settings → Trusted publishing`，未发布的包没有该页面 → **首发只能二选一**：granular token（走 CI）或本地 2 小时会话（本地直发）。
   - **首发大概率拿不到 provenance**：npm 官方口径是 provenance 生成需 **OIDC 可信发布 + 公共仓库 + 公共包**三项同时满足。首发既无 OIDC，则 `release.yml:48/67` 的 `NPM_CONFIG_PROVENANCE=true` 在这一次不会产出签名 —— **两条路都一样**。因此「用 token 换 provenance」的动机**不成立**，应优先选**本地首发（不建 secret）+ 上架后立刻配 OIDC**，省掉一个 90 天必轮换的 secret。（此点基于官方文档措辞推断，实测时以首次发布日志是否出现 `Attestation` 为准。）
   - **必须创建 npm 组织 `node-agent-runtime`**：npm 的 scope 必须由**同名组织**或**同名用户账号**背书。本仓 npm 账号为 `0end1`，与 scope 名 `node-agent-runtime` 不一致 → 发 `@node-agent-runtime/*` 必须先在 npmjs.com 创建**免费组织 `node-agent-runtime`**（免费组织可发**不限数量的公开包**，仅私有包需付费），否则整批 12 包以 403 失败。
     - **已核实**：`@node-agent-runtime/core` 在 registry 上返回 **404**（该 scope 下无任何包）。**未核实**：组织名 `node-agent-runtime` 是否已被他人占用 —— registry 的 `/-/org/<name>/package` 端点需鉴权、无法离线判定，**以你在 npmjs.com 实际创建时的提示为准**。若被占用，只能改 scope 名（会再触发一轮全量改名）。
     - **三种选择**：① 建免费组织 `node-agent-runtime`（**推荐**，12 个包名与 113+ 处跨包 import 均不需改动）；② 改用用户 scope `@0end1/*`（免组织，但需改 12 个包名 + 上百处引用 + 全部文档）；③ 换其他可用 scope（改动面同 ②）。
     - 免费组织**只能发公开包**，与 Apache-2.0 口径一致；`--access public` 已就位（`.changeset/config.json` 的 `"access": "public"`、`release.yml:64` 的 `--access public`），无需改动。
     - **scope 名全局唯一且排他**：建成即永久独占 `@node-agent-runtime`。**这也是许可边界的最后一道闸**（见前置条件 2）—— 组织建成 + 实发之后，Apache-2.0 **不可回收**。
   - **首发后转为免 token**：12 包上架后为每包配置 Trusted Publisher（Organization or user = `0end1`、Repository = `node-agent-runtime`、Workflow filename = `release.yml`；字段区分大小写且须与 npmjs.com 完全一致），之后发布全靠 OIDC（要求 npm CLI ≥ 11.5.1、Node ≥ 22.14.0、云托管 runner —— 本仓 `engines` 为 Node ≥ 22.13.0，`.nvmrc` 需不低于 22.14.0 才满足）。**同时须确保各包 `package.json` 的 `repository.url` 与仓库完全一致**，否则 provenance 校验会以 422 失败。
   - **已核实（2026-09-10）**：12 包 `repository.url` 均为 `https://github.com/0end1/node-agent-runtime.git` 且各带 `directory` 字段，**上条 422 风险实际不存在**；12 包版本亦统一为 `0.2.0`，无版本漂移。`.nvmrc` = `22.22.1` ✅ 满足 OIDC 的 Node ≥ 22.14.0（`engines` 写的是 ≥ 22.13.0，略低于要求，但 CI 走 `.nvmrc` 故无影响）。
   - **本机 npm 版本不足，是走 OIDC 的额外前置**：本机 npm 为 `10.9.4`（根 `package.json` 的 `packageManager` 也写死 `npm@10.9.4`），**低于 OIDC 要求的 11.5.1** → 转 OIDC 前须 `npm i -g npm@latest`（当前最新 **12.0.2**）并同步改 `packageManager` 字段。旧认证端点 `/-/user/org.couchdb.user:` 探测仍返回 **401**（存活而非 404），故 `npm login` 在 npm 10 上大概率可用，但该端点属 2025-12 公告中的**过渡措施、随时移除**，不宜长期依赖。
2. **许可边界先定**：`product-direction.md` §7 明确「**在实发 npm 与对外宣传前先定边界**（§8-2）」。12 包一旦以 Apache-2.0 实发即**不可回收**；若后续要转 open-core（核心 Apache-2.0 + 治理增值闭源），必须**在本次实发前**确认「闭源部分落在 12 包之外（独立仓库 / 独立包）」，否则边界会被这次实发锁死。**这是本次发布唯一的非技术闸门。**

**发布后**：`.changeset/p4-sdk-publishing.md` 被消费并删除；M7 首批的 minor 应登记为**新的 changeset**，落点 **0.3.0 → 0.4.0**（不要并入 P4 的同一次跳跃）。

**验收（判定实发完成）**：`npm view @node-agent-runtime/core version` → `0.3.0`；全新目录 `npm i @node-agent-runtime/core@0.3.0` 后 `tsc --noEmit` 与最小 demo 通过（沿用 P4.4 的 canary 验收面）。

---

## 7. 明确不做 / 降级边界（沿用 `base-convergence.md` §2 / §6）

- **不做**：CLI TUI 与 Web 批量审批（M7-4）、控制台按工具 `kind` 定制渲染（M7-7 的 UI 部分）→ 均为**验证载体增强**，需要时才做，不占关键路径。
- **不做**：任何形式的运行时依赖引入（OTEL SDK / tokenizer / glob 库 / TUI 库）。
- **不做**：垂直行业应用、云端编码平台、多 Agent 协同、Rust 移植。
- **不在此清单内**：ACP 协议包（`@node-agent-runtime/acp`）与流式输出（G2）。二者同属底座，但属**产品路径评估**范畴（`docs/product-build-paths.md` §8），需先拍板再立项。
- **不动**：`examples/*`、`deploy/`、`scripts/e2e/` 的产品级演进（仅可在验证底座能力时顺带改动）。

---

## 8. 决策记录

> 状态：**8 项全部已定**（前 7 项 2026-09-10，第 8 项 §8-8 随 M7-6b 交付于 2026-09-15），无待拍板项。已定项口径已回填至 §1 / §2.2 / §3.2 / §4 / §5 / §6。其中三项（§8-2 / §8-3 / §8-4）属同一类取舍：**底座只留「不可替代且必须随契约同步」的语义映射，把「可替换且带不确定性」的管道推给宿主**。

### 8.A 已定

1. **延后实发；改为「版本 bump 到 0.3.0 并提交（不发布、不打 tag）」后再叠 M7**（2026-09-10 修订，原为「先实发 0.3.0」）。
   - **变更原因**：实发的前置（npm 组织 `node-agent-runtime`、npm ≥ 11.5.1、登录凭据、许可边界）尚未具备，故实发延后；但**版本语义不能因此让路**。
   - **判定依据**：`npm run version-packages` 只改 `package.json` 与 CHANGELOG，**不触碰 registry、不打 tag** → **完全可逆**，却能把 M7 的 changeset 干净地落在 0.3.0 → 0.4.0 这一段上，避免「0.3.0 未发、0.4.0 成堆」的空档与归因污染。
   - **代价**：CHANGELOG 有 0.3.0 而 registry 暂无 → 首次实发时连发 0.3.0 + 0.4.0 补齐（推荐）。
   - **剩余闸门（均不阻塞 M7 写码，但阻塞实发）**：① npm 组织 `node-agent-runtime` 未创建；② 发布凭据 + npm ≥ 11.5.1；③ 许可边界须先定（`product-direction.md` §8-2）。
   - **落地**：§1 / §6。
2. **compact 的压缩策略 → 纯函数式确定性裁剪**（模型摘要仅作可选注入钩子，默认不启用）。
   - **判定依据**：`compactMessages` 是**消息的纯函数**，天然落在 M2 已验收的 checkpoint 续跑护栏内（`StepSnapshot.messages` 重放结果一致）。若允许模型摘要，它就变成「带持久化副作用的模型调用」，将连带引入：checkpoint 新增状态机（防「摘要的摘要」）、四条失败降级路径（超时 / 429 / 超长 / 非法输出，且触发时机恰是上下文最满、最不容失败的时刻）、以及「压缩为省钱、压缩动作本身花钱」的计量自相矛盾（是否计入 `RunUsage` / `modelCalls` / `maxCostUsd`）。
   - **代价与缓解**：会丢失早期上下文 → 用**结构化折叠**（保留用户原始目标、全部 `deny` 决策记录与工具结果关键字段）替代粗暴丢弃。
   - **落地**：§2.2。
3. **OTEL 导出形态 → `packages/core/src/otel.ts` 纯函数产出 OTLP 形状 + 宿主适配传输**。
   - **判定依据**：必须留在底座、且必须随事件契约同步的是「事件 → span 的语义映射」；传输是可替换的通用管道。建包会使底座成为**全仓唯一带第三方依赖的包**（或背上几百行 OTLP 管道维护：批量 / 重试退避 / gzip / flush-on-exit），并把「12 包终局」推向第 13 包（`product-direction.md` §7 已写明维护半径到边缘）。
   - **代价与缓解**：宿主需自行接 OTLP → 在 `examples/` / `deploy/` 放适配样例，证明该路径可行且不污染 `packages/*`。
   - **重评触发条件**：多个宿主真实反馈「各自重写传输」，再按三问立项并修订 12 包口径。
   - **落地**：§3.2。

4. **审计导出的归属 → `host`**（`packages/host/src/audit-export.ts`）。
   - **判定依据**：导出环节必须能**兜底脱敏**。审计记录本身只存 `argumentsFingerprint`（无参数原文）、事件侧 `redact()` 也已在 `runtime.ts:494` 收口，但**若导出拿不到 `redact`，就等于把「上游一定脱敏过」当成唯一防线** —— 上游语义一旦变化，导出物会**静默泄漏**，属合规事故且不可回收。放 `types` 会迫使脱敏实现下沉（破坏零依赖）或复制一份（双实现漂移）。
   - **附带口径**：CSV 列序 / RFC 4180 / ISO-8601 等格式常量属**实现细节**，随实现留在 `host`，不单独沉到 `types`。
   - **落地**：§3.3。
5. **`policy:test` 进 `npm run ci` 总闸**（进）。
   - **判定依据**：策略是**外部输入**（`documentPath` 指向文件），无测试门禁就会退化成配置漂移 —— 与 §4 风险条「策略文件必须先在配置层校验再编译」同一逻辑。`testPolicy` 是纯函数、只跑内置预设的内联用例，耗时可忽略。
   - **首批范围**：默认跑内置 3 套预设的内联测试；支持 `npm run policy:test -- --file <path>` 对外部文档跑用例（可选参数，CI 只用默认形态）。
   - **落地**：§4.3。
6. **`tool_search` 默认值 → `maxDeclared: 50`、`search: false`（opt-in）**。
   - **判定依据**：默认关闭使**现行为零变化**，不引入回归面；且 `tool_search` 会改变模型可见工具面（§5 风险条：「检索是声明优化，不是权限收窄」），默认开启会造成难以归因的行为差异。50 的取值：约为常见 provider 工具上限 128 的 40%，触发后实际注入 ≤ 51（50 + `tool_search` 元工具），对工具数 < 50 的场景完全不触发。
   - **重评触发条件**：真实场景观测到 `search: true` 稳定优于全量注入后，再翻转默认值（属 minor，不破坏兼容）。
   - **落地**：§5.1。
7. **M7-6 不阻塞 M7 立项 → 拆为 6a / 6b，6a 进首批，6b 延后（6b 已于 2026-09-15 交付，拆分结论不变）**。
   - **判定依据**：M7-6 内部依赖并不均匀 —— **6a（工具面快照 + `tool_search`）只依赖 `types` / `core` / `memory`，不依赖 `mcp`**；只有 **6b（MCP 只读资源）** 才需要 `mcp` 新增 `resources/list` / `resources/read`。四项验收面（成本 / 链路 / 策略 / 工具）互相独立，无交叉依赖。
   - **为什么不让 M7-6 整体延后**：那样首批会缺「工具可控」这一角，`product-direction.md` §5 的「企业能验收的最小治理交付包」就不再四角齐全，对外表述要改。拆出 6a 后四角仍在，而 6b 性质上更接近「MCP 适配完善」而非「治理」。
   - **代价**：需同步 `product-direction.md` §5 的条目表述（M7-6 → 6a / 6b），6a 量级由「中-大」下调为「中」。
   - **落地**：§5（1/2 属 6a，3 属 6b）。
8. **M7-6b 资源物化默认开、但按 server 上限 50（`resourceTools: true` + `maxResourceTools: 50`）**。
   - **判定依据**：规格要求「资源物化为只读工具」，故默认开；但**资源数量完全由远端决定** —— 一个文件系统 MCP server 动辄上千资源，全量物化会直接击穿 6a 刚建立的工具面治理（声明面越宽，模型越难选对、也越贵）。50 对齐 6a 的 `maxDeclared`，使「MCP 资源」这一路新增面与「已有工具」同量级。
   - **为什么不是默认关**：默认关会让「MCP 资源」对模型完全不可见，等于把验收项（物化成功、可 read）做成需要额外开关才成立的能力，与 §5 目标 3 的口径不符；`resourceTools: false` 仍可作为资源密集型 server 的逃生阀保留。
   - **为什么超出的资源不报错**：超出上限只影响**物化**，不影响**可达性** —— 声明域仍是完整列表，宿主/模型仍可经 `McpRegistry.readResource(uri)` 按 URI 读取；静默截断而非报错，避免远端资源数量波动引发注册失败。
   - **为什么 URI 必须在闭包内固定 + 只认已声明 URI**：URI 由远端给出（§5 风险条），若允许模型在调用期传 URI，则提示注入可直接指向 `file:///etc/shadow`；声明域即资源的「sandbox 声明域」，越权在 `McpRegistry` 层就被拒且不转发。
   - **为什么敏感度取 `network-read` 而非按 URI 推断**：URI 长得像本地文件（`file:///`）不代表读取发生在本地 —— 对 agent 而言这是一次对外取数；保守取值让它自然落入既有 gate 矩阵与禁网沙箱，不新增旁路。`harmless` 一旦误判就是「沙箱不设防的读文件」。
   - **重评触发条件**：若真实 MCP server 普遍把长文本资源（>32k）作为主要交付形态，则 `maxResourceChars` 截断语义需改为「落 artifact 存指纹 + 返回摘要」（与 M7-1 的 §8-1 摘要降级同思路）。
   - **落地**：§5.3（含验收映射）。
9. **M7-5 只做底座部分（`compileAgent()` + 配方快照），并发调度不进本批**。
   - **判定依据**：`docs/base-convergence.md` §6 已判「`compileAgent()` / 配方快照校验属底座；多任务并发调度需先论证」。并发调度引入的是**配额与取消语义**，属宿主编排职责，先论证再立项，不混入本批。
   - **为什么仍要单独立项**：`docs/architecture.md` §3.2 的 `compileAgent()` 自 M4 起一直是「设计条目，未排期」（见 `docs/final-review.md`）——它是「配方变更不破坏历史会话」这条验收的唯一实现面，而后者是可恢复性的前提。
   - **落地**：§9。
10. **MCP 可达性校验采用注入式 `resolveMcp`，core 不依赖 `mcp` 包**。
   - **判定依据**：依赖方向为 `mcp → core`（M6 拆包 B1，见 `core/src/index.ts` 注记），core 反向引用会成环。故 core 只接受结构化解析函数 `(ref: { server; tool }) => AnyTool | undefined`，与 `McpRegistry.resolve()` 签名天然兼容，宿主一行 `resolveMcp: (ref) => registry.resolve(ref)` 即可接入。
   - **为什么不在 core 声明 `McpToolRef` 命名类型**：会在 core 与 mcp 各留一个同名接口，形成事实源分裂；结构化参数让两侧**零耦合**且编译期仍受检。
   - **代价**：core 侧无独立类型名，IDE 提示弱一点 —— 换来的是不破坏既有依赖方向。
   - **落地**：§9.2 / §9.3（用例 3、4）。
11. **Schema 校验新增 `validateSchema(schema)`（校验 schema 自身，而非值），落 `types`**。
   - **判定依据**：既有 `validate(value, schema)` 是**值校验**；编译期要的是 **schema 自身合法性**（`type` 拼写错误、`required` 引用不存在的属性、`minimum > maximum`…）。这类缺陷在运行时只表现为「模型永远调不对参数」，极难归因。
   - **为什么落 `types`**：纯函数、零依赖，符合 types 红线（只许契约声明 + 零 IO 纯函数）；且 `mcp` 包归一化远端 schema 后同样需要它。
   - **落地**：§9.1 / §9.3（用例 8）。
12. **配方指纹拆两级：`toolsHash`（硬）与 `instructionsHash`（软）**。
   - **判定依据**：`toolsHash` 变化意味着 checkpoint 里的工具调用**无法复现** —— 必须硬失败（既有行为）。`instructions` 变化不改变工具契约，但会让「同一 checkpoint 在新人设下继续跑」产生语义漂移 —— 默认阻断，允许 `allowInstructionChange: true` 显式放行，作为运维逃生阀。
   - **为什么 `temperature` / `maxTokens` 不纳入**：不影响 transcript 结构，纳入只会制造噪声。
   - **为什么拆两个 hash 而不是一个 `recipeHash`**：单个 hash 无法在「放行 instructions 变化」时区分差异来源，逃生阀会退化成「整体跳过校验」。
   - **兼容性**：旧 checkpoint 无 `instructionsHash` → 退回既有 `toolsHash` + `agentId` 校验，**零破坏**。
   - **落地**：§9.1 / §9.3（用例 6、7）。

---

## 9. M7-5 底座部分：Agent 配方编译与快照（2026-09-15 立项）

> 立项依据：`docs/base-convergence.md` §6；设计出处：`docs/architecture.md` §3.2（`Agent` 演进：`compileAgent()` → 校验重名、MCP 可达性、Schema 合法性，**产物可缓存**）。本批不含并发调度（§8-9）。

### 9.1 包归属与落点

| 包 | 文件 | 改动 |
|---|---|---|
| `types` | `src/schema.ts` | 新增 `validateSchema(schema: JsonSchema): string[]`（校验 schema 自身，§8-11）；纯函数、零依赖 |
| `types` | `src/codes.ts` | `ErrorCode` 增 `AGENT_INVALID`；`NAME_TO_CODE` 增 `AgentCompileError → AGENT_INVALID` |
| `core` | `src/agent.ts` | `AgentOptions` / `Agent` 增可选 `mcpTools?: readonly McpToolRefLike[]`（additive，缺省 `[]`） |
| `core` | `src/compile.ts`（新增） | `compileAgent()`、`AgentCompileError`、`McpToolRefLike`、`CompiledAgent`、`AgentDiagnostic` |
| `core` | `src/index.ts` | 导出上述符号（公共 API 面 additive） |
| `memory` | `src/checkpoint.ts` | `AgentSnapshot` 增可选 `instructionsHash?`；新增 `computeInstructionsHash()`；`assertResumable()` 增软校验分支（§8-12） |

### 9.2 API 变更（全部 additive minor）

```ts
// types
function validateSchema(schema: JsonSchema): string[];   // [] == 合法
ErrorCode.AGENT_INVALID;                                  // "agent_invalid"

// core
interface McpToolRefLike { server: string; tool: string }
interface AgentDiagnostic { level: "error" | "warn"; code: string; message: string; tool?: string }
interface CompiledAgent {
  readonly agent: Agent;
  readonly tools: readonly AnyTool[];        // 本地 + 已解析的 MCP 工具
  readonly toolsHash: string;                // 与 memory.computeToolsHash 一致
  readonly instructionsHash: string;
  readonly warnings: readonly AgentDiagnostic[];   // 编译期 error 直接抛，只留 warn
}
function compileAgent(
  input: Agent | AgentOptions,
  options?: { resolveMcp?: (ref: McpToolRefLike) => AnyTool | undefined },
): CompiledAgent;
class AgentCompileError extends Error { readonly code = ErrorCode.AGENT_INVALID; issues: AgentDiagnostic[] }

// memory
AgentSnapshot.instructionsHash?: string
function computeInstructionsHash(agent: { instructions?: string }): string
function assertResumable(cp: Checkpoint, agent: ToolSurface & { instructions?: string },
                         options?: { allowInstructionChange?: boolean }): void
```

**诊断码**：`duplicate-tool`（重名）、`invalid-schema`（schema 自身非法）、`mcp-unreachable`（MCP 引用未解析）、`empty-tools`（warn，配方无工具）。

### 9.3 验收用例

`packages/core/test/compile.test.ts`（新增，≥8 例）+ `packages/types/test/schema.test.ts`（增 `validateSchema` 用例）：

1. 重名工具 → 抛 `AgentCompileError`，`issues[0].code === "duplicate-tool"`
2. 非法 schema（`type: "strng"` / `required` 引用不存在的属性 / `minimum > maximum`）→ 抛错，`code === "invalid-schema"`
3. MCP 引用未解析（`resolveMcp` 缺省 / 返回 `undefined`）→ 抛错，`code === "mcp-unreachable"`
4. `resolveMcp` 接到 `McpRegistry.resolve` → 解析成功并入 `tools`，且与本地工具同参与重名检测
5. 产物确定性：同一配方两次编译 `toolsHash` / `instructionsHash` 相同（**可缓存**）
6. 配方快照：instructions 变更后 `assertResumable` 抛 `CheckpointMismatchError`；`allowInstructionChange: true` 放行
7. 兼容：旧 checkpoint（无 `instructionsHash`）仍按 `toolsHash` + `agentId` 校验，行为不变
8. `validateSchema`：合法返回 `[]`；各类非法返回非空且含字段路径

### 9.4 风险条

- **编译期校验不是权限**：`compileAgent()` 只保证配方**自洽**（不重名、schema 可解析、MCP 已注册），**不替代** M3 审批与沙箱 —— 编译通过的工具仍须逐次过 gate。与 M7-6a 的「检索是声明优化，不是权限收窄」同源。
- **MCP 可达性是编译期快照**：`resolveMcp` 只证明编译那一刻可达；运行时 server 掉线仍按既有 `McpError` 处理，不因编译通过而放宽。
- **instructions 纳入指纹会让 prompt 微调阻断续跑**：这是刻意的（§8-12）。逃生阀是 `allowInstructionChange`，**不是**改指纹算法 —— 否则护栏形同虚设。

> **M7-5 底座部分已于立项同日（2026-09-15）交付** —— `types` 增 `validateSchema()`（校验 schema 自身）与 `ErrorCode.AGENT_INVALID`；`core` 增 `src/compile.ts`（`compileAgent()` / `agentSnapshotOf()` / `AgentCompileError` / `CompiledAgent`，重名与非法 schema 编译期报错、MCP 可达性经注入式 `resolveMcp` 校验），`Agent` 增可选 `mcpTools?`；`memory` 增 `computeInstructionsHash()` 与 `AgentSnapshot.instructionsHash?`（可选，旧快照零影响），`assertResumable()` 增软校验分支。测试见 `packages/core/test/m7-5.test.ts`（16 例）+ `packages/types/test/schema.test.ts` 增 10 例，`npm run ci` 六门全绿（覆盖率 行 92.73 / 分支 82.55 / 函数 90.34），`check:api` 与 `size` 已重冻（符号 `types` 68→69、`memory` 19→21、`core` 70→78）。

---

## 9. 相关文档

- 收敛与立项口径（事实源）：`docs/base-convergence.md`（§3 三问 / §6 只对底座立项）
- 方向与里程碑草案：`docs/product-direction.md` §5
- 总览索引与状态回填：`docs/development-checklist.md` §0 / §3.3
- 路线图与修订记录：`docs/architecture.md` §11 / §13
- 公共 API 面（本清单全部会触及）：`docs/api-surface.md`
- 既有实现依据：M6 执行清单 `docs/m6-productionization.md`（P3.1 日志 / P3.3 审计 / P3.4 限额 / P3.7 生产预设）
- 产品路径评估（ACP / 流式，不在本清单）：`docs/product-build-paths.md`
