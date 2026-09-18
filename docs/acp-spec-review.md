# ACP v1 规范核对记录（M8-2 执行依据）

> **核对日期**：2026-09-17　**目的**：解除 `docs/product-build-paths.md` §2.3 待核对项，确定 M8 内部排序（流式是否为 ACP 包的前置）。
> **规范版本**：ACP **v1（Latest / Stable）**。v2 为 Draft，本轮不作为实现目标。
> **来源**：`agentclientprotocol.com/protocol/v1/` —— Overview / Transports / Prompt Turn / Session Modes。

## 1. 结论摘要

| # | 核对项 | 结论 | 对 M8 排期的影响 |
|---|---|---|---|
| 1 | 传输方式 | **stdio**（SHOULD 支持）+ Streamable HTTP（**草案中**）+ 自定义传输 | 实现 stdio 即可；HTTP 等其稳定后再议 |
| 2 | `session/update` 是否要求 token 级分块 | **不要求**：全篇措辞为 MAY / 描述性；唯一 MUST 是 turn 结束时须以 `stopReason` 响应 `session/prompt` | **流式不是 ACP 前置** —— M8-2 不被阻塞；M8-4 流式维持第二批（体验增强） |
| 3 | 方法命名 | 一律**斜杠**：`initialize` / `session/new` / `session/prompt` / `session/cancel` / `session/set_mode` / `session/request_permission` / `session/update` | 修正 `product-build-paths.md` §8 与 `development-checklist.md` §3.4 的点号笔误 |
| 4 | `session/set_mode` 稳定性 | **有废弃风险**：官方明示「Dedicated session mode methods will be removed in a future version」，替代为 **Session Config Options** | M8-3 桥接须**同时提供 Session Config Options**，否则协议升级后返工 |
| 5 | `usage_update` 载荷 | `used` / `size` 为必需 token 计数，`cost.{amount,currency}` 可选 | M7-1 已有 token 计量与成本 → **可直接填**；多数 agent 不填 cost，可作差异化点 |

## 2. 传输（Transports）

- **stdio**：Client 以子进程启动 Agent；Agent 从 stdin 读、向 stdout 写 JSON-RPC 消息；消息以**换行（`\n`）分隔且不得含内嵌换行**；UTF-8 编码。
  - Agent **MUST NOT** 向 stdout 写任何非 ACP 消息；日志走 **stderr**（Client 可捕获 / 转发 / 忽略）。
  - → 与本项目既有「stdout 是 JSON 契约、日志走 stderr」纪律**一致**，CLI 约定可直接复用。
- **Streamable HTTP**：仍在讨论（draft proposal in progress）—— 本轮不实现。
- **自定义传输**：允许（保持 JSON-RPC 消息格式与生命周期要求即可）。
- **通用约定**：JSON-RPC 2.0；文件路径 **MUST 为绝对路径**；行号 **1-based**；键名 camelCase（JSON-RPC 信封字段除外）；扩展用 `_meta` 字段，自定义方法以下划线 `_` 为前缀。

## 3. 方法集与方向

| 方法 / 通知 | 方向 | 备注 |
|---|---|---|
| `initialize` | Client → Agent | baseline：版本与能力协商 |
| `authenticate` | Client → Agent | baseline（若 Agent 要求） |
| `session/new` | Client → Agent | baseline |
| `session/load` | Client → Agent | 可选（需 `loadSession` capability） |
| `session/prompt` | Client → Agent | baseline |
| `session/cancel` | Client → Agent（**通知**） | 不期待响应 |
| `session/set_mode` | Client → Agent | 可选；**未来将被 Session Config Options 取代** |
| `session/request_permission` | Agent → Client | Client 侧 **baseline** 方法 |
| `session/update` | Agent → Client（**通知**） | 见 §4 |
| `fs/read_text_file` / `fs/write_text_file` | Agent → Client | 可选（需对应 capability） |
| `terminal/create` / `output` / `release` / `wait_for_exit` / `kill` | Agent → Client | 可选（需 `terminal` capability） |

> 注：官方 Overview 把 `session/update` 列在 Client 的 Notifications 小节下，但其语义与 Message Flow 均为 **Agent → Client**（"Agent → Client: session/update notifications for progress updates"）—— 列在 Client 下是指 Client 需实现接收端。

## 4. `session/update` 的 `sessionUpdate` 类型

