# 产品落地路径评估（参照 6 个同类产品）

> 记录时间：2026-09-10
> 定位：**评估文档**。回答「用现有底座的哪个子集、以什么产品形态、需要补什么，才能做出一个完整产品」。
> 性质：**待拍板**。本文不单方面改变现有口径；与 `docs/base-convergence.md` §2.4（应用层出局）的冲突范围与解法见 §7。
> 修订：v2（2026-09-10）补入 DeepChat / MonkeyCode / CodeBuddy 三个参照物，并新增 **ACP 路径**（§2、§5-D）；v2 的结论相比 v1 有实质变化。
> **追注（2026-09-17，桌面端资产出库）**：本文评估对象之一的**桌面端实现已从本仓库删除**（`examples/desktop-tauri/`、`.github/workflows/desktop.yml`、`scripts/verify-desktop.mjs`、`scripts/e2e/desktop.mjs`，提交 `6cf5ebf`）。本文作为**产品侧形态评估**继续有效（评估的是方向与成本，不是本仓库资产清单）；但文中「现有桌面壳代码 / P5 脚本可直接复用」一类表述自本日起**指已删除的历史实现**，产品侧承接需从 git 历史 `6cf5ebf^` 取回。

---

## 0. 结论（先给答案）

| 项 | 结论 |
|---|---|
| **能不能做** | 能做，且底座复用率很高；但**不是"接线"就能出产品**——缺的是工具面与交互面，不是引擎 |
| **最短路径（v2 新增）** | **做 ACP Agent Server，接入已存在的壳**（DeepChat / Zed / JetBrains）：一次适配，白得桌面与编辑器形态 |
| **v1 推荐路径（保留）** | **opencode 型终端编码 Agent**：`tools-code`（编码工具集）+ 流式输出 + 独立仓库的 CLI |
| **必须先补的两个底座件** | ① 编码工具集（当前为 0）② 流式输出（provider 硬编码 `stream: false`） |
| **明确不建议** | AionUi 型自建桌面壳（成本最高且可被 §5-D 替代）；Codex / MonkeyCode 型云端编码平台（需云沙箱与基础设施，非单人可做）。注：桌面端已自底座移出至产品侧（`base-convergence.md` §2.3），是否自建壳**属产品侧决策**，不再是底座口径问题 |
| **反直觉的一点** | 六个参照物的**差异化都不在引擎**；引擎级功能（审批/沙箱/续跑）在同款产品里是"已解决的问题"。要赢只能把**治理做成产品卖点**（见 §6） |

---

## 1. 六个参照物 → 四种原型

| 原型 | 代表 | 引擎归属 | 接入方式 | 对底座的需求 |
|---|---|---|---|---|
| **A. 桌面聚合壳** | **AionUi**、**DeepChat** | 无引擎 / 外接 | 识别本地已装 CLI（AionUi）· **ACP / MCP 接入外部 Runtime**（DeepChat） | **强**：需要一个"可被接入的 Agent"（CLI 或 ACP Server） |
| **B. 终端编码 Agent** | **opencode**、Codex CLI | 自有 | — | tools-code + 流式 + TUI |
| **C. 云端编码平台** | **MonkeyCode**、Codex Cloud | 自有 | 浏览器 | **云沙箱** + 任务队列 + Git 机器人 + 团队 |
| **D. IDE / 商业多形态** | **CodeBuddy** | 自有 | 插件 · IDE · CLI 三形态 | LSP / 项目上下文 + 分发渠道 |

**逐原型解读**：

- **原型 A（最关键）**：AionUi 不含引擎，靠自动识别本地已安装的 Claude Code / Codex / Gemini CLI / Qwen Code / **opencode** 驱动它们；DeepChat 是本地优先的桌面 Agent 客户端，**内置 ACP 支持，明确用于"把外部 Agent Runtime 以原生体验接入"**。两者共同证明：**分发渠道已经存在且是开放的**——"做出一个完整产品"的最短路径不是造壳，而是**成为这些壳的默认引擎**。
- **原型 B**：工具面与 TUI 体感的正面战场；TUI 需第三方库，天然不能进零依赖的 12 包。
- **原型 C**：MonkeyCode 印证了"云端沙箱 + 每任务一台真实服务器 + Git 机器人"的形态可行，但它吃的是**基础设施与协作**，`LocalSandbox` 在这里复用不了（需要云沙箱）——**阻断项最重**。
- **原型 D**：CodeBuddy 以"插件 + IDE + CLI 三形态共用一套能力"的矩阵出现，印证了**多形态共用同一引擎**的架构选择；其护城河是渠道与自研模型成本，不是可复制的技术形态。

