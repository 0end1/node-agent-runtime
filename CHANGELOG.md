# Changelog

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

本文件记录 **Agent Runtime（nodeRuntimes）** 的重要变更。

> **维护约定**：每次代码提交（commit）时，请同步在 [Unreleased] 或对应版本段落追加条目，并将 CHANGELOG 更新与代码放入**同一个 commit**。分类参考 Conventional Commits：`Added` 新增 / `Changed` 变更 / `Fixed` 修复 / `Docs` 文档 / `Security` 安全。

## [Unreleased]

**M7 首批执行清单（docs）**（2026-09-10）：

- **新增 `docs/m7-base-governance.md`（M7 首批执行清单草案）**：把 `docs/product-direction.md` §5 的首批四项拆到「包 / 文件 / API / 验收用例 / 量级」粒度，每项可直接开单。性质为**执行清单（草案）**，截至 2026-09-10 **7 项全部已定（无待拍板）**；不改口径，立项需先按 `development-checklist.md` §4 回填 `architecture.md` §11 + §13。**M7 状态已于 2026-09-11 转 🟡 进行中（见下方 M7-2 条目）**
- **四项落点**：**M7-1** 成本与上下文治理（`types`·`memory`·`core`·`provider-openai`：`RunUsage` 扩展 + `PriceTable`/`usageCost` + `compactMessages` + `usage:update`/`context:compacted` 事件，`runtime.ts:108` 的宿主 `costUsd` 钩子降级为回退）；**M7-2** 可观测与合规导出（traceId 贯穿全部事件 + `startedAt`/`endedAt`（OTEL 导出 `toOtelSpans` 与审计 `serializeAudit` 待补））；**M7-3** 策略工程化（`PolicyDocument` 契约 + `compilePolicy`/`testPolicy` + ≥3 套组织预设，复用 `combinePolicies` 最严语义，glob 自实现）；**M7-6** 工具规模治理（**6a 已交付**：`tool_search` 检索式声明 + 步骤级 `toolSurface` 快照；**6b MCP `resources/list`·`read` 只读资源亦已交付**，2026-09-15）
- **API 变更分级**：首批**全部 additive（minor）**，无需 major —— 以可选字段与新增导出为主；需 `npm run check:api:update` 重冻基线并同步 `api-surface.md`
- **实施顺序**：批次 A **已定（2026-09-10 修订）：延后实发，改为「版本 bump 到 0.3.0 并提交（不发布、不打 tag）」**（实发前置未具备：npm 组织 `node-agent-runtime` 未创建、本机 npm 10.9.4 未登录且 classic token 已被撤销；bump 只改 `package.json` 与 CHANGELOG、**完全可逆**，仍可避开「0.3.0 未发、0.4.0 成堆」的空档）→ 批次 B traceId 横切面 + M7-1 → 批次 C M7-3 → 批次 D **M7-6a**（不依赖 `mcp`）→ 批次 E **M7-6b**（MCP 只读资源，延后）；**M7-1 构成硬顺序约束** —— ACP 把 token 计量升级为协议义务（`usage_update` 的 `used` / `size` 必填），故 M7-1 须先于 ACP 协议包与流式输出（G2），顺序倒置将产生临时计量返工
- **决策记录（§8：7 项全部已定，无待拍板）**：**已定** —— ① **延后实发；改为「版本 bump 到 0.3.0 并提交（不发布、不打 tag）」后再叠 M7**（原为「先实发 0.3.0」；隔离不可回收的版本/tag 语义风险与可回滚的代码/API 风险，M7 落点仍为 0.3.0 → 0.4.0；剩余闸门**不阻塞 M7 写码、只阻塞实发**：npm 组织 `node-agent-runtime`、发布凭据 + npm ≥ 11.5.1、许可边界 `product-direction.md` §8-2）；② compact 采用**纯函数式确定性裁剪**（模型摘要仅作可选 `summarize` 注入钩子，默认关闭；`resume()` transcript 一致性与计量责任归宿主，配合结构化折叠保留用户原始目标与 `deny` 记录）；③ OTEL 导出采用 `core/src/otel.ts` **纯函数产出 OTLP 形状 + 宿主适配传输**（不新增 `@node-agent-runtime/otel` 包，守住「12 包 / 零第三方运行时依赖」口径，重评触发条件为多宿主重复实现传输）；④ **审计导出归 `host`**（导出环节须能兜底 `redact`，不能把「上游一定脱敏过」当唯一防线；格式常量随实现留 `host`）；⑤ **`policy:test` 进 `npm run ci`**（策略是外部输入，无门禁会退化成配置漂移）；⑥ **`tool_search` 默认 `maxDeclared: 50` / `search: false`（opt-in）**（默认关闭使现行为零变化）；⑦ **M7-6 拆为 6a / 6b，6a 进首批、6b 延后**（6a 只依赖 `types`/`core`/`memory`、不依赖 `mcp`；整体延后会缺「工具可控」这一角）
- **口径修正**：`docs/product-direction.md` §0 原「第一批（建议）」仍列审批体验，与 §5 的降级归类矛盾 —— 已对齐为 M7-1/2/3/6 并标注 M7-4 降级
- **索引同步**：`docs/product-direction.md`（§0 / §5 / §9）、`docs/development-checklist.md`（§0 M7 行 / §3.3 注记 / §5 相关文档）、`docs/architecture.md`（§11 M7 行 + §13 v1.13）

**许可边界拍板 + 实发前置解除（docs）**（2026-09-15）：

- **§8-2 许可边界已拍板（open-core）**：`docs/product-direction.md` §8 第 2 项由「待拍板」转为**已定** —— **L0 底座 `@node-agent-runtime/*` 12 包全部 Apache-2.0 并实发 npm**（`LICENSE`、12 包 `license` 字段、README 徽章本就一致）；**L1 治理增值层**（审计导出对接 SIEM、策略中心、配额与预算、SSO/RBAC、商业支持）**另行闭源**，落在 12 包之外的独立仓库 / 独立包。**新增能力先自问「属于 L0 还是 L1」** —— 12 包一旦以 Apache-2.0 实发即不可回收，闭源能力不得以「先在底座埋点 / 预留钩子」的方式变相混入 L0
- **实发三项前置全部解除**（核验记录见 `docs/m7-base-governance.md` §6）：① npm 用户/组织 `node-agent-runtime` 已存在（granular token `whoami` 命中，与 scope 同名）；② granular access token 已签发，配置为仓库 secret `NPM_TOKEN`（**首发不走 OIDC** —— 未发布包无 Trusted Publisher 配置入口，12 包上架后逐包配置转免 token）；③ 许可边界已拍板（上条）
- **口径厘清（两项，修正既有记载）**：**npm ≥ 11.5.1 降级为非阻塞** —— 它是**转 OIDC** 的前置而非首发阻塞，首发用 granular token，CI 由 `setup-node` 按 `.nvmrc`（22.22.1）装配 npm；**首发可带 provenance** —— npm 的真实门槛是「云托管 runner + `id-token: write` + npm CLI ≥ 9.5.0 + `access=public` + `repository` 字段匹配」，本仓 `release.yml:16-19` / `runs-on: ubuntu-latest` / `.changeset/config.json` 的 `access: "public"` / 12 包 `repository.url` 全部满足；`Can't generate provenance for new or private package`（npm/cli#7706）**只在 `access` 未设 public 时触发**，与仓库是否私有无关
- **发布路径**：走 `release.yml` 的 changesets 流程（CI 读 secret `NPM_TOKEN`）—— 本地 `npm run version-packages` 消费 7 个 changeset 把 12 包统一 bump 到 **0.4.0** 并 push，CI 检测无剩余 changeset 后直接执行 `npm run release`

**批次 A：版本 bump 到 0.3.0（chore，未发布）**（2026-09-11）：

- 消费 `.changeset/p4-sdk-publishing.md`，12 包 `0.2.0 → 0.3.0`；包间 `dependencies` / `devDependencies` / `peerDependencies` 同步为 `^0.3.0`，并生成 12 份包级 CHANGELOG
- 同步 `package-lock.json` —— `changeset version` 不同步 lockfile，而 CI 用 `npm ci`，不同步会以「out of sync」直接失败
- **未发布、未打 tag**：本次只 bump，M7 的 changeset 因此干净落在 0.3.0 → 0.4.0

**M7-2 traceId 贯穿（feat，横切面先行）**（2026-09-11）：

- **traceId 成为事件横切面**：`types` 的 19 个事件接口统一增可选 `traceId?`；`run:start` 增 `startedAt`、`run:end` 增 `endedAt`（epoch ms）；`core` 的 `RunOptions` 增可选 `traceId?`（缺省 `newId("trace")`，宿主可注入以对齐外部链路），`RunResult` 增 `traceId` 以回显
- **注入点收口且并发安全**：traceId 在 `emit()` 内注入（与 `redact()` 同处，故不可能被绕过），但以 **run 内闭包**传递而非实例字段 —— 同一 `AgentRuntime` 上并发的 run 互不串扰；事件已自带 `traceId` 时不被覆盖
- **日志可关联**：`Logger` 增可选 `child?(ctx: LogContext): Logger`，`ConsoleLogger` 已实现（`child` 继承 level 与 stream，并逐层合并上下文）；**未绑定上下文时输出格式与改动前逐字一致**，既有日志解析脚本不受影响。注：`toLogger` 兼容层不变，故传入 legacy 回调型 logger 时日志不带 trace 上下文
- **测试**：新增 `packages/core/test/trace.test.ts`（12 例）—— 一次 run 事件 traceId 一致 / 跨 run 不同 / 宿主注入被沿用 / 并发 run 不串扰 / 时间戳单调 / `child` 上下文与格式回归 / run 级日志带 traceId
- **门禁**：`npm run ci` 六门全绿；core 行覆盖 90.92%；体积 core +2.1% / types +0.4%（阈值 +25%）；`docs/api-surface.md` §2 增 `LogContext` 与 M7-2 注记，并已 `--update` 重冻基线
- **已知缺口**：步骤/工具级事件尚无时间戳 —— `toOtelSpans` 要给 step / tool span 填 `startTimeUnixNano` / `endTimeUnixNano`，届时须先补 `at?: number`（additive minor）
- **索引同步**：`docs/architecture.md`（§11 M7 行 ☐ → 🟡、§13 v1.14）、`docs/development-checklist.md` §0 M7 行、`docs/m7-base-governance.md` §3、`docs/api-surface.md` §2

