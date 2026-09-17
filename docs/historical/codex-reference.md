# Codex-rs 可借鉴实现清单（仅供 nodeRuntimes 参考）

> 入库日期：2026-09-05（来源为 codex-rs 结构解析文章 + 官方 README/文档，均为二手整理，实现时以仓库源码为准）
> 范围：**仅作参考文档入库**（`codex-reference.md`），不并入 `architecture.md` / 路线图，不参与 CHANGELOG 版本条目；是否在后续设计中被采用由人工决定。
> 开源对象：`openai/codex`（Apache-2.0），`codex-rs/` 下约 136 个 crate。开源的是**本地 harness**（Agent 循环、本地沙箱、审批、会话持久化）；codex-1 模型 / 云端并行 Agent / 云托管沙箱不在其中。
>
> **采纳复核（P6.6，2026-09-09）**：
> - **已采纳**：执行边界（命令/网络/路径 + 三档模式）→ M3 `LocalSandbox` + P3.7 生产预设 `createProductionDefaults`；审批预设与超时即拒 → M3 `PermissionManager` + P3.3 审批审计与 `always` 白名单持久化；会话持久化与续跑 → M1 `Storage` + M2 `Checkpoint`/`resume`。
> - **可采纳（列入 next）**：① token/成本计量与上下文压缩（`maxCostUsd` 现依赖宿主 cost 钩子，可内置 token 计量 + 自动 compact）；② 可观测追踪（事件总线 + 结构化日志已落地，可加 `traceId`/span 与 OTEL 导出）；③ CLI 侧 TUI 审批交互（Web 审批卡片已覆盖，CLI 仍是文本提示）。
> - **不采纳**：模型面绑 OpenAI、云端并行 Agent、Rust 巨石 crate 结构 —— 与本项目"可切模型 / 产品解耦"目标相反。

---

## 0. 一句话结论

Codex 对 nodeRuntimes 的价值是「**M2~M5 的实现蓝本**」而不是基座：它把「执行边界 + 审批 + 会话持久化 + 上下文装配」做成了教科书级实现，但模型面绑 OpenAI、且不做通用产品抽象——与 nodeRuntimes「可切模型、产品解耦」的目标相反，所以**借鉴其机制而非套壳**。

---

## 1. 按本项目里程碑的借鉴映射

### → M3 Permission + Sandbox（最值得抄，优先级 P0）

| Codex 机制 / 文件 | 借鉴点 | 映射到本项目 |
|---|---|---|
| `sandboxing`：`read-only / workspace-write / danger-full-access` 三档；`workspace-write` 独立配置 `writable_roots`、`network_access`（**出站网络默认关闭**） | 「能力边界」与「授权判断」**二维正交**：沙箱定义做得到什么，审批定义允不允许，二者不可互替，都落在**执行层**而非提示词 | §6 `SandboxMode`/`SandboxScope`（v1.2 已对齐思想；落实现时抄 writable_roots 与网络默认 deny 的具体做法） |
| 平台后端：macOS Seatbelt / Linux bubblewrap(Landlock 兜底) / Windows 受限令牌；高层配置翻译为平台策略下发 | 平台抽象层 = 上层通用策略 + 每平台翻译器 | `sandbox.ts` 的 LocalSandbox 参考（Node 环境可先用"进程内校验 + 可选 docker"） |
| `execpolicy`：`~/.codex/rules/*.rules`（Starlark），`prefix_rule()` **参数前缀匹配**，决策 `allow/prompt/forbidden`，**多规则同时命中取最严**；规则自带 match/not_match 内联测试 | 命令策略用「前缀匹配 + 取最严」，且策略文件**可测**、离线可查（`codex execpolicy check`） | `permission.ts` 的 `PermissionPolicy.decide`：把规则写成可单测的声明式数据 |
| `execpolicy` 作为**沙箱外特例出口**：安全命令（如 `gh pr view`）在沙箱外运行，避免逐次弹窗审批疲劳 | 白名单命令不套沙箱而是走策略直放——**沙箱 ≠ 唯一边界** | §6.0.1 补充"特例直放通道"概念 |
| `tools/approvals.rs` + `network_approval.rs`：出站访问单独审批路径；按 主机/协议/端口 归组，**一次批准放行多个排队同类请求** | 网络访问按目标归组批量审批，减少打断 | §6 审批模型细化项 |
| TUI 中把某命令加入白名单 → 向 `default.rules` 追加规则（**交互式授权沉淀为声明式策略文件**） | 「运行时人工放行」自动落成「下次直接放行的规则」 | `PermissionManager` 的 ask 结果持久化 |
| 机制：工具执行同时受 sandbox（能力）+ approval（授权）两层约束 | 双层判断拆成两个模块两个调用点 | §6.1 + §6.2 接口分置 |