---

## 2. 关键发现：ACP 的能力面与底座治理原语几乎同构

**ACP（Agent Client Protocol）**：JSON-RPC 2.0，"**AI 代理版的 LSP**"，定义编辑器/客户端（Client）与编码 Agent（Server）之间的标准，关联方含 Zed Industries、JetBrains、GitHub。

### 2.1 映射表（ACP ↔ 本运行时）

| ACP 方法 | 提供方 | 本运行时对应物 | 同构度 |
|---|---|---|---|
| `initialize`（版本与能力协商） | Agent | `Agent` 装配 + 能力声明（新增，薄） | — |
| `session/new` / `session/load` | Agent | `SessionManager.createSession` / `resume(ckptId)` | **高** |
| `session/prompt` | Agent | `SessionManager.chat()` | **高** |
| `session/cancel`（通知） | Agent | `RunOptions.signal`（AbortSignal） | **高** |
| `session/update`（消息块 / 工具调用 / 计划 / 模式变更） | Agent → Client | `EventBus` 事件流（`model:response` · `tool:start` · `tool:end` · `step:start`） | **高**：事件流即 `session/update` 的载荷 |
| `session/set_mode` | Agent | `SandboxMode` 三档（read-only / workspace-write / full-access） | **极高，几乎同名同义** |
| `session/request_permission` | Client | `PermissionManager.gate/approve/deny` + `DefaultPermissionPolicy` | **极高** |
| `fs/read_text_file` / `fs/write_text_file` | **Client** | 由宿主提供 → 对应 `ToolKind=read/write` 的工具 | 角色相反 |
| `terminal/*`（create / output / wait_for_exit / kill / release） | **Client** | 由宿主提供 → 对应 `ToolKind=exec` 的 bash 工具 | 角色相反 |
| `authenticate` | Agent | `loadConfig()` 的密钥分层 | 高 |
| `_meta` / `_` 前缀自定义方法 | 扩展 | 可挂审计导出等能力 | — |

### 2.2 三个推论

1. **ACP 适配包是"底座件"**：协议翻译、无产品概念、零依赖、可测试可发布 → **满足 `base-convergence.md` §2.1 的四条判定**，可立项而不触碰 §2.4 的"应用层出局"——**无需拍板改口径即可走通**。
2. **ACP 模式下 `fs` / `terminal` 由 Client 提供**，Agent 只需调用：这意味着 G1（编码工具集）**不是 ACP 路径的前置条件**，G3（交互层）**完全免做**。原本 v1 认定的两个最大成本项，在这条路径上几乎归零。
3. **ACP 只定义了"能请求权限"，没有定义**：审计留痕与参数指纹、步级快照与指纹校验续跑、三档沙箱的强制语义、密钥脱敏。**空白处正是你的资产**——既可在 `_meta` 上做扩展，也可作为产品叙事。

### 2.3 不确定项（需核对）

- ACP 的**传输方式**章节未细读（stdio 为主流的可能性高，与已有 `McpClient` 的 stdio 传输同构，成本因此很低）——落地前需核对。
- ~~`session/update` 是否要求 token 级分块（若是，则 §4 的 G2 流式是 ACP 落地的**前置**而非升级项）~~ → **已核对（2026-09-17，见 `docs/acp-spec-review.md` §4）：不要求**。Prompt Turn 全篇措辞为 MAY，唯一 MUST 是 turn 结束时须以 `stopReason` 响应 `session/prompt`，故**只发一条完整 `agent_message_chunk` 即合规** —— 流式是体验增强，**不是 ACP 落地的前置**。

---

## 3. 底座已有的（可被产品直接复用）

| 能力 | 代码位置 | 对产品的意义 |
|---|---|---|
| ReAct 事件循环 + `Agent` + `AgentRuntime` | `packages/core/src/runtime.ts` | 引擎地基，产品无需重写 |
| Session → Task → Run 生命周期 + `chat()` | `packages/host/src/session.ts` | 直接映射 `session/new` · `session/prompt` |
| Checkpoint 步级快照 + `resume` 工具指纹校验 | `packages/memory` + `host/session.ts` | 映射 `session/load`；**ACP 未定义，属差异化** |
| 审批决策 allow/deny/ask + `always` 白名单 | `packages/policy` | 直接映射 `session/request_permission` |
| **审批审计落库（只存参数指纹，不存原文）** | `packages/host/src/approval-store.ts` | 差异化能力；ACP / opencode 均无等价物 |
| 沙箱三档 + 声明域 + 禁网 + 每调用超时 | `packages/sandbox/src/sandbox.ts` | 直接映射 `session/set_mode` |
| `sandbox:write` 事件（含行级 diff） | `sandbox.ts` `onWrite` → `session.ts` 发事件 | **diff 已由沙箱算好**，写工具无需自己实现 |
| MCP client（stdio / HTTP） | `packages/mcp` | 工具生态；**其 JSON-RPC + stdio 传输可直接复用于 ACP** |
| Artifact 管理 | `packages/artifact` | 产物面板（原型 A 界面的核心组件） |
| Storage（Memory/File/SQLite） | `core/src/store` + `store-sqlite` | 会话持久化后端可选 |
| 配置 / 日志 / 脱敏 / 限额 / 错误码 | `core`（`loadConfig`·`redact`·`RunLimits`·`ErrorCode`） | 生产化基础，同款产品往往后补 |
| AbortSignal 中断 | `RunOptions.signal` | 映射 `session/cancel` |