**M7-1 成本与上下文治理（feat）**（2026-09-15）：

- **内置计量（脱钩宿主钩子）**：`types` 新增 `pricing.ts`（`PriceTable` + `usageCost` 纯函数，缓存命中价与未配价回退）；`RunUsage` 增 `cachedInputTokens?` / `costUsd?`；`core` 的 `AgentRuntimeOptions` / `RunOptions` 增 `pricing?`，**优先级 `pricing` > `costUsd` 钩子**（钩子保留为回退，不破坏既有宿主）；用量更新后补一次预算校验使 `maxCostUsd` 在成本已知后生效
- **上下文预算与压缩**：`memory` 新增 `compact.ts`（`ContextBudget` + `compactMessages` 确定性纯函数，零依赖、字符/4 估算、`countTokens` 可注入、结构化折叠保留用户原始目标与工具结果关键字段）；`core` 在 step 循环内 provider 调用前执行 compact 并发 `context:compacted`
- **事件与配置**：`types` 新增 `UsageUpdateEvent`（`usage:update`，含 `costUsd?` / `contextUsed` / `contextSize`）与 `ContextCompactedEvent`（`context:compacted`）；`core` 的 `RuntimeConfig` 增 `context?` / `pricing?` + `AGENT_CONTEXT_*` 环境变量；`provider-openai` 解析 `prompt_tokens_details.cached_tokens`
- **测试**：新增 `packages/types/test/pricing.test.ts` / `packages/memory/test/compact.test.ts` / `packages/core/test/m7-1.test.ts`（共 19 例，覆盖计量精确性、续账等价、压缩触发与可续跑、maxCostUsd 生效）
- **门禁**：`npm run ci` 六门全绿；体积 memory +21.0%（阈值 +25%）/ types +6.2% / core +1.7%；已 `check:api:update` 重冻基线
- **索引同步**：`docs/api-surface.md` §0（memory 符号数 14→19）、`docs/development-checklist.md` §0 M7 行、`docs/m7-base-governance.md` §2

**M7-3 策略工程化（feat）**（2026-09-15）：

- **声明式策略契约**：`policy` 新增 `PolicyDocument` / `PolicyRule` / `PolicyTestCase` / `PolicyTestResult`（`match` 支持 `tool` / `toolPattern`（glob 自实现）/ `kind` / `mode` / `pathGlob`）；`validatePolicyDocument` 复用 `types` 的 `validate` + 结构检查（未知 verdict / 缺 `id` / `version` 非 1 / `kind`·`mode` 非法直接报错）
- **编译与测试**：`compilePolicy(doc)` 将规则编译为 `PermissionPolicy`，命中多条按 `combinePolicies` **最严语义**求交（`allow < ask < deny`，不新造语义），与 `DefaultPermissionPolicy` 逐格等价（5 `ToolKind` × 3 `SandboxMode` 共 15 组合断言通过）；`testPolicy` 运行文档内联用例，返回逐条 pass/fail 与差异说明
- **组织预设**：`PRESETS` 提供 `prod-strict`（凭证三档全 `deny`，与 `PRODUCTION_MATRIX` 一致）/ `dev-open`（全放开）/ `readonly-audit`（只读偏置）三套，各带内联测试
- **配置接入**：`core` 的 `RuntimeConfig.permission` 增 `preset?` / `documentPath?`，env `AGENT_POLICY_PRESET` / `AGENT_POLICY_FILE`；外部策略文件先校验后编译，`documentPath` 非法时 `loadConfig()` 抛 `ConfigError`
- **CI 门禁**：新增 `npm run policy:test`（跑内置预设内联测试）并纳入 `npm run ci`
- **架构取舍**：spec 草案写「契约落 `types/src/policy.ts`」，但 `PermissionContext` / `PolicyRule.match.mode` 依赖 `SandboxMode`（在 `sandbox`），而 `sandbox` 已依赖 `types`——若 `types` 反向引入 `sandbox` 会破坏 `types ← sandbox` 的 DAG，故声明式契约随 `policy` 包落地（纯契约、零第三方依赖）
- **测试**：新增 `packages/policy/test/document.test.ts`（33 例，覆盖校验拒绝、最严语义、与 `DefaultPermissionPolicy` 逐格等价、预设全绿/故意失败、glob、prod-strict 凭证全拒、`extends` 合并）
- **门禁**：`npm run ci` 六门全绿；体积 policy +40.6%（阈值 +25%，有意增长，`npm run size:update` 重冻基线）；已 `check:api:update` 重冻基线
- **索引同步**：`docs/api-surface.md` §0（policy 符号数 19→28）、`docs/development-checklist.md` §0 M7 行、`docs/m7-base-governance.md` §4

**M7-6a 工具规模治理（feat）**（2026-09-15）：

- **检索式工具声明（`tool_search`）**（`packages/core/src/tool-search.ts` 新增）：`ToolIndex` 按 name/description/kind 建倒排索引 + 子串打分（零依赖，整短语匹配加权）；`createToolSearchTool` 生成 `tool_search` 元工具（kind `harmless`），返回命中工具名/描述供模型按名调用——**非权限收窄**，执行仍走全量 `toolMap`（gate/sandbox 不变）。
- **声明面裁剪（opt-in）**：`RunOptions.toolBudget?: { maxDeclared?: number; search?: boolean }`（默认 `maxDeclared: 50`、`search: false`）。仅当 `search: true` 且工具数 > `maxDeclared` 时向模型注入 `tool_search` + 前 `maxDeclared` 个工具；`toolMap` 始终全量，故未声明但被显式调用的工具仍可执行（验收已覆盖）。
- **步骤级工具面快照**：`StepSnapshot.toolSurface?: { declared; used }` + `StepStartEvent.declaredTools?`（与实际注入一致，审计/对账用）；`memory` 的 `Checkpoint` 增 `toolSurface?`（additive），`host` 的 `onStepEnd` 已把 `StepSnapshot.toolSurface` 接进落库 Checkpoint。
- **与 `toolsHash` 独立**：`toolSurface` 记录本步声明/执行面，`toolsHash` 校验配方指纹（续跑护栏），两者互不替换（验收已覆盖）。
- **测试**：新增 `packages/core/test/tool-search.test.ts`（13 例：索引中文/英文/空查询/limit/重名/无命中、元工具返回）+ `packages/core/test/m7-6.test.ts`（声明面裁剪 ≤51、tool_search 发现、未声明工具仍可执行、toolSurface 快照）；`npm run ci` 全绿。
- **门禁**：`npm run ci` 六门全绿；已 `check:api:update` / `size:update` 重冻基线。
- **索引同步**：`docs/api-surface.md` §0（core 符号数 60→66）、`docs/development-checklist.md` §0 M7 行、`docs/m7-base-governance.md` §5。
- **6b（MCP 只读资源）原定延后**，已于 2026-09-15 交付，见下方「M7-6b」条目。

**M7-2 收尾：OTEL span 导出 + 审计导出（feat）**（2026-09-15）：

- **前置补齐：步骤/工具级时间戳**：`types` 的 `StepStartEvent` / `ToolStartEvent` / `ToolEndEvent` 增可选 `at?`（epoch ms），由 `core` 在 `step:start` / `tool:start` / `tool:end` 发射点补齐（additive minor）—— 此前仅 `run:start` / `run:end` 带时间，span 无法推导 step / tool 起止，是 M7-2 目标 2 的已知前置缺口
- **OTEL 导出（`packages/core/src/otel.ts` 新增）**：`toOtelSpans(event | event[], ctx?)` 纯函数产出 OTLP-JSON 形状（`traceId` 32 hex / `spanId` 16 hex / `parentSpanId` / `name` / `startTimeUnixNano` / `endTimeUnixNano` / `attributes` / `status`）；父子关系由 `runId` + `step` 推导（run → step → tool），id 由事件内容**确定性派生**（无随机数），故纯函数可测、同输入同输出。**只产出数据形状**：不绑定 OTLP 传输 / HTTP / gRPC、不引入任何第三方依赖、**不新增包**（守「12 包 / 零第三方运行时依赖」口径，见 `m7-base-governance.md` §8-3）；传输适配由宿主或 `examples/` 承担
- **审计导出（`packages/host/src/audit-export.ts` 新增）**：`serializeAudit(records, { format })`（CSV / JSON）与 `exportAudit(store, query?, options?)`（按 `ApprovalQuery` 从 `ApprovalStore` 拉取后序列化）。归 `host` 的理由：导出环节须能兜底复用 `core` 的 `redact`（放 `types` 会因零依赖拿不到脱敏实现）
- **导出确定性与脱敏红线**：CSV 列序固定且**只含 `argumentsFingerprint`、不含工具参数原文**，RFC 4180 转义（逗号 / 引号 / 换行）、ISO-8601 UTC 时间、`\n` 行尾；JSON 为稳定键序数组；**每条记录先过 `redact` 再落盘**，故 `sk-xxxx` 形态明文不会出现在导出物 —— 导出物不得成为密钥的第二份副本（P3.2 / P3.3 红线）
- **测试**：新增 `packages/core/test/otel.test.ts`（7 例：父子结构、id 形态与确定性、时间戳单调、失败工具 `ERROR` 状态与属性、跨 run traceId 不同、`serviceName`；另含一次**真实 run** 验证 runtime 确实补齐 `at`）与 `packages/host/test/audit-export.test.ts`（7 例：表头固定、整串密钥被屏蔽、RFC 4180 转义、ISO 时间、JSON 稳定键序、行数与决策数一致、store 过滤）
- **门禁**：`npm run ci` 六门全绿；已 `check:api:update` / `size:update` 重冻基线
- **索引同步**：`docs/api-surface.md` §0（core 66→70、host 10→14）+ §2 / §9、`docs/development-checklist.md` §0 M7 行、`docs/m7-base-governance.md` §2 / §3、`docs/architecture.md` §11

**M7-6b：MCP 只读资源（`resources/list` · `resources/read` + `searchTools`，feat）**（2026-09-15）：

