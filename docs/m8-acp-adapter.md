# M8-2 / M8-3 ACP 适配包执行清单

> **状态**：✅ M8-2 + M8-3 代码完成（2026-09-17）｜**待办**：真实 ACP Client 联调
> **包**：`packages/acp`（`@node-agent-runtime/acp`，新增第 13 个包）
> **规范依据**：[`docs/acp-spec-review.md`](./acp-spec-review.md)（ACP v1 Stable 核对记录）
> **排期**：[`docs/development-checklist.md`](./development-checklist.md) §3.4

## 1. 方法范围

| ACP 方法 | 状态 | 底座映射 |
|---|---|---|
| `initialize` | ✅ | 版本与能力协商（`loadSession`、`sessionCapabilities.close`），无鉴权 |
| `session/new` | ✅ | `SessionManager.createSession`；`cwd` → 沙箱 `scope.workspace` |
| `session/prompt` | ✅ | `SessionManager.chat` + EventBus → `session/update` |
| `session/cancel` | ✅ | `AbortSignal` → `cancelled` stopReason |
| `session/load` | ✅ | 回放持久化 transcript |
| `session/close` | ✅ | abort + `closeSession` |
| `session/request_permission` | ✅ M8-3 | `AcpPermissionBridge` ↔ `PermissionManager` 的 pending decision |
| `session/set_mode` | ✅ M8-3 | `SandboxMode`；**同时**提供 `session/set_config_option`（官方明示 set_mode 将被移除） |

## 2. 事件映射

| RuntimeEvent | `session/update` |
|---|---|
| `model:response`（有文本） | `agent_message_chunk`（`messageId = runId:step`） |
| `tool:start` | `tool_call`（`pending`，kind 由名称 + 敏感度共同推断） |
| `tool:end` | `tool_call_update`（`completed` / `failed`） |
| `usage:update`、`run:end` | `usage_update`（`used` / `size` / `cost`） |

Stop reason：`end_turn` / `max_turn_requests`（步数上限）/ `cancelled`。

## 3. 架构决策（四条）

1. **每会话一个 runtime + EventBus。** runtime 的事件总线是进程级的，共享会让并发轮次互相串台；per-session 顺带让沙箱作用域与待审批决策天然隔离。
2. **取消不是错误路径。** `RunAbortedError` 与 provider SDK 抛出的 `AbortError` 都要捕获并回答 `cancelled`；否则客户端会把一次取消渲染成失败 —— 这是规范点名要求的。
3. **title 只附加路径类参数。** title 会原样显示在客户端 UI，回显任意参数值等于把模型写进去的东西（token、密钥、文件正文）贴到界面上。
4. **审批走真桥接，且通道不可用即降级（M8-3）。** `AcpPermissionBridge` 身兼两职：作为 `PermissionPolicy` 它**保留** `ask` 判定（M8-2 的 `NoAskPolicy` 只能把 `ask` 压成 `deny`），作为事件订阅者它把每个挂起的 decision 变成一次 `session/request_permission`，再把用户选择翻译回 `approve()` / `deny()`。时序上依赖 `core/runtime.ts` 的「`tool:start` 先于 `gate()`」—— 客户端此刻已看到该 tool call，所以请求里能带**真实 `toolCallId`**，正是 ACP 中 `pending = awaiting approval` 的语义。客户端不实现该方法（`-32601`）时记住并直接 `deny`，否则每个高危工具都要空等 60s 审批超时；`reject_always` 由桥接在会话内记住（`PermissionManager` 只持久化 approve 类授权、没有拒绝名单），重启后重新询问而非静默沿用一次遗忘的拒绝。

## 4. 验收

已通过 33 例（`npm run test -w @node-agent-runtime/acp`）：

- 握手：`initialize` → `protocolVersion: 1` + `loadSession`
- 最小闭环：`session/new` → `session/prompt` → `end_turn` + 消息块 + 用量
- 工具调用：`tool_call`（pending）→ `tool_call_update`（completed）
- 取消：`session/cancel` → `cancelled`（不是 error）
- 回放：换一个 agent 进程 `session/load` → user / agent chunk
- 负例：未知会话 → 参数错误，不凭空建会话
- 传输：真实子进程 stdio 握手，半帧写入仍能正确重组
- **审批（M8-3）**：请求携带真实 `toolCallId`、参数过 `redact`；`allow_once` → 工具真的执行；`reject` / `cancelled` / 未知 optionId → 工具失败（模型可自纠）；`reject_always` 只问一次；客户端缺该方法 → 立刻降级为拒绝，不阻塞整轮
- **模式（M8-3）**：`session/new` 同时给出 `modes` 与 `configOptions` 且两者一致；切到 `read-only` 后写工具被策略直接拒绝（**不再弹审批**），切回 `workspace-write` 又恢复询问 —— 证明模式真实改变策略而非只改 UI；非法模式 / 未知配置项报参数错误

**待做 —— 真机联调**（Zed / DeepChat / 任一 ACP Client）：

1. `npm run build -w @node-agent-runtime/acp`
2. 写入口脚本 `new AcpAgent({ provider, agents }).start()`，用 `node` 启动
3. 在 Client 里把 agent 命令指向该脚本，跑一次多步会话
4. 核对：工具调用是否原生呈现；`session/cancel` 是否显示为「已取消」而非报错

## 5. 已知限制

- 一步一条完整 `agent_message_chunk`（分块是 MAY 而非 MUST），M8-4 升级
- `usage_update.size` 用实时上下文占用近似 —— 底座没有固定窗口的概念
- prompt 接受 text（收到 `resource` 也会折叠进输入），未声明 image / audio

## 6. 相关文档

- [`docs/acp-spec-review.md`](./acp-spec-review.md) —— 规范核对（传输 / 分块 / 废弃项）
- [`docs/development-checklist.md`](./development-checklist.md) §3.4 —— M8 排期
- [`docs/base-convergence.md`](./base-convergence.md) §3 —— 立项准入三问