> 判断：**治理链路（审批 → 沙箱 → 审计 → 续跑）是完整闭环且已测试**；且它与 ACP 的对应关系是**结构性对齐**，不是勉强映射。

---

## 4. 缺口清单（决定工作量）

| # | 缺口 | 现状证据 | 是否动底座 | 量级 |
|---|---|---|---|---|
| G1 | **编码工具集为 0** | `packages/tools-basic/src/builtin.ts` 只有 calculator / now / geocode / weather / exchange | 是（新包 `tools-code`） | 中；**ACP 路径下非必需**（Client 提供 fs/terminal） |
| G2 | **无流式输出** | `provider-openai/src/openai-compatible.ts:136` 硬编码 `stream: false`；`ModelProvider.chat()` 一次性返回 | 是（契约扩展 + SSE 解析 + `message:delta`） | 中（200~300 行，**属 API 变更**，需 changeset minor + 更新 `api-surface.md`） |
| G3 | **无交互层** | `examples/cli.ts` 是 readline 文本；`desktop-tauri` 已移出至产品侧（底座侧不维护） | 否 | 大；**ACP 路径下免做** |
| G4 | 单 provider 适配 | 仅 `provider-openai`（OpenAI 兼容） | 是（新包，可后置） | 小-中 |
| G5 | 无项目上下文注入 | 无 AGENTS.md 加载、无 .gitignore 感知文件树、无 LSP | 部分 | 中 |
| G6 | 无分发入口 | 根 `package.json` 为 `"private": true`，无 `bin` | 否 | 小 |
| G7 | 成本视图 / 上下文压缩未做 | `costUsd` 是宿主钩子；M7-1 未实施 | 是（M7-1） | 中 |
| G8 | 无 server/client 双端 | 仅 `examples/web/server.ts`（SSE 演示） | 否 | 中 |
| **G9** | **无 ACP 适配** | 全仓无 ACP 相关实现 | **是**（新包 `@node-agent-runtime/acp`） | 小-中（**可复用 `packages/mcp` 的 JSON-RPC 与 stdio 传输**） |

**排序变化（v2）**：v1 认为 G1/G2 是必经之路；v2 修正为——**G9（ACP）成本最低且收益最大**，可在无 G1、无 G3 的情况下先跑通产品形态；G2 决定体验上限（是否为前置取决于 §2.3）。

---

## 5. 四条路径评估

| 路径 | 参照物 | 需新建 | 复用底座 | 阻断项 | 单人可行性 |
|---|---|---|---|---|---|
| **D. ACP Agent Server**（v2 推荐） | DeepChat / Zed / JetBrains | `@node-agent-runtime/acp`（协议包） | `mcp` 的 JSON-RPC + stdio；host/policy/sandbox/memory 全用上 | 传输方式与分块要求待核对 | **最高** |
| **A. 终端编码 Agent** | opencode / Codex CLI | `tools-code` + 流式 + CLI 仓库 | 同上 | 无外部凭证 | 高 |
| **B. 自建桌面/Web 工作台** | AionUi | 前端 + 复用 `desktop-tauri`（2026-09-10 已移出至产品侧）+ 签名更新 | 同上 + Artifact 面板 | **Apple 证书（P5.1~P5.4 随桌面端移出，需产品侧重新立项）** | 低（且被路径 D 替代） |
| **C. 云端编码平台** | MonkeyCode / Codex Cloud | 云沙箱、任务队列、Git 机器人、团队与计费 | 引擎与治理链 | 基础设施 + 运维 + 合规 | **最低**（非单人项目） |