- **协议扩展（`packages/mcp/src/types.ts`）**：新增 `McpResourceMeta` / `McpResourceContent` / `McpReadResourceResult`；`McpServerHandle` 增**可选** `listResources()` / `readResource(uri)` —— 可选即 additive，既有 handle 实现（含用户自建传输）零改动
- **传输层（`client.ts`）**：`McpClient` 记录 `initialize` 协商出的 `capabilities`，据此暴露 `resourcesSupported`；`listResources()` 按 cursor 翻页（与 `tools/list` 一致），`readResource(uri)` 校验 `contents` 数组。**未声明 `resources` 能力的 server 直接返回 `[]` 而非报错**（无资源 ≠ 故障），协议层畸形响应仍抛 `McpError`
- **资源物化（`registry.ts`）**：`register()` 顺带列取资源并物化为**只读工具**，命名 `mcpResourceToolName()` → `mcp__<server>__resource__<slug>_<fnv1a8>`（确定性、防碰撞）；URI 在闭包内固定，模型无法在调用期改写
- **敏感度取保守值 `network-read`**：资源读取对 agent 而言是一次对外取数，不因 URI 长得像本地文件就判 `harmless`；因此天然走既有 gate 矩阵与 `LocalSandbox`（`network: "deny"` ⇒ `沙箱已禁网`，测试已断言），**未新增旁路**
- **越权 URI 防线**：`McpRegistry.readResource(uri)` 只接受 `resources/list` **已声明**的 URI，未声明一律 `McpResourceError`（URI 由远端给出，模型幻觉 / 提示注入都可能指向 `file:///etc/shadow`）—— 即资源的「sandbox 声明域」
- **工具规模护栏**：`resourceTools`（默认 `true`）+ `maxResourceTools`（默认 50，对齐 M7-6a `maxDeclared`），超出的资源不物化但仍可按 URI 读取 —— 文件系统类 server 动辄上千资源，全量物化会直接击穿 M7-6a 的治理目标（决策记录见 `m7-base-governance.md` §8-8）
- **上下文护栏**：`resourceText()` 纯函数把 `contents` 摊平成文本——`text` 原样取用，`blob` **仅文本类 mime 才 base64 解码**（二进制不进上下文），并按 `maxResourceChars`（默认 32k）截断，避免一次读取撑爆上下文（M7-1 口径）
- **检索**：`McpRegistry.searchTools(query, limit?)` 复用 `core` 的 `ToolIndex`（M7-6a），工具与资源工具一并参与排序，注册/注销时索引失效重建；空查询返回 `[]` 不抛错
- **测试**：新增 `packages/mcp/test/m7-6b.test.ts`（13 例：声明域列取、物化与固定 URI、命名确定性与字符白名单、越权 URI 被拒且不转发、sandbox 禁网拒绝 / 放行后成功、`resourceTools: false` 仍可读、`maxResourceTools` 上限、注销清理、`searchTools` 排序与空查询）；`mcp.test.ts` 增 4 例（HTTP mock 的 `resources/list`·`read`、远端未知 URI → `McpError{remote:true}`、无 `resources` 能力的 server 降级为无资源、真实子进程读取）
- **门禁**：`npm run ci` 六门全绿；`check:api` / `size` 已重冻（mcp 符号 29→40；tarball +8KB / **+28%** 触发 +25% 阈值 —— 基线文件本身不带说明字段，理由记录于此：新增资源模块（协议类型 + 客户端 2 方法 + registry 物化/声明域/检索 + `resourceText`）的固有增量，非无用膨胀，取舍见 `m7-base-governance.md` §8-8）
- **索引同步**：`docs/api-surface.md` §0 + §10、`docs/development-checklist.md` §0 M7 行、`docs/m7-base-governance.md` §0 / §5 / §8-8、`docs/architecture.md` §5.3
- **口径收口（同日补）**：`docs/product-direction.md` §5（M7-6 行与执行清单注记）与 `docs/m7-base-governance.md` 内 6 处「6b 延后」残留表述统一更正为「已交付」（§0 六角说明、§4 批次图与拆分理由、§5 拆分注记、§8-7 标题）；两处决策项计数 7 → 8

**M7-5（底座部分）：Agent 配方编译与快照（feat，2026-09-15）**：

- **立项依据**：`docs/base-convergence.md` §6 —— 「`compileAgent()` / 配方快照校验属底座；多任务并发调度需先论证」，故本批**只做底座部分**，并发调度（配额 / 取消语义）不进本批。设计出处 `docs/architecture.md` §3.2（该函数自 M4 起一直是「设计条目，未排期」）。执行清单 `docs/m7-base-governance.md` §9，决策 §8-9~12
- **`compileAgent()`（`packages/core/src/compile.ts`，新增）**：把三类缺陷提前到编译期 —— **工具重名**（复用 `findDuplicateToolNames`，且 MCP 物化工具与本地工具**同一命名空间**参与检测）、**参数 schema 非法**（新增 `validateSchema`，见下）、**MCP 引用不可达**（`mcpTools` 经注入的 `resolveMcp` 解析失败即报错）。错误**一次性汇总**而非 fail-fast：`AgentCompileError.issues` 给出全部问题；产物 `CompiledAgent` 含 `toolsHash` / `instructionsHash`，**确定性故可缓存**
- **MCP 可达性为什么是注入式（§8-10）**：依赖方向为 `mcp → core`，core 反向 import 会成环；故 core 只接受结构化 `{ server, tool }` 与 `(ref) => AnyTool | undefined`，宿主一行 `resolveMcp: (ref) => registry.resolve(ref)` 即可接入 —— 零耦合，且仍受类型检查。不新增 `McpToolRef` 命名类型，避免 core / mcp 两侧事实源分裂
- **`validateSchema`（`packages/types/src/schema.ts`，新增，§8-11）**：校验 **schema 自身**而非值（既有 `validate` 是值校验）—— 未知 `type` / 空 `type` 数组 / `required` 引用未定义属性 / `minimum > maximum` / 非布尔 `additionalProperties` 等，报错带字段路径；递归深度上限 12 防病态嵌套。纯函数零依赖，符合 types 红线。理由：schema 写错在运行时**不会报错**，只表现为模型一直调错参数，极难归因
- **配方指纹拆两级（§8-12）**：`toolsHash`（硬：工具集变化 ⇒ transcript 无法复现）与新增 `instructionsHash`（软：语义漂移，可 `allowInstructionChange: true` 显式放行）。`AgentSnapshot` 增**可选** `instructionsHash?` —— **旧 checkpoint 无此字段时退回既有 `toolsHash` + `agentId` 校验，零破坏**；`assertResumable` 增第三参 `AssertResumableOptions`，`agent` 形参放宽为 `ToolSurface & { instructions?: string }`，既有调用点零改动。`temperature` / `maxTokens` **不纳入**指纹（不影响 transcript 结构）
- **API 变更**：全部 additive（minor）—— 符号数 `types` 68→69、`memory` 19→21、`core` 70→78；`ErrorCode` 增 `AGENT_INVALID`，`AgentCompileError` 已入 `NAME_TO_CODE` 映射
- **测试**：新增 `packages/core/test/m7-5.test.ts`（**16 例**：干净配方、重名、非法 schema、`required` 悬空、多问题一次汇总、MCP 未解析、注入 resolver 合并、本地与 MCP 撞名、确定性可缓存、工具顺序无关但指令敏感、空工具 warn、接受 `Agent` 实例、快照产出、指令漂移阻断与 `allowInstructionChange` 放行、旧快照兼容、异名 agent 拒绝）；`packages/types/test/schema.test.ts` 增 **10 例**（`validateSchema`）
- **门禁**：`npm run ci` 六门全绿（lint 0 error / 3 个既有 warning；全仓覆盖率 行 92.73 / 分支 82.55 / 函数 90.34；`check:api` 与 `size` 已重冻）
- **索引同步**：`docs/api-surface.md` §0 + §2 + §3、`docs/m7-base-governance.md`（§0 表 + 新增 §9 + §8-9~12 决策）、`docs/architecture.md` §11 M7 行 + §13 v1.17
- **刻意未做**：并发调度（按 §6 需先论证）；**`compileAgent()` 不是授权检查** —— 编译通过的工具仍须逐次过 M3 审批与沙箱（与 M7-6a「检索是声明优化，不是权限收窄」同源）

**许可证 MIT → Apache-2.0（chore，2026-09-12）**：

- **13 份 LICENSE 换正本**：根 `LICENSE` 与 12 个包的 `LICENSE` 替换为 Apache License 2.0 官方文本（含 `Copyright 2026 wangzhiyong` 附录）
- **13 份 `package.json`**：`license: "MIT"` → `"Apache-2.0"`（根 + 12 包）；`package-lock.json` 同步（`npm install --package-lock-only`）
- **文档口径**：`README.md`（badge + 许可证链接）、`docs/product-direction.md` §8-2（许可策略由「全仓 MIT」改为「全仓 Apache-2.0」，标注 2026-09-12 切换）、`docs/m7-base-governance.md` §6（「与 Apache-2.0 口径一致」「Apache-2.0 不可回收」）同步
- **刻意未改历史记录**：`CHANGELOG.md` / `docs/architecture.md` §13 v1.10 / `docs/development-checklist.md` P4 行 / `docs/m6-productionization.md` 中「MIT LICENSE」均为 2026-09-08/09 的既成事实（Gate 4 落地记录），不改写
- **代价（预期且不可避免）**：Apache-2.0 文本约 202 行（~11KB）vs MIT ~1KB；npm 把 `LICENSE` 打进每个包 tarball，故 12 包体积整体 +~10KB（最小包 artifact +63.8% 最敏感）。已 `npm run size:update` 重冻基线并说明——属许可证切换固有成本，非代码膨胀
- **Apache-2.0 相对 MIT 的取舍**：增**显式专利授权**（对企业友好）；要求保留 NOTICE、修改文件标注变更（下游义务更重）；**不兼容 GPLv2**（GPLv3 兼容），MIT 两者皆兼容；同样**无 copyleft**，open-core（闭源增值）形态不受影响
- **未做（可选）**：未新增 `NOTICE` 文件——Apache-2.0 仅在有 NOTICE 时才要求随衍生作品分发，当前无 NOTICE 即无此义务（日后引入第三方代码再补）

**项目全量改名 `agent-runtime` → `node-agent-runtime`（chore）**（2026-09-12）：

