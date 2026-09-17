# M8-2 ACP 适配包执行清单

> **状态**：✅ 代码完成（2026-09-17）｜**待办**：真实 ACP Client 联调
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
| `session/request_permission` | ☐ M8-3 | `AcpConnection.request()` 已就绪，待接 `PermissionManager` |
| `session/set_mode` | ☐ M8-3 | 须**同时**提供 Session Config Options（官方明示 set_mode 将被移除） |

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
4. **M8-2 用 `NoAskPolicy` 把 `ask` 降级为 `deny`。** 默认策略对高危工具会 `ask`，而 pending decision 要等主机 UI（默认 60s）。没有审批通道时立刻拒绝让模型自纠，好过卡一分钟再失败；M8-3 换成真桥接。

## 4. 验收

已通过 19 例（`npm run test -w @node-agent-runtime/acp`）：

- 握手：`initialize` → `protocolVersion: 1` + `loadSession`
- 最小闭环：`session/new` → `session/prompt` → `end_turn` + 消息块 + 用量
- 工具调用：`tool_call`（pending）→ `tool_call_update`（completed）
- 取消：`session/cancel` → `cancelled`（不是 error）
- 回放：换一个 agent 进程 `session/load` → user / agent chunk
- 负例：未知会话 → 参数错误，不凭空建会话

**待做 —— 真机联调**（Zed / DeepChat / 任一 ACP Client）：

1. `npm run build -w @node-agent-runtime/acp`
2. 写入口脚本 `new AcpAgent({ provider, agents }).start()`，用 `node` 启动
3. 在 Client 里把 agent 命令指向该脚本，跑一次多步会话
4. 核对：工具调用是否原生呈现；`session/cancel` 是否显示为「已取消」而非报错

## 5. 已知限制

- 无审批通道（`ask` → `deny`），M8-3 解除
- 一步一条完整 `agent_message_chunk`（分块是 MAY 而非 MUST），M8-4 升级
- `usage_update.size` 用实时上下文占用近似 —— 底座没有固定窗口的概念
- prompt 接受 text（收到 `resource` 也会折叠进输入），未声明 image / audio

## 6. 相关文档

- [`docs/acp-spec-review.md`](./acp-spec-review.md) —— 规范核对（传输 / 分块 / 废弃项）
- [`docs/development-checklist.md`](./development-checklist.md) §3.4 —— M8 排期
- [`docs/base-convergence.md`](./base-convergence.md) §3 —— 立项准入三问