### → M2 Memory / Checkpoint / 会话持久化（P1）

| Codex 机制 | 借鉴点 | 本项目对应 |
|---|---|---|
| `rollout`（JSONL **真相源**）+ SQLite（可重建索引）；崩溃从日志恢复；**revert/fork 用新建 rollout 文件而非改写历史** | 追加式日志为真相，索引可重建可丢弃；恢复/回滚=换文件，不破坏历史 | Storage 流域/`RunRecord`：Checkpoint 恢复语义参考「不改历史、指向新日志」 |
| `core/src/session/`：session / turn / step 三层粒度 | turn 概念 ≈ 你的 Task；印证 Run 内再拆粒度 | Session/Task/Run/Step 四层已覆盖 |
| **两级冻结**：TurnContext（turn 级配置快照）、StepContext（单次采样快照）；工具宣告与执行同源，杜绝"模型以为在 A、副作用在 B" | 冻结工具集/上下文快照，保证单步内声明与执行一致 | `Context` 门面扩展：step 级快照 = Checkpoint 的自然切分点 |

### → M4 MCP（P1，省时最多）

| Codex 机制 | 借鉴点 | 本项目对应 |
|---|---|---|
| **双向 MCP**：`mcp-server`（把自己暴露为 MCP server）+ `rmcp-client`（作为 client 连他方） | 先做 client（roadmap 需要），server 形态可后置 | §5.3 只有单向接入，补 client 实现时可参考 `rmcp-client` |
| MCP 工具集变化纳入 StepContext 快照，保证**一步之内工具集一致** | MCP 注册延迟解析的缓存与失效策略 | §5.3 McpRegistry 的 resolve/缓存 |
| `core/src/tools/mcp.rs`、`mcp_resource/`（list/read resource） | 工具 + 资源两类能力都要暴露 | §8 Artifact 与 mcp-resource 打通 |

### → 模型切换层（长期命题，P0 认知校正）

| Codex 机制 | 借鉴点 | 说明 |
|---|---|---|
| `model-provider` 多后端 + `ollama`/`lmstudio` + `responses-api-proxy`；`wire_api` 区分 **responses / chat 双线路** | 「切模型」在 Codex 里是一个**子系统**（线路协议/重试/超时都分后端配置），不是一层适配 | 印证此前判断：nodeRuntimes 的 `ModelProvider` 抽象方向正确，但要预留 wire_api 差异与 per-backend 超时重试 |
| 远端压缩（compaction）在该层经 ChatGPT 鉴权完成 | 上下文压缩可作为 ModelProvider 的服务，而非引擎内置 | 长期记忆/上下文裁剪的可插拔点 |

### → 上下文装配与引擎健壮性（P1）

| Codex 机制 | 借鉴点 | 本项目对应 |
|---|---|---|
| `context-fragments`：40+ **具名上下文片段**按需装配 | 把「给模型的上下文」建模成可开关的具名片段，而不是一坨 prompt 拼接 | `context.ts` 未来扩展：session/task/memory/tool-list 各自成片段 |
| `compaction`：本地压缩 + 远端压缩两种 | 会话过长时的摘要续聊策略 | M2 Memory 的一部分 |
| `guardian` 子系统：安全复核 | 在 Agent 主环外加一层"复核通过才执行高危动作" | M3 治理可选增强 |
| `shell_environment_policy`：默认过滤 KEY/SECRET/TOKEN 等敏感环境变量再进子进程 | 防凭据泄漏的执行卫生 | Sandbox 的 env 精简（v1.2 `SandboxScope.env` 已验证此方向） |

