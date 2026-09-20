---
"@node-agent-runtime/core": patch
"@node-agent-runtime/policy": patch
---

P3 §3 前两项清理 + 一处审批修复（均非新增 API，patch）：

- **`core`**：`parsePositiveInt` 更名为 `parsePositiveNumber`（内部私有函数）—— 原名与实现两处不符：实际返回 `number` 且允许小数（`AGENT_LIMIT_MAX_COST_USD=0.5` 依赖此语义），却叫 "Int"。同时 `buildLimits` 中每个字段由求值两次改为先抽局部变量、只解析一次。行为不变。
- **`core`**：修复 `AGENT_LIMIT_MAX_COST_USD=0` 被当作「未设置」忽略 —— 原实现以 falsy 兜底，`0` 与 `NaN` 一起被吞掉，而 `0` 是合法预算（**禁止任何消费**，恰是最严格的护栏），配了却不生效。现区分「未设置」与「显式 0」：只有 `undefined` / 空串表示未设置，`0` 照常生效为成本上限。
- **`policy`**：修复在 `permission:request` 监听器里同步 `approve()` 会静默失效 —— 原实现先 `emit` 事件、后在 `new Promise` 的 executor 里把 waiter 登记进表，于是宿主最自然的写法（在监听器里同步 `manager.approve(event.decisionId)`）发生时 waiter 尚未登记，决策一直挂到 `askTimeoutMs`（默认 60s）才按超时拒绝，审计里表现为 `verdict=timeout` 而 UI 上「用户明明点了同意」。现改为先建 promise 与 waiter 再发事件（顺序调整，行为不变）。