- **npm scope**：12 个包 `@agent-runtime/*` → `@node-agent-runtime/*`（711 处引用全量替换 —— 源码 import、`dependencies`/`devDependencies`/`peerDependencies`、tsconfig paths、`.changeset/config.json` 的 `fixed` 组、`api-surface` 与 `size` 基线、`package-lock.json`）
- **小写标识同步**：根包名 `agent-runtime` → `node-agent-runtime`；日志前缀 `[agent-runtime]` → `[node-agent-runtime]`；`deploy/systemd/agent-runtime.service` 与 `deploy/nginx/agent-runtime.conf` 两个文件一并重命名
- **仓库引用同步**：13 份 `package.json` 的 `repository` / `homepage` / `bugs` 指向 `https://github.com/0end1/node-agent-runtime`（配合 GitHub 仓库改名）
- **刻意未改**：① 类名 `AgentRuntime`（公共 API，改动即破坏性变更，本次未要求）；② CHANGELOG 与 `docs/codex-reference.md` 中 M5-8 的**历史记述**（`0end1/nodeRuntimes → 0end1/nodeRuntime` 是既成事实，不应改写）
- **验证**：`npm install` 重建 workspace 软链后 `npm run ci` 六门全绿；无 `node-node-agent-` 双重前缀残留
- **待办（需你操作）**：① 在 GitHub 将仓库 `nodeRuntime` 改名为 `node-agent-runtime`，随后本地 `git remote set-url origin https://github.com/0end1/node-agent-runtime.git`；② 在 npmjs.com 创建**免费组织 `node-agent-runtime`**（组织名是否已被占用无法离线判定）

**产品落地路径评估与 ACP 路径（docs）**（2026-09-10）：

- **新增 `docs/product-build-paths.md`（产品落地路径评估，对照 6 个同类产品）**：以 AionUi / DeepChat / opencode / Codex / MonkeyCode / CodeBuddy 为参照归纳四种原型，回答「用底座的哪个子集、以什么产品形态、需要补什么，才能做出一个完整产品」。结论：能做且底座复用率很高，但**缺的是工具面与交互面，不是引擎**——差异不在引擎（审批 / 沙箱 / 续跑在同类产品里已是"已解决的问题"），治理能力是唯一可做深的卖点
- **v2 新增 ACP 路径（结论相比 v1 有实质变化）**：**做 ACP Agent Server、接入已存在的壳**（DeepChat / Zed / JetBrains）为最短路径，一次适配即获得桌面与编辑器形态；论证 `@node-agent-runtime/acp` 协议适配包满足 `base-convergence.md` §2.1 四条底座判定，**可立项而不触碰 §2.4「应用层出局」**；并指出 ACP 只定义"能请求权限"，**未定义**审计留痕与参数指纹、步级快照与指纹校验续跑、三档沙箱强制语义、密钥脱敏——空白处正是现有资产
- **缺口与动作**：G1 编码工具集 / G2 流式 / G3 交互层 / G9 无 ACP 适配等缺口表 + 路径排序（v2：G9 成本最低且收益最大，G1 在 ACP 路径下非必需、G3 完全免做）；P0 动作为 `@node-agent-runtime/acp`（`initialize` / `session.new` / `session.prompt` / `session.cancel` + `session/update` 事件翻译）与权限桥接（`session/request_permission` ↔ `PermissionManager`、`session/set_mode` ↔ `SandboxMode`）
- **性质与待决**：本文为**待拍板评估**，不单方面改变现有口径（与 §2.4 的冲突范围与解法见 §7）；待核对 ACP 传输方式与 `session/update` 是否要求 token 级分块（决定 G2 是否为前置），待决策是否先走路径 D 与 `tools-code` 优先级
- **索引同步**：`docs/base-convergence.md`（§2.3 移出说明与文末相关文档增链）、`docs/product-direction.md`（§3-D / §4 产品侧形态候选 / §7 风险 / §8-3 决策项 / §9 增链）
- **范围**：本次仅新增文档与索引链接，未触碰 `packages/*`、测试与脚本逻辑

**桌面端移出底座 · 方向归产品侧（docs/config）**（2026-09-10）：