### → 多 Agent / 前端多形态（M5+，P2 前瞻）

| Codex 机制 | 借鉴点 |
|---|---|
| `core/src/agent/`：两代 multi-agent——v1 `spawn/wait/send_input/close_agent/resume_agent`（进程管理语义）、v2 `spawn/wait/send_message/list_agents/interrupt_agent/followup_task`（协作语义） | 多 Agent API 设计演进路线：先进程式后协作文 |
| `tui` / `exec` / `app-server` 三个前端**共用同一 Core**，无各自 Agent 循环 | 印证 nodeRuntimes「Desktop/Host 只是消费同一引擎」的分层哲学 |
| `config` 四级优先级（命令行 > profile > config.toml > 内置默认）+ `[features]` 16 个能力开关分级（stable/beta/experimental） | 本项目目前**没有 config 模块**；将来可参考这套装配与特性开关分级 |

### → 工具子系统细节（P1 参考）

`core/src/tools/`：registry / router / orchestrator / parallel / lifecycle / approvals / sandboxing / tool_dispatch_trace。
能力 handlers：`apply_patch`（补丁式编辑）、`shell_spec` + 常驻 PTY `unified_exec`（命令执行）、`get_context_remaining`/`new_context_window`（上下文自省）、`tool_search`（**工具多到需要按需检索**）、`request_user_input`/`request_permissions`、图片输入、计划、等待。
对应观察：`tool_search` 与 StepContext 冻结提示——当工具集变大，`compileAgent()`/MCP 物化时工具列表本身会爆上下文，需要检索式声明。

---

## 2. 关键源码落点（要抄时直接去这些 crate）

| 目标 | 路径（openai/codex · codex-rs/） |
|---|---|
| 沙箱三档实现与平台翻译 | `sandboxing/`、`linux-sandbox/`、`bwrap/`、`exec-server/` |
| 命令策略规则 | `execpolicy/` |
| 审批时机 / 网络审批 | `core/src/tools/approvals.rs`、`network_approval.rs` |
| 会话持久化（JSONL+SQLite） | `rollout/`、`rollout-trace/`、`thread-store/`、`agent-graph-store/` |
| 会话/turn/step 与上下文冻结 | `core/src/session/`、`core/src/context/` |
| 模型接入多后端 | `model-provider/`、`ollama/`、`lmstudio/`、`responses-api-proxy/` |
| MCP 双向 | `mcp-server/`、`rmcp-client/`、`core/src/tools/mcp.rs` |
| 工具子系统 | `core/src/tools/` |
| 多 Agent | `core/src/agent/` |
| 配置与特性开关 | `config/`、`features/` |

---

## 3. 借鉴注意事项

1. **许可**：Apache-2.0。若直接拷贝/改写代码，需保留 LICENSE/NOTICE、声明修改（Modified by ...），不得用原商标误导。建议只"抄设计 + 关键实现对照"，文档引述无此负担。
2. **schema 不稳**：Codex 会话 JSONL/SQLite schema 是其内部格式，官方不承诺稳定——只参考思路，别依赖其字段。
3. **迭代极快**：本文档基于 2026-09-05 快照，开工前重查 `codex --help` / `config.toml` / 仓库主分支。
4. **成本预期**：真正可落地省时的点：M3 沙箱+审批（参考 `sandboxing`/`execpolicy`）、M4 MCP client（参考 `rmcp-client`）。M2 持久化与 M5 多 Agent 只抄机制即可。

---

## 4. 与主架构文档的关系

- 本文件为**独立参考文档**，不并入 `docs/architecture.md` 各章节（§5.3/§6/§7/§11 等不因本文档产生条目改动）。
- 若后续某个里程碑真正借鉴了其中机制，再在该里程碑的设计修订（如 architecture v1.3+）或 CHANGELOG 条目中引用本文件。