- **路径 D（推荐）**：一次协议适配，**白得** DeepChat 的桌面形态、Zed / JetBrains 的编辑器形态；不需要 TUI、不需要桌面壳、不需要证书、不需要 npm bin，**且不触碰 §2.4 口径**。代价是"你的产品穿在别人的壳里"——品牌与用户关系不在自己手上。
- **路径 A**：自持分发与品牌，npm 即可；治理差异化在终端里直接可见（审批提示、`sandbox:write` diff、`/resume`）。**与 D 不冲突**：一个全局 CLI 还能被 AionUi 自动识别。
- **路径 B**：视觉冲击力最强，但成本最高且与单人产能冲突；其收益（桌面形态）**已被路径 D 以极低成本覆盖**。
- **路径 C**：`LocalSandbox` 无法承载"每任务一台真实服务器"的形态；属于另起一个产品 + 一支团队。

---

## 6. 顺风点：写类工具**自动获得治理**（真正的差异化）

新增 `tools-code` 的 `write_file` / `edit_file`，或在 ACP 模式下调用 Client 的 `fs/write_text_file` 时，**不需要自己实现审批、权限、diff、审计**，因为链路已经闭合：

```
工具调用 → policy 决策(ask/deny) → 宿主/客户端审批 → Sandbox 模式与声明域校验
        → 执行 → sandbox:write 事件（含行级 diff，由 LocalSandbox 计算）
        → 审计落库（只存参数指纹）
```

证据：`packages/sandbox/src/sandbox.ts` 的 `onWrite` 回调计算 `paths` 与 `diff`，`packages/host/src/session.ts` 将其发布为 `sandbox:write`；`BLOCKED_IN_READ_ONLY` 已覆盖 `write`/`exec`/`credential` 三类 `ToolKind`。

**含义**：opencode / Codex / AionUi 接入的各类 CLI 里需要单独实现的 permission + diff + 沙箱三段，在这里是**加一个工具就自带**。ACP 恰好只规定了"能请求权限"，**没规定审计与强制语义**——这正是可以在壳内做深而不被替代的位置。

---

## 7. 与现有口径的冲突范围（v2：显著收窄）

| 路径 | 是否冲突 `base-convergence.md` §2.4 | 说明 |
|---|---|---|
| **D（ACP 适配包）** | **不冲突** | 协议翻译包，满足 §2.1 四条判定（有第三方消费者、零依赖、可测试可发布、不含产品概念） |
| A（`tools-code` + 流式） | **不冲突** | 均为底座包；但"CLI 产品壳"属应用层，需放独立仓库 |
| B（自建桌面壳） | **不冲突** | 桌面端已自底座移出至产品侧（§2.3），形态取舍不再由底座口径裁定，属产品侧决策 |
| B'（底座侧自建 Web 工作台） | **冲突** | 若作为底座侧形态演进需修订 §2.4；放产品侧独立仓库则与底座无冲突 |
| C（云端平台） | **冲突** | 应用层 + 基础设施 |

**安放方式**：
1. **G9 / G1 / G2 按底座立项**（`acp`、`tools-code`、流式契约扩展）——均可测试、可发布、不含产品概念。
2. **产品壳（若有）放独立仓库**：CLI bin、TUI、桌面/Web 界面、密钥托管一律不进 `packages/*`；TUI 需第三方库，天然违反零依赖纪律，正好由纪律自动隔离。桌面端已归产品侧（`base-convergence.md` §2.3），其界面与打包链由产品侧维护。
3. **口径改动只在选 C / B' 时需要显式拍板**——选 D（ACP）、A（底座包）与 B（桌面壳，已归产品侧）均无需修订既有口径。

---

## 8. 建议的第一批执行项

| 优先 | 项 | 归属 | 验收口径 |
|---|---|---|---|
| **P0** | `@node-agent-runtime/acp`：`initialize` / `session/new` / `session/prompt` / `session/cancel` + `session/update` 事件翻译 | 底座（新包） | 在 DeepChat（或任一 ACP Client）中完成一次多步会话；工具调用与审批在壳内原生呈现 |
| **P0** | ACP 权限桥接：`session/request_permission` ↔ `PermissionManager`，`session/set_mode` ↔ `SandboxMode` | 底座（新包） | 写操作在壳内弹出授权；拒绝后模型自纠；模式切换真实改变沙箱行为 |
| **P1** | 流式：`ModelProvider` 可选 `chatStream()` + SSE 解析 + `message:delta` | 底座（core / provider-openai） | 增量事件拼接结果与 `model:response` 文本一致；不支持流式的 provider 自动回退 |
| **P1** | `@node-agent-runtime/tools-code`：`read_file` / `write_file` / `edit_file` / `list_dir` / `glob` / `grep` / `bash` | 底座（新包） | 路径必须在 Sandbox 声明域内；write 触发 `sandbox:write` 且 diff 正确；`bash` 超时终止并回填错误 |
| **P2** | CLI 产品壳（独立仓库）：bin + 会话/审批/续跑/diff 展示 | 产品层 | 5 分钟内 `npx` 跑通一次带审批的改码任务；可被 AionUi 自动识别 |

