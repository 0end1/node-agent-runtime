---
"@node-agent-runtime/acp": minor
---

M8-2：新增 ACP v1 适配包 `@node-agent-runtime/acp`，把底座暴露为 ACP agent。**传输为 stdio**（换行分隔 JSON-RPC，stdout 只写协议消息、日志走 stderr）。实现 `initialize` / `session/new` / `session/prompt` / `session/cancel`，另含 `session/load`（回放持久化 transcript）与 `session/close`；`session/update` 覆盖消息块、`tool_call` → `tool_call_update`（pending → completed / failed）与 `usage_update`（`used` / `size` / `cost` 由 M7-1 的 token 计量直接填），`stopReason` 含 `end_turn` / `max_turn_requests` / `cancelled`。

四条取舍：① 每会话独立 runtime + EventBus（runtime 总线是进程级的，共享会让并发轮次串台）；② **取消不是错误路径** —— `RunAbortedError` 与 provider SDK 抛的 `AbortError` 都捕获并回 `cancelled`（规范点名要求，否则客户端把取消渲染成失败）；③ tool title 只附加路径类参数，避免把模型写入的敏感参数值渲染到客户端 UI；④ M8-2 阶段以 `NoAskPolicy` 把 `ask` 降级为 `deny`，避免无审批通道时 pending decision 空等 60s（M8-3 已用 `session/request_permission` 真桥接替换）。