- **决策**：底座收敛**取消桌面端** —— `examples/desktop-tauri/`、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs` 与 **P5.1~P5.4 整体移出底座范围**，方向与投入归产品侧；底座侧不再投入，也不再判定其立项与否。原「桌面端冻结（保留项）」口径与「消费级桌面助手 → 不立项」条目一并撤销
- **事实源回填**：`docs/base-convergence.md` 由「三分类 + 出局」改为「**二分类 + 移出 + 出局**」（§2.3 改为「移出至产品侧（HANDOFF）」，含移出对象 / 移出含义 / 产品侧承接位置；§2.4 撤销消费级桌面条目并注明）；`docs/m6-productionization.md` §5「挂起决定」回填为「**移出决定**」（P5.1~P5.4 状态改 ⏸、Gate 5 退出标准修订为仅 Web 形态与生产存储、P5.3 风险项转出）
- **产品侧承接**：`docs/product-direction.md` 承接桌面端方向（§0 形态定位、§3-D 改为「桌面形态」候选、§4 新增「产品侧形态候选」分层与说明、§6 分发、§7 风险、§8-3 决策项改为「自建壳 vs ACP 接入已有客户端」）；`docs/m5-productization.md` §#3 Desktop 增追注
- **口径同步**：`docs/architecture.md` §1 注记 + §13 v1.12、`docs/development-checklist.md`（一句话现状 / §0 M6 行 / §3.1 P5 行 / §3.3 M7 注记 / §5）、`docs/remaining-tasks.md`（顶部追注 + A1 行）、`README.md`（定位注记 + 结构树）、`examples/desktop-tauri/README.md` 与 `.github/workflows/desktop.yml` 顶部注记（冻结 → 移出至产品侧）
- **范围**：本次仅文档与注释改动，未触碰 `packages/*`、测试与脚本逻辑

**底座收敛（口径与边界，docs/config）**（2026-09-10）：

- **新增 `docs/base-convergence.md`（收敛决策事实源）**：确立「**底座 = `packages/*` 12 包**」为唯一一等公民；`examples/cli.ts` / `examples/web/` / `deploy/` / `scripts/e2e/` / `scripts/smoke-web.mjs` 降级为**验证载体**（只验证底座、不演进产品）；`examples/desktop-tauri/`、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs` 与 P5.1~P5.4 标注**冻结**（保留代码与恢复条件）；垂直行业应用 / 消费级桌面 / Rust 移植 / 多 Agent 协同**明确不立项**；给出「三问准入规则」与「运行时分层 ≠ 投入分层」口径，并重定 M7 立项口径（只对底座立项）
- **架构叙事改口径**：`docs/architecture.md` §1 增补口径注记（Desktop 不再是顶层投入对象，仅作可选展示面）、§11 新增 M7 行（底座收敛与治理交付，首批 M7-1/2/3/6）、§13 新增 v1.11 修订记录
- **方向文档对齐**：`docs/product-direction.md` §0「产品形态定位」改为底座 SDK 唯一一等公民、§4 分层图「控制台升级为治理工作台」路径**撤销**（改验证载体）、§5 按立项口径重归类（M7-4 与 M7-7 的 UI 部分降级、首批改为 M7-1/2/3/6）、§9 增链
- **入口与索引对齐**：`README.md`（项目定位注记 + 快速开始口径 + 结构树标注 desktop-tauri 冻结与 deploy）、`docs/development-checklist.md`（一句话现状 / §0 新增「M7 · 底座收敛」行 / §3.3 立项口径）、`docs/remaining-tasks.md`（顶部底座收敛追注）
- **冻结标注**：`examples/desktop-tauri/README.md` 顶部冻结声明、`.github/workflows/desktop.yml` 顶部冻结注释（不进常规 CI 前置；恢复条件=需要桌面形态对外交付且凭证到位）
- **范围**：本次仅文档与注释改动，未触碰 `packages/*`、测试与脚本逻辑

**M7 方向规划与 P5 挂起登记（docs）**（2026-09-10）：

- **新增 `docs/product-direction.md`（产品方向规划 M7+）**：资产盘点（治理纵深强 / 应用表层弱）、方向候选与评估矩阵（A 开源底座 + 企业治理增值〔推荐〕/ B 企业私有化运行时平台 / C 垂直应用 / D 消费级桌面）、推荐主线分层（L0 MIT SDK → L1 企业治理增值 → L2 托管，控制台升级为治理工作台）、M7 里程碑草案（M7-1 成本与上下文治理 / M7-2 可观测与合规导出 / M7-3 策略工程化 / M7-4 审批体验 / M7-5 编排能力 / M7-6 工具规模治理 / M7-7 生态入口）、分发与商业化路径、风险与待决策项
- **P5 挂起为保留项**：`docs/m6-productionization.md` §5 新增挂起决定 —— P5.1 实机验证 / P5.2 签名+公证 / P5.3 三平台矩阵 / P5.4 自动更新链路因缺 Apple Developer 证书与仓库 secrets 挂起（代码、脚本、CI 配置均已就绪），恢复顺序 P5.2 → P5.1 → P5.3 → P5.4，不纳入 M7 关键路径
- **双源同步**：`docs/development-checklist.md`（一句话现状 / §0 M6 行 / §3.1 P5 行 / §3.3 M7 注记 / §5 链接）与 `docs/remaining-tasks.md`（顶部决策段追注 + A1 行）同步为「挂起为保留项」

**M6-27 · 桌面自动更新接入（P5.4，可选门）**（2026-09-09）：

- **P5.4 自动更新链路接齐**：Rust 侧接入 `tauri-plugin-updater`（`examples/desktop-tauri/src-tauri/Cargo.toml`），以自定义命令暴露 `check_update` / `install_update`（`lib.rs`，前端无需引入 `@tauri-apps/plugin-updater`）；`tauri.conf.json` 配 `plugins.updater`（endpoints → GitHub Release `latest/download/latest.json`、pubkey）与 `bundle.createUpdaterArtifacts`
- **capabilities**：新增 `src-tauri/capabilities/default.json`，放行控制台 remote origin（`http://localhost:8787`）的 IPC（应用自定义命令无需额外 permission）
- **控制台入口**：`examples/web/public/index.html` 标题栏新增「检查更新 → 下载并安装」徽标入口（`data-state` busy/ok/err 反馈、安装前二次确认、成功后应用自动重启）；仅 Tauri 壳内显示（检测 `window.__TAURI_INTERNALS__`），浏览器直开不可见
- **密钥与文档**：签名密钥对已生成于 `examples/desktop-tauri/.tauri/`（根 `.gitignore` 新增 `.tauri/`，私钥绝不入库；公钥已写入 conf）；desktop-tauri README 记录本地签名密钥与「构建/发布必须注入 `TAURI_SIGNING_PRIVATE_KEY`」要求；`docs/m6-productionization.md` P5.4 状态更新为「代码与配置就绪」
- **测试/验证**：`cargo check` 通过（修复 updater API 字段 `notes`→`body`、`restart()` 后的不可达代码）；`tauri.conf.json` 与 capabilities JSON 语法校验通过；旧版→新版实机链路待首次 tag 发布（依赖 P5.2 签名与公证）后验证

**M6-26 · 路线图回填与文档收敛（P6.3~P6.6）**（2026-09-09）：

- **P6.3 路线图回填**：`docs/architecture.md` §11 M6 行更新为「Gate 1~4 已关闭 + P5/P6 进度」（附各 Gate 完成批次与 P5 受阻说明）；§13 修订记录新增 v1.10（M6-P2~P6 收尾：质量门 / 可观测与安全 / 发布工程 / 分发部署 / 治理文档）
- **P6.4 文档收敛**：`docs/remaining-tasks.md` 双处同步 —— A1 ⏳（由 P5.1 承接：验收脚本就绪、待签名后实机复验）、A4 ✅（由 P6.3 完成）、D2 ✅ 已拉近、D1/D3 维持远期
- **P6.5 CHANGELOG**：M6 各批次条目随 commit 追加（M6-18 … M6-26）
- **P6.6 参考机制复核**：`docs/codex-reference.md` 与 `docs/deepseek-harness-reference.md` 各加「采纳复核」注记 —— 已采纳 / 可采纳（列入 next）/ 不采纳三分类

**M6-25 · 桌面形态发布工程（P5.1~P5.4，部分受阻）**（2026-09-09）：

- **Fixed（硬阻塞）**：`examples/desktop-tauri/src-tauri/build-server.mjs` 缺失，而 `tauri.conf.json` 的 `beforeBuildCommand` 指向它（打包必然失败）—— 补齐：esbuild bundle `examples/web/server.ts` → `binaries/agent-server.js`（ESM，附 `package.json` 声明 `type: module`，不依赖 Node 模块语法探测）、复制 `public/`、准备 sidecar `node-<target-triple>`（支持 `NODE_BIN` 交叉编译）；新增 `npm run build:sidecar` 与 esbuild devDependency；实测 bundle 启动后 `/healthz` 返回 200
- **P5.1（⏳ 部分）**：新增 `scripts/verify-desktop.mjs` 与 `npm run verify:desktop`（产物结构 / Resources 三件套 / `codesign -dv` / `spctl --assess` / dmg 挂载 / 可选 `--launch` 探活）；实跑结论：现有 `.app`/`.dmg` 是脚本缺失期间的旧产物，`Resources/` 缺 sidecar node 且未签名（`spctl` rejected），需重打并经 P5.2 签名后完成实机验收
- **P5.2（⏳ 待证书）**：`.github/workflows/desktop.yml` 接入 Apple 签名与公证环境变量（证书不入库）；README 补签名公证步骤与 `spctl` 验收命令
- **P5.3（⏳ 待首次 CI）**：新增三平台构建矩阵 workflow（macOS `.app`/`.dmg`、Linux `.AppImage`/`.deb`、Windows `.msi`/`.exe`；tag `v*` 或手动触发，上传 artifact + draft Release）；README 说明 sidecar 三元组与交叉编译 `NODE_BIN`
- **P5.4（可选门，待做）**：CI 侧 `TAURI_SIGNING_PRIVATE_KEY` 更新包签名已就位；Rust 侧 `tauri-plugin-updater` 接入、updater 配置与前端入口待下一步

**M6-24 · 生产存储基线与 Web 部署形态（P5.5 / P5.6）**（2026-09-09）：

- **P5.5 store-sqlite 生产基线**：schema 版本化（导出 `SCHEMA_VERSION` = 2，存于 `PRAGMA user_version`），`MIGRATIONS` 前向迁移幂等可重复（数据库版本高于程序支持时直接报错）；v2 新增表达式索引（session/task/run 查询路径 + 审计 `decidedAt` 排序），`listDocs` 把索引字段下推到 SQL（白名单字段 + 预编译语句缓存），其余走内存过滤；新增 `backup()`（`VACUUM INTO` 在线快照，拒绝覆盖）；开启 WAL 与 `synchronous=NORMAL`
- **测试**：新增 `packages/store-sqlite/test/sqlite-baseline.test.ts` —— 迁移可重复、v2 索引存在、索引与非索引字段组合过滤结果一致、1k 记录下按 run 查询 20 次 < 500ms、备份可恢复且拒绝覆盖
- **P5.6 Web 部署形态样例**：新增 `deploy/` —— 多阶段 `Dockerfile`（非 root + `HEALTHCHECK` 探 `/healthz`）、`docker-compose.yml`（含可选 nginx `edge` profile）、`systemd/node-agent-runtime.service`（最小权限）、`nginx/node-agent-runtime.conf`（SSE 必需的 `proxy_buffering off` 与放宽读超时）、`env/{dev,staging,prod}.env.example`、`README.md`（三种形态、环境分层表、备份恢复、生产检查清单）；控制台新增 `GET /healthz`（不经鉴权、不暴露运行时信息）；新增 `scripts/smoke-web.mjs` 与 `npm run smoke:web`（启动 → 轮询探活 → 关闭）
- **体积基线**：`@node-agent-runtime/store-sqlite` 4.6 → 7.1 kB（+56.3%，P5.5 新增迁移/索引/备份代码所致，已重新冻结）
- **Docs**：`docs/api-surface.md` 补 `SCHEMA_VERSION` 快照；`docs/m6-productionization.md` P5.5 / P5.6 勾选

**M6-23 · 治理文件与 README 生产用法（P6.1 / P6.2）**（2026-09-09）：

- **P6.1 治理文件**：新增 `CONTRIBUTING.md`（环境与 `npm run ci` 收口、仓库结构与包职责、分支 `main`/`dev`/`apps` 与 Conventional Commits、changeset 要求、质量门六项口径、API 面冻结与体积基线流程、PR 清单、维护者发版命令）与 `SECURITY.md`（支持版本、GitHub Security Advisories / 邮件私密渠道、响应目标、安全范围与排除项、生产部署安全默认值清单）
- **P6.2 README 生产用法**：新增 CI / Release / coverage / node / license badges；新增「安装（作为依赖消费）」节（包组合、Node `>=22.13`、core 与 types 的 peer 边界、产物自带 `.d.ts`、统一版本升级）；新增「生产用法（配置 · 观测 · 安全）」节（`loadConfig` 与环境变量表、结构化日志 / 稳定错误码 / 事件流观测、安全默认 `createProductionDefaults` 与 Web/MCP/审批加固点、维护者发布升级流程）；新增「参与贡献」入口（CONTRIBUTING / SECURITY / LICENSE）；修正"12 包均 private"的过期表述
- **Docs**：`docs/m6-productionization.md` P6.1 / P6.2 勾选

**M6-22 · SDK 发布工程（P4.1~P4.6，Gate 4）**（2026-09-08）：

- **P4.1 LICENSE**：新增根 `LICENSE`（MIT，Copyright (c) 2026 wangzhiyong）并分发至 12 个包；各包 `license: "MIT"`
- **P4.2 去 private + 发布元数据**：12 个包移除 `private`，补全 `publishConfig.access=public`、`sideEffects:false`、`author`、`repository`（含 `directory`）、`homepage`、`bugs`、`keywords`；`npm pack --dry-run` 产物为 dist + package.json + LICENSE
- **P4.3 engines 与打包决策**：全仓 `engines.node` 统一 `>=22.13.0`（随 `node:sqlite`），新增 `.nvmrc`（22.22.1）与根 `packageManager`（npm@10.9.4）；维持 ESM-only
- **P4.4 版本与发布编排**：引入 changesets（`.changeset/config.json`，12 包 `fixed` 统一版本）与 `changeset`/`version-packages`/`release` 脚本；新增 `.github/workflows/release.yml`（push main 走 changesets/action，tag `v*` 走 `npm publish --workspaces --provenance`）；首个 changeset 标记 0.2.0 → 0.3.0
- **P4.5 依赖策略**：内部互依统一 `^0.2.0`（`workspace:` 协议在当前 npm/arborist 下报 `EUNSUPPORTEDPROTOCOL`，改用版本对齐由 changesets 发版时 bump）；`@node-agent-runtime/core` 与 `@node-agent-runtime/types` 提为插件包 `peerDependencies`；新增 `types` `ProcessEnv`，使发布产物 `.d.ts` 不依赖消费者安装 `@types/node`
- **P4.6 包体积基线**：新增 `scripts/size-report.mjs`（`npm run size` / `size:update`）与 `scripts/size-baseline.json`，包体积增长 >+25% 阻断；纳入 `npm run ci`，报告写入 `coverage/size-report.txt`
- **Gate 4 验证**：12 包 `npm pack` → 全新项目安装 → 最小 demo 运行通过（输出 `= 14`）→ `tsc --noEmit` 在"含 / 不含 `@types/node`"两种场景均通过
- **Fixed**：`packages/types/test/limits.test.ts` 改从 `../src/types.js` 导入 `RunUsage`（原从 `limits.js` 导入未导出符号，阻断根 typecheck）；移除 `StorageApprovalStore` 未使用的 `now` 参数；新增 `packages/host/test/approval-store.test.ts`，host 行覆盖回到门禁线以上（92.25% 全仓均值）
- **Added**：`types` `ProcessEnv`（types 64 符号，API 面已重新冻结并补 `docs/api-surface.md` 快照）

### Added（M6-22）
- `packages/types/src/util.ts`：`ProcessEnv`
- `scripts/size-report.mjs`、`scripts/size-baseline.json`、`.changeset/`、`LICENSE`、`.nvmrc`、`.github/workflows/release.yml`

**M6-21 · P3 评审收尾：低危加固（L1 / L2 / L4 / L5）**（2026-09-08）：

- **Security（P3.2）**：`redact()` 深度上限由"放行原文"改为**整值脱敏**（`REDACT_DEPTH_LIMIT`），并用 `WeakSet` 显式拦截循环引用；公开签名不变
- **Security（P3.2）**：密钥识别增强 —— 键名支持 `x-`/`proxy-`/下划线等前缀（`x-api-key`、`proxy-authorization`）；值形态补充 `gh[pousr]_`、`github_pat_`、`xox[aboprs]-`、`AIza`、`glpat-` 厂商前缀，JWT 分支放宽结尾锚定
- **Security（P3.5）**：`decideAuth` 令牌比较改恒定时间（`crypto.timingSafeEqual`）；新增 `decideCsrf()` + `server.ts` 的 `csrfGuard`，无令牌部署下拦截无 `Origin` 且 `Sec-Fetch-Site: cross-site` 的写请求（curl/CLI 不受影响）
- **Fixed（P3.8）**：空串/空白 `OPENAI_API_KEY` 不再静默降级 mock，改抛 `ConfigError`；`provider=openai` 缺密钥同样抛 `ConfigError`
- **Added**：`examples/web/security.ts` `decideCsrf`
- **Docs**：`docs/p3-review.md` 更新为 8 项发现全部已修；`m6-productionization.md` P3.2/P3.5/P3.8 行补记
- **测试**：`log.test.ts` 增补深度上限/循环引用/前缀与厂商 token 形态；`config.test.ts` 增补空串 key 与 openai 缺 key；`security.test.ts` 增补 `decideCsrf` 六场景；全量 223 用例 0 失败

**M6-20 · P3 评审后安全加固（H1 / M1 / M2 / L3）**（2026-09-08）：

- **Security（P3.6）**：修复 MCP 白名单可被 30x 重定向绕过的 SSRF 缺口 —— `StreamableHttpTransport` 请求统一 `redirect: "manual"`，手动跟随且**每一跳重新校验**协议与白名单（跳数上限 3），`notify()` 同样拒绝跟随 3xx
- **Security（P3.6）**：`StdioTransport` 默认不再把宿主完整 `process.env` 交给 MCP 子进程，只透传最小集（`PATH`/`HOME`/`TMP*` 等）+ 显式 `env`（`config.mcp.serverEnv`）；新增 `inheritEnv?: boolean` 供可信 server 显式放开
- **Fixed（P3.4）**：`limits.maxSteps` 与循环上界解耦 —— 循环上界固定 `agent.maxSteps`，预算越界的那一步抛 `LimitExceededError` 并产 `run:error`（`code: limit_exceeded`），不再按"自然收敛"静默结束
- **Fixed（P3.5）**：CORS 预检（OPTIONS）改经 `decidePreflight()` 守卫，放行时回 `Access-Control-Allow-Origin/Methods/Headers` + `Vary`，白名单来源的非简单请求才真正可用
- **Added**：`examples/web/security.ts` `decidePreflight`、`PreflightResponse`
- **Docs**：新增 `docs/p3-review.md`（P3 全量评审：8 项发现，4 项已修，4 项低危待办）
- **测试**：`transport.test.ts` 增补重定向守卫（内网拒绝 / 白名单内跟随）与 stdio env 隔离；`runtime.test.ts` 增补 maxSteps 预算产 `run:error`；`security.test.ts` 增补预检用例；全量 217 用例 0 失败

**M6-19 · 收紧对外 API 面（P3.2 / P3.5 / P3.6）**（2026-09-08）：

- **P3.2 事件/日志脱敏**：`packages/core/src/log.ts` 新增 `redact()`（强密钥字段 + 类密钥值 sk-/JWT/base64 全量脱敏，普通参数原样保留）；`ConsoleLogger` 序列化前对 meta 脱敏；`AgentRuntime` 在 `tool:start`/`tool:end` 事件与日志中对工具参数脱敏，密钥永不进入事件流/日志
- **P3.5 Web/本地 server 鉴权与防跨站**：`examples/web/server.ts` 新增 `corsGuard`（仅放行环回/白名单 Origin，其余 403）、`authGuard`（`AGENT_API_TOKEN` 配置后要求 Bearer 令牌，默认开放）、`readBody`（请求体 256KB 上限）；demo 默认开放，生产部署应设令牌并由反代加固
- **P3.6 MCP 供应链防护**：`packages/mcp/src/transport.ts` 新增 `validateMcpServerUrl()`（仅 http/https + 可选白名单，防 SSRF），`StreamableHttpTransport` 构造即校验；`StdioTransport` 新增 `startTimeoutMs`（启动就绪/超时守卫，卡死子进程即 SIGKILL 并 reject）；examples 经 `AGENT_MCP_HTTP_ALLOWLIST` / `AGENT_MCP_STDIO_TIMEOUT_MS` 注入
- **API 面**：core 新增 `redact`（60 符号）；mcp 新增 `validateMcpServerUrl`（29 符号）
- **测试**：`packages/core/test/log.test.ts` 增补 redact 用例；新增 `packages/mcp/test/transport.test.ts`（SSRF 校验 + stdio 启动超时）
- **P3.3 审批审计 / 限额 / 白名单存储（随本次一并落库）**：`packages/types/src/audit.ts`（`ApprovalRecord`/`ApprovalStore`/`ToolGrant`/`ApprovalQuery`）、`packages/types/src/limits.ts`（`RunLimits`/`LimitViolation`/`checkRunLimits`）、`packages/host/src/approval-store.ts`（`StorageApprovalStore`）；`packages/policy/src/permission.ts` 审批审计 + always 白名单持久化、`packages/host/src/session.ts` 接线；测试 `packages/types/test/audit.test.ts`、`packages/types/test/limits.test.ts`、`packages/policy/test/permission.test.ts`

### Added（M6-19）
- `packages/core/src/log.ts`：`redact`
- `packages/mcp/src/transport.ts`：`validateMcpServerUrl`
- `packages/types/src/audit.ts`：`ApprovalRecord`、`ApprovalStore`、`ToolGrant`、`ApprovalQuery`
- `packages/types/src/limits.ts`：`RunLimits`、`LimitViolation`、`checkRunLimits`
- `packages/host/src/approval-store.ts`：`StorageApprovalStore`
- `examples/web/server.ts`：`corsGuard` / `authGuard` / `readBody`（demo 级，生产建议反代加固）

**M6-18 · 可观测 / 配置 / 默认安全（P3.1 / P3.7 / P3.8）**（2026-09-08）：

- **P3.1 结构化日志 + 错误码**：`packages/core/src/log.ts` 新增 `Logger` 接口与 `ConsoleLogger`、`toLogger`（兼容旧 `(line)=>void` 回调）、`errorPayload`（HTTP/CLI 稳定错误体 `{ error: { code, message } }`）；`packages/types/src/codes.ts` 新增 `ErrorCode` 枚举与 `errorInfo()` 归一化；为 `RunAbortedError`/`SandboxViolationError`/`SandboxTimeoutError`/`ModelRequestError`/`CheckpointMismatchError`/`ArtifactError`/`SessionError`/`ConfigError` 标注 `code`
- **P3.7 默认安全策略包**：`packages/policy/src/secure.ts` 新增 `PRODUCTION_MATRIX`（生产偏置：workspace-write 下 deny 网络读、credential 全域 deny、write/exec 走 ask）、`createProductionPolicy()`、`secureScope()`（禁网、仅工作区内可写）、`createProductionDefaults()`；`examples/cli.ts` 与 `examples/web/server.ts` 默认套用生产预设（开箱即最小权限 + 锁域）
- **P3.8 配置/特性模块**：`packages/core/src/config.ts` 新增 `loadConfig()`（分层：env > 默认；密钥仅经配置/环境注入，无散落 magic env 读取）、`RuntimeConfig`、`FeatureFlags`、`ConfigError`（非法配置报可读错误）；examples 经 `loadConfig` 解析 provider 凭证 / 日志级别 / 特性开关
- **API 面**：新增导出 `ErrorCode`/`ErrorInfo`/`errorInfo`（types）、`Logger`/`LogLevel`/`ConsoleLogger`/`toLogger`/`errorPayload`/`loadConfig`/`ConfigError`/`RuntimeConfig`/`FeatureFlags`/`LoadConfigOptions`（core）、`createProductionPolicy`/`secureScope`/`createProductionDefaults`/`PRODUCTION_MATRIX`（policy）；runtime 现通过 `AgentRuntimeOptions.logger` 注入 `Logger`
- **测试**：新增 `packages/core/test/log.test.ts`、`packages/core/test/config.test.ts`、`packages/policy/test/secure.test.ts`

### Added（M6-18）
- `packages/types/src/codes.ts`：`ErrorCode`、`ErrorInfo`、`errorInfo`
- `packages/core/src/log.ts`：`Logger`、`LogLevel`、`ConsoleLogger`、`toLogger`、`errorPayload`
- `packages/core/src/config.ts`：`loadConfig`、`ConfigError`、`RuntimeConfig`、`FeatureFlags`、`LoadConfigOptions`
- `packages/policy/src/secure.ts`：`PRODUCTION_MATRIX`、`createProductionPolicy`、`secureScope`、`createProductionDefaults`
- `scripts/api-surface.baseline.json`：刷新以纳入上述新增导出

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

- **P2.1 CI 主流程**：新增 `.github/workflows/ci.yml`，三个 job —— `quality`（typecheck → lint → test → build → `check:api`，Node 22.x）、`coverage`（仅出报告，不阻断）、`audit`（`npm audit --omit=dev --audit-level=high`）；matrix 暂固定 22.x（`@node-agent-runtime/store-sqlite` 依赖 `node:sqlite` ≥22.5，engines 统一待 P4.3）
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

- `README.md`：项目结构树改为 12 包依赖分层布局（含 `core/src/store/` 与真实源码文件，去掉拆包前旧树）；核心代码示例与会话示例导入源由 `./src/index.js` 改按包导入（`@node-agent-runtime/core` / `mock` / `tools-basic` / `provider-openai` / `host`）；概念表补包名；内置工具节注明源自 `@node-agent-runtime/tools-basic`；兼容注改为「core = facade 聚合出口，导出面以 api-surface + check:api 为准」
- `docs/crate-split-todo.md`：新增「归档注记」（12 包终局：artifact 独立拆包、checkpoint 归位 memory、§5 决策 C1/C4 修订）；§1 标注为历史快照；C3 状态格与 §6 文档同步项收尾勾选
- `docs/m6-productionization.md`：P1.6 改 12 包导出面、P1.1 追注 Artifact 独立成包、进度段加「12 包终局」追注
- `docs/development-checklist.md`：§0 M6 行与 P1/P2 行对齐 12 包终局，P2.7 ✅ 标注
- `docs/remaining-tasks.md`：头部决策状态、建议顺序/当前状态改为「已收口」；B2（C8 host）行改为已完成（C1 重评为「拆」）；§3 补决策修订注记
- `docs/crate-architecture.md`：头部状态刷新为 12 包终局；新增 **v0.11** 修订行（M6-9~12 自查整改闭环）；§3 Artifact 归属落定为独立包；§8 待决 2/4/5 补 `[已定]` 标注
- `examples/desktop-tauri/README.md`：「与拆包（C8 host）的关系」由未来态改写为现状（host 已拆且示例已接线）
- `docs/architecture.md`：§5.3 / §6.1 / §6.2 / §8.1 / §8.2 / §9 的 M2~M4 实现注记补「M6 已迁出至 `@node-agent-runtime/*`」追注（mcp / policy / sandbox / artifact / memory+checkpoint / host），避免按旧路径 `packages/core/src/*` 检索被误导
- `docs/m5-productization.md`：原则与 Desktop 明细中「未来若拆 C8 host」的未来态表述改为现状（host 已拆、示例已切子包导入）

**新增**：`docs/docmap-audit.md`（16 篇文档地图与一致性/缺失审计，含目录树、逐文档档案与交叉引用关系）。

**验收**：纯文档变更，无代码与公共 API 变化；`npm run typecheck` / `npm run check:api` 不受影响。

---

**M6-12 · 包元数据名实对齐**（2026-09-08，split 分支）：修正拆包（M6-9 / M6-10）后残留的过时描述——`@node-agent-runtime/memory` 的产物职责已归 `@node-agent-runtime/artifact`、`@node-agent-runtime/core` 已不含 session 与 provider 实现，两个包的 `description` 与 core facade 注释块同步至真实构成（memory = SessionMemory + Checkpoint/ToolSurface 契约；artifact 独立一行；core = 引擎 + 聚合出口）。
**验收**：纯描述/注释变更，无代码与公共 API 变化；`npm run typecheck` 绿，`npm run check:api` 0 差异。

### Changed（M6-12）
- `packages/memory/package.json`：description 去掉 ArtifactManager，改为 SessionMemory + checkpoint 设施，并注明产物归属 `@node-agent-runtime/artifact`
- `packages/core/package.json`：description 改为引擎真实构成（run loop / agent / context / EventBus / tool-model 契约 / 零依赖默认存储 / facade），去掉 session、providers
- `packages/core/src/index.ts`：facade 注释块对齐实际转发——memory 行改为 SessionMemory / Checkpoint（ToolSurface 契约），新增 `@node-agent-runtime/artifact` 独立行

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
**P2-a checkpoint 归位**：`checkpoint.ts` 解耦 `Agent` 类——新增结构化契约 `ToolSurface { name, tools }` 取代 `computeToolsHash(agent: Agent)` / `assertResumable(ckpt, agent)` 对引擎类的依赖（`Agent` 结构上兼容，现有调用点无需改写）；随后迁入 C3 `@node-agent-runtime/memory`，测试随迁。core 由 1146 → **1005 行**，且因 facade 转发 memory，**从 core 导入 Checkpoint 符号仍可用（非破坏性）**。
**P2-b 事件总线可注入**：`AgentRuntimeOptions.events?` 与 `SessionManagerOptions.events?` 支持宿主创建并注入 `EventBus`（默认仍自建/复用 runtime 总线）；host 内部统一改用 `this.events`，不再借用 `runtime.events` 内部构件。
**P2-c 快照复核脚本化**：⏸ 未实施，随 P2（工程护栏）的 CI 作业落地。
**验收**：`npm run typecheck` 绿；全仓 `npm test` 0 fail（types 4 / memory 19 / artifact 8 / sandbox 13 / policy 13 / core 21+1skip / tools-basic 2 / host 8 / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-10）
- `AgentRuntimeOptions.events` / `SessionManagerOptions.events` / `SessionManager.events`：宿主可注入并持有事件总线
- `@node-agent-runtime/memory`：`CheckpointStore` 等 9 个 Checkpoint 符号 + `ToolSurface` 契约

### Changed（M6-10）
- `packages/core/src/checkpoint.ts` → `packages/memory/src/checkpoint.ts`（解耦 `Agent` 后归位 C3）
- `packages/core/src/index.ts`：移除自身 Checkpoint 导出（改由 facade 转发 memory）
- `packages/host/src/session.ts`：11 处事件发布改用 `this.events`；Checkpoint 导入改从 memory

### Docs（M6-10）
- `docs/api-surface.md`：按 12 包重新冻结（memory 14 / core 49 + 5 转发 / core 1005 行）
- `docs/p1-review.md`：P2 项状态更新

---

**M6-9 · P1 审查整改（P0 + P1）**（2026-09-08，split 分支）：依据 `docs/p1-review.md` 执行架构整改，解决「core 过重」「为拆包而人为分层」两类问题。
**P0 演示资产外置**：`MockProvider` → 新包 `@node-agent-runtime/mock`；`builtinTools` / `calculator` / `CURRENCY_ALIASES` / `CurrencyCode` / `evaluate` → 新包 `@node-agent-runtime/tools-basic`；core 移除对应实现与导出（公共面 -5、**1804 → 1146 行，-36%**）。
**P1-a 工具分类下沉**：`classifyToolName` / `toolKind` 由 sandbox 下沉 C1（`types/src/tools.ts`，属工具元数据推断而非执行域），sandbox 以 re-export 保持 API 不变；`mcp` 因此去掉对 sandbox 的依赖（现只依赖 core + types）。
**P1-b 产物独立**：`artifact.ts` 从 memory 包拆出为 `@node-agent-runtime/artifact`（memory 导出由 13 → 5，一包一职责），host 与 core facade 同步接线。
**破坏性变更**：从 core 导入 `MockProvider` / `builtinTools` / `evaluate` / `CURRENCY_ALIASES` / `CurrencyCode` 失效（改从 `mock` / `tools-basic`）；从 `memory` 导入 `Artifact*` 失效（改从 `artifact`）。
**验收**：`npm run typecheck` 绿；全仓 `npm test` 0 fail（types 4 / memory 9 / artifact 8 / sandbox 13 / policy 13 / core 31+1skip / tools-basic 2 / host 8 / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-9 · 整改新包）
- `packages/mock/`：`@node-agent-runtime/mock`（MockProvider 演示/测试模型后端）
- `packages/tools-basic/`：`@node-agent-runtime/tools-basic`（builtinTools / evaluate / CURRENCY_ALIASES / CurrencyCode）
- `packages/artifact/`：`@node-agent-runtime/artifact`（ArtifactManager 产物管理，原属 memory）
- `packages/types/src/tools.ts`：`classifyToolName` / `toolKind`（由 sandbox 下沉）

### Changed（M6-9 · 整改接线）
- `packages/core`：`providers/`、`tools/` 目录移出（演示资产）；facade 增加 artifact 转发
- `packages/memory`：仅保留会话记忆（剥离产物）
- `packages/mcp`：去掉 `@node-agent-runtime/sandbox` 依赖
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

**M6-7 · 拆包批次 B2（C8 host）**（2026-09-07，split 分支）：**修订 C1 决策**——原判定「不拆 host」的前提（memory/permission/artifact/sandbox 在 core 内与 session 互引）已随 B3/B4 消失，实测 core 内**无任何模块依赖 `session.ts`**，故恢复 C8：`session.ts`(721 行) + `session.test.ts` 外置为 `@node-agent-runtime/host`（`packages/host/`），依赖方向 **host → {core, memory, sandbox, policy, types}**，单向无环；`core/src/index.ts` 移除 Session/Task 导出（host → core，core 不可反向 re-export，与 mcp 同理）。**破坏性变更**：`import { SessionManager } from "@node-agent-runtime/core"` 失效，宿主需改从 `@node-agent-runtime/host` 导入——当前 0.x 且全部包 `private`（无外部消费者），为成本最低窗口。引用点已更新：`examples/cli.ts`、`examples/web/server.ts`、core/memory/mcp/sandbox 四处测试。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 33+1skip / **host 8** / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）；`examples/` 与四处测试的导入已全部切换到新包（运行时冒烟随 M6 P2 的自动化 E2E 覆盖）。

### Added（M6-7 · 拆包 B2）
- `packages/host/`：C8 `@node-agent-runtime/host`（`SessionManager` / `SessionError` 与 Session/Task/Run 类型）

### Changed（M6-7 · 拆包 B2 接线）
- `packages/core/src/index.ts`：移除 Session/Task 导出段（改指引注释）
- `examples/cli.ts` / `examples/web/server.ts`：`SessionManager` / `Session` 改从 `@node-agent-runtime/host` 导入
- `packages/{core,memory,mcp,sandbox}/test/*.test.ts`：`SessionManager` 改从 host 导入
- 根 `package.json` / `tsconfig.json`：build/test 与 paths 接入 host（序 …→core→host→mcp→…）
- `README.md`：会话管理示例与包结构同步

### Docs（M6-7）
- `docs/remaining-tasks.md`：C1 决策修订为「拆 host」，B2 恢复并完成
- `docs/crate-split-todo.md`、`docs/crate-architecture.md`：C8 状态与修订记录

---

**M6-6 · 拆包批次 B4（core facade 收窄）**（2026-09-07，split 分支）：`core/src/index.ts` 由各模块直出改为 **facade 聚合出口**——统一 `export *` 转发 C3 `@node-agent-runtime/memory`、C4 `@node-agent-runtime/sandbox`、C5 `@node-agent-runtime/policy`（**C6 mcp 不在此列**：其依赖方向为 mcp → core，反向 re-export 会形成循环，仍需 `import { McpRegistry } from "@node-agent-runtime/mcp"`）。宿主既可继续从 `@node-agent-runtime/core` 单点导入（兼容面不变），也可按需直连子包（推荐新代码）。`checkpoint.ts` 经评估仍留 core：`computeToolsHash` / `assertResumable` 依赖 core 的 `Agent` 类。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 41+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Changed（M6-6 · facade 收窄）
- `packages/core/src/index.ts`：新增 facade re-export 块（`export *` 转发 memory / sandbox / policy），移除原 memory/artifact/governance 指引注释

### Docs（M6-6）
- `docs/remaining-tasks.md`：B4 完成；checkpoint 留 core 原因更新为「依赖 `Agent` 类」
- `docs/crate-split-todo.md`：facade 行勾选完成
- `docs/crate-architecture.md`：修订记录 v0.9

---

**M6-5 · 拆包批次 B3（C4 sandbox + C5 policy）**（2026-09-07，split 分支）：`sandbox.ts` 外置为 `@node-agent-runtime/sandbox`、`permission.ts` 外置为 `@node-agent-runtime/policy`（C2 决策：独立两包），两个测试随迁。本批**触发 C4 决策的「出现循环即下沉」条件**：把工具契约（`ToolDefinition`/`AnyTool`/`ToolKind`/`ToolMeta`/`ToolExecutionContext`）与事件契约（`RuntimeEvent` 及全部事件接口）下沉 C1（新增 `packages/types/src/tools.ts` / `events.ts`）；core 对应文件改为「re-export 类型 + 保留实现」（`defineTool` / `EventBus` 仍在 core，core 内部与公共导入面不变）；`permission.ts` 对 `EventBus<RuntimeEvent>` 的依赖改为 C1 新增的 `EventEmitter<E>` 结构接口，避免 policy 反向依赖 core；`mcp` 的 `classifyToolName` 改由 `@node-agent-runtime/sandbox` 提供。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / sandbox 13 / policy 13 / core 41+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-5 · 拆包 B3）
- `packages/sandbox/`：C4 `@node-agent-runtime/sandbox`（`LocalSandbox` + `classifyToolName`/`toolKind`/`isPathAllowed`/`simpleDiff` 与 Sandbox 契约类型）
- `packages/policy/`：C5 `@node-agent-runtime/policy`（`PermissionManager` + `DefaultPermissionPolicy`/`StaticPolicy`/`combinePolicies`/`toolListPolicy`）
- `packages/types/src/tools.ts` / `events.ts`：工具契约与事件契约下沉 C1（含新增 `EventEmitter<E>` 最小发射接口）

### Changed（M6-5 · 拆包 B3 接线）
- `packages/core/src/tool.ts` / `events.ts`：类型改为从 C1 re-export，实现保留
- `packages/core/src/session.ts`：`LocalSandbox` / `PermissionManager` 改从新包导入
- `packages/core/src/index.ts`：移除治理实现导出，保留指引注释
- `packages/mcp/`：`classifyToolName` 改依赖 `@node-agent-runtime/sandbox`
- 根 `package.json` / `tsconfig.json`：build/test 与 paths 接入两个新包（序 types→memory→sandbox→policy→core→mcp→provider-openai→store-sqlite）

---

**M6-4 · 拆包批次 B3（C3 memory + artifact）**（2026-09-07，split 分支）：`memory.ts` + `artifact.ts` 外置为 `@node-agent-runtime/memory`（`packages/memory/`，仅依赖 types），`memory.test.ts` / `artifact.test.ts` 随迁；按 C3 决策把 `Artifact` / `ArtifactKind` / `ArtifactInput` 契约类型下沉 C1（新增 `packages/types/src/artifacts.ts`）；`session.ts` 改从新包导入，core `index.ts` 移除 memory/artifact 实现导出（类型经顶部 `export *` 转发，公共导入面不变）。**`checkpoint.ts` 暂留 core**：`computeToolsHash` / `assertResumable` 依赖 `Agent` 与工具契约（C4 决策未下沉），外置会形成 core ↔ C3 包级循环，待契约下沉或 B4 facade 收窄时再迁。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / memory 17 / core 67+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-4 · 拆包 B3）
- `packages/memory/`：新增 C3 `@node-agent-runtime/memory` 包（package.json / tsconfig.json / `src/index.ts`），承载 `SessionMemory` 与 `ArtifactManager`；依赖仅 @node-agent-runtime/types
- `packages/types/src/artifacts.ts`：`Artifact` / `ArtifactKind` / `ArtifactInput` 契约类型（C3 决策下沉）

### Changed（M6-4 · 拆包 B3 接线）
- `packages/core/src/session.ts`：`SessionMemory` / `Memory` / `ArtifactManager` / `Artifact` 改从 `@node-agent-runtime/memory` 导入
- `packages/core/src/index.ts`：移除 memory / artifact 实现导出，保留指引注释（类型面不变）
- 根 `package.json` / `tsconfig.json`：build/test 与 paths 接入 `@node-agent-runtime/memory`（build 序 types→memory→core→mcp→provider-openai→store-sqlite）

### Docs（M6-4）
- `docs/remaining-tasks.md`：B3 完成 + checkpoint 留 core 说明
- `docs/crate-architecture.md`：修订记录 v0.7

---

**M6-3 · Storage 契约下沉 C1（拆包 B3 前置）**（2026-09-07，split 分支）：把 `Storage` / `DocDomain` / `StreamDomain` 契约从 `core/src/store/types.ts` 下沉至 `@node-agent-runtime/types`（新增 `packages/types/src/storage.ts` 并由 index 导出），删除 core 内契约文件；core 内 6 处引用（`session` / `memory` / `checkpoint` / `artifact` / `store/memory` / `store/file`）改为从 types 导入，`core/src/index.ts` 经 `export * from "@node-agent-runtime/types"` 转发，**公共导入面不变**。目的：让 C3（memory/artifact）等外置包只依赖 types，消除 core ↔ 子包循环（C1/C3 决策的落地手段）。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / core 84+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-3 · 契约下沉）
- `packages/types/src/storage.ts`：`Storage` / `DocDomain` / `StreamDomain` 契约（原 `core/src/store/types.ts`，零依赖纯类型），`types/index.ts` 已导出

### Changed（M6-3 · 契约下沉接线）
- `packages/core/src/{session,memory,checkpoint,artifact}.ts` 与 `store/{memory,file}.ts`：Storage 契约改从 `@node-agent-runtime/types` 导入
- `packages/core/src/index.ts`：移除本地 Storage 导出（改由 `export * from "@node-agent-runtime/types"` 转发）
- `packages/core/src/store/types.ts`：删除（契约已下沉 C1）

---

**M6-2 · 决策落定 + 拆包批次 B1（C6 mcp）**（2026-09-07，split 分支）：落定 `remaining-tasks` C1~C4 四项开放决策——**C1** 不拆 C8 host（Session/Task 留 core，改以「Storage 契约下沉 C1」消除 core↔子包循环，B2 移出 M6）；**C2** sandbox/policy 独立两包（C4/C5，不合成 governance）；**C3** `Artifact` 类型下沉 C1、实现并入 C3（memory 包）；**C4** 工具契约 M6 暂不下沉（外置包依赖 core 的 `defineTool`/`ToolDefinition`）。据此执行批次 B1：`core/src/mcp/`（client/jsonrpc/registry/transport/types）与 `mcp.test.ts` + `fixtures/mock-mcp-server.mjs` 迁为 `packages/mcp/`（`@node-agent-runtime/mcp`），`registry.ts` 改从 core 取 `defineTool`/`classifyToolName`，core `index.ts` 移除 mcp 导出（避免 core↔mcp 循环），根 tsconfig paths / build / test 与 `examples/cli.ts` 接线。验收：`npm run typecheck` 绿，全仓 `npm test` 0 fail（types 4 / core 84+1skip / mcp 15 / provider-openai 8 / store-sqlite 14+2skip）。

### Added（M6-2 · 拆包 B1）
- `packages/mcp/`：新增 C6 `@node-agent-runtime/mcp` 包（package.json / tsconfig.json / `src/index.ts`），承载 MCP client、JSON-RPC、stdio+streamable HTTP 传输与 `McpRegistry` 物化；依赖 core 工具契约，方向单向

### Changed（M6-2 · 拆包 B1 接线）
- `packages/core/src/index.ts`：移除 MCP adapter 导出段（改由 `@node-agent-runtime/mcp` 提供），避免 core↔mcp 循环
- `examples/cli.ts`：`McpClient`/`McpRegistry`/`StdioTransport`/`StreamableHttpTransport`/`McpServerHandle` 改从 `@node-agent-runtime/mcp` 导入
- 根 `package.json` / `tsconfig.json`：`build`/`test` 脚本与 paths 接入 `@node-agent-runtime/mcp`（build 序 types→core→mcp→provider-openai→store-sqlite）

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

- **C7 `@node-agent-runtime/provider-openai`**（`packages/provider-openai/`）：`OpenAIClientProvider`/`OpenAIClientOptions` 从 core 迁出（`packages/core/src/providers/openai-compatible.ts` 删除），core `providers/` 仅留 `MockProvider`；`examples/cli.ts`、`examples/web/server.ts` 改用新包导入
- **C9 `@node-agent-runtime/store-sqlite`**（`packages/store-sqlite/`）：`SQLiteStorage`（`node:sqlite` `DatabaseSync`，docs/blobs/streams 三表）按 `Storage` trait 实现，作为可选存储后端（`engines: node >=22.13.0`）

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

**M1 · 生命周期 + C1/C2 workspace 收敛**（正式发布，dev 合并 main，commit `06edd1a`）：M1 完成 Session/Task/Run 实体化、统一持久化层与运行时上下文注入；在此基础上把代码收敛为 npm workspaces monorepo（C1 `@node-agent-runtime/types` 叶子包 + C2 `@node-agent-runtime/core` 引擎包）。`npm test` 35 通过 0 失败。

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
- **C1/C2 收敛为 npm workspaces monorepo**（v0.2-with-workspaces，2026-09-05）：根包改 workspace 容器（`workspaces: ["packages/*"]`），按 `docs/crate-architecture.md` §7.1 方案 A 拆分——契约层（`schema/types/util`）入 C1 叶子包 `@node-agent-runtime/types`（零依赖），引擎实现（runtime/agent/context/events/session/tool/provider/tools/providers/store）入 C2 `@node-agent-runtime/core`（显式依赖 C1）；`packages/core/src/index.ts` 顶部 `export * from "@node-agent-runtime/types"` 保持公共 API 兼容；`examples` 与各包测试改为从包名导入；测试随包迁移（schema→types/test，runtime/session/store/calculator→core/test）；删除旧根 `test/`、`src/`、`tsconfig.examples.json`；`npm run typecheck` / `npm run build` / `npm test`（types 4 + core 31，1 有意 skip）全绿

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