> 顺序理由：P0 两项目标是**最快拿到一个可被真实产品承载的形态**（复用已有分发渠道，零壳成本）；P1 决定体验上限与自持能力；P2 才涉及品牌与自持分发。

---

## 9. 待决策项（**已拍板 · 2026-09-17**）

1. **是否先走路径 D（ACP）**：接受"产品穿在别人壳里"，换取最低成本与最快验证；还是坚持先建自持壳（路径 B/A）？
2. **`tools-code` 的优先级**：ACP 模式下可延后（Client 提供 fs/terminal）；但若同时要 CLI 自持形态，则需并行。
3. **流式是否为 ACP 前置**：取决于 §2.3 待核对项——`session/update` 是否要求 token 级分块。
4. **命名与打包**：若做 `tools-code`，是"编码工具"通用包，还是编码 Agent 专用？
5. **差异化表述**：是否以"治理"（审批 + 三档沙箱 + 审计 + 续跑）作为主叙事，而非"又一个编码 Agent"？

**拍板结论（2026-09-17，按本文推荐值落定）**：

| # | 决策 | 结论 |
|---|---|---|
| 1 | 是否先走路径 D（ACP） | **是，先走 D** —— 接受「产品穿在别人壳里」，换取最低成本与最快验证；**不自建壳**（CLI 产品壳属产品层，放独立仓库，本仓不做） |
| 2 | `tools-code` 的优先级 | **延后至 P2** —— ACP 模式下 Client 提供 fs/terminal；若后续要 CLI 自持形态再并行 |
| 3 | 流式是否为 ACP 前置 | **已核对：否** —— `session/update` 不要求 token 级分块（MAY，非 MUST），故**流式维持 P1 / 第二批，不阻塞 ACP 包**；详见 `docs/acp-spec-review.md` §4 |
| 4 | 命名与打包 | 若做 `tools-code`，按**通用编码工具包**（不含 Agent 概念，符合零依赖与「产品概念不进包」纪律），而非「编码 Agent 专用」 |
| 5 | 差异化表述 | **是** —— 以「治理」（审批 + 三档沙箱 + 审计导出 + 续跑）为主叙事，而非「又一个编码 Agent」 |

> ~~落地的第一个动作是规范级核对~~ → **已于 2026-09-17 完成**，见 `docs/acp-spec-review.md`。要点：传输 = **stdio**（换行分隔 JSON-RPC，stdout 只写 ACP 消息、日志走 stderr，与本项目既有纪律一致）；**流式不要求 token 级分块，非 ACP 前置**；**`session/set_mode` 有废弃风险**，桥接须同时提供 Session Config Options；`usage_update` 的 `used` / `size` / `cost` 可由 M7-1 的 token 计量直接填。
> 拍板后的执行排期见 `docs/architecture.md` §11 M8 行与 `docs/development-checklist.md` §3.4。

---

## 10. 参考事实来源（外部）

| 事实 | 来源 |
|---|---|
| AionUi 自动识别本机 Claude Code / Codex / Gemini CLI / Qwen Code / opencode | AionUi 官网及其第三方评测文章 |
| DeepChat 为本地优先桌面 Agent 客户端，**内置 ACP 支持**用于接入外部 Agent Runtime，并支持 MCP | DeepChat GitHub README / 官方文档 / 第三方解析 |
| ACP 为 JSON-RPC 2.0，"AI 代理版的 LSP"，关联 Zed Industries、JetBrains、GitHub；方法集与能力声明如 §2.1 | ACP 官方文档「概览」 |
| MonkeyCode 为云端开发环境 + 云端沙箱（每任务一台真实服务器）+ Git 机器人 | MonkeyCode 官方及第三方评测文章 |
| CodeBuddy 同时支持插件、IDE、CLI 三种形态 | 腾讯云官方公告 |

> 外部产品信息以公开资料为准，落地前建议对 ACP 传输方式与分块要求做一次规范级核对。

---

## 11. 相关文档

- 底座收敛（边界与纪律，口径事实源）：`docs/base-convergence.md`
- 方向与 M7 里程碑草案：`docs/product-direction.md`
- 架构与路线图：`docs/architecture.md`
- 公共 API 面（G2 会影响）：`docs/api-surface.md`
- 机制参考：`docs/historical/codex-reference.md`、`docs/historical/deepseek-harness-reference.md`