| 类型 | 载荷要点 | 本项目映射来源 |
|---|---|---|
| `agent_message_chunk` / `user_message_chunk` / `agent_thought_chunk` | `messageId`（可选、opaque；同 id 属同一条消息，id 变化表示新消息）+ `content` | `model:response` 等事件 |
| `tool_call` | `toolCallId` / `title` / `kind` / `status: pending` | `tool:start` |
| `tool_call_update` | `toolCallId` / `status`（`in_progress` → `completed`）/ `content` | `tool:end` |
| `plan` | `entries[]`（content / priority / status） | 暂无（可选实现） |
| `usage_update` | `used` + `size`（**必需**，token 计数）、`cost.{amount,currency}`（可选） | **M7-1 成本与上下文治理** |
| `current_mode_update` | `modeId` | `SandboxMode` 变更 |
| available commands update | — | 可选 |

**分块要求（关键）**：Prompt Turn 全篇对 chunk 的措辞为 MAY（"The Agent **MAY** include an opaque, unique messageId…"、"The Agent **MAY** also report… usage_update"），工具状态更新为 SHOULD（"the Agent **SHOULD** invoke the tool and report a status update"）。
**唯一的 MUST**：「If there are no pending tool calls, the turn ends and the Agent **MUST** respond to the original `session/prompt` request with a StopReason」。

→ 因此：**只发一条完整的 `agent_message_chunk` 并在结尾回 `stopReason` 即合规**。流式属体验增强，**不阻塞 ACP 包落地**。

## 5. Stop Reason 与取消

- `stopReason` 取值：`end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled`。
  - 前三者与本项目既有 `RunLimits`（maxTokens / maxTurnRequests）**同名同义**，可直接映射。
- 取消语义：`session/cancel` 发出后 —— Client **MUST** 以 `cancelled` outcome 响应所有 pending `session/request_permission`；Agent **MUST** 捕获 abort 异常并返回 `cancelled` stopReason（**不得**以 error 响应，否则 Client 会把取消当错误展示给用户）；Agent **MAY** 在响应 `session/prompt` 之前补发 update。
  → 本项目已有 `AbortSignal` + Checkpoint 续跑，映射可行；**需显式处理 abort 异常转 `cancelled` stopReason**。

## 6. 权限桥接

`session/request_permission` 的 `options[]` 每项含 `optionId` / `name` / `kind`，示例 kind 为 `allow_once` / `allow_always` / `reject_once`（及对应 always 形式）。

→ 与 `PermissionManager` 的审批结果（approve once / approve always / deny）形状一致；`always` 白名单持久化（P3 已实现）对应 `allow_always`。

**M8-3 已落地（2026-09-17）**：`AcpPermissionBridge` 完成该映射 —— `allow_once` → `approve()`、`allow_always` → `approve({ always: true })`（落 P3 的 grant 持久化）、`reject_once` → `deny()`、`reject_always` → `deny()` 并在会话内记住（`PermissionManager` 只持久化授权、没有拒绝名单，故不跨重启）。请求携带**真实 `toolCallId`**（`tool:start` 先于 `gate()` 发出，客户端此时已在渲染该调用），参数经 `redact()`，符合 ACP「pending = awaiting approval」语义。

## 7. Session Modes 的废弃风险（M8-3 必读）

官方 Session Modes 页顶部原文：

> "You can now use Session Config Options. Dedicated session mode methods will be removed in a future version of the protocol. Until then, you can offer both to clients for backwards compatibility."

即 `session/set_mode` 属**过渡机制**。M8-3 实现 `session/set_mode ↔ SandboxMode` 时应**同时提供 Session Config Options**，否则 v2 落地后需返工。

**M8-3 已落地（2026-09-17）**：按此执行 —— `session/new` 同时返回 `modes` 与 `configOptions`（同一张模式表生成，两侧取值恒一致），`session/set_mode` 与 `session/set_config_option` 均可切换并同步另一侧（补发 `current_mode_update`）。模式不是 UI 装饰：经 `SessionManager.setSandboxMode()` 改变 `sandbox.begin()` 与策略判定的 `sandboxMode`，从**下一次 run** 起真实改变沙箱边界（切到 `read-only` 后写工具被策略直接拒绝，不再弹审批）。

## 8. 相关文档

- 路径评估与拍板结论：`docs/product-build-paths.md`（§2 方法映射、§2.3 待核对项、§9 结论表）
- M8 排期：`docs/development-checklist.md` §3.4、`docs/architecture.md` §11 M8 行
- 底座边界与准入：`docs/base-convergence.md` §3 三问
