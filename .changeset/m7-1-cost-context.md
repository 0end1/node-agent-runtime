---
"@node-agent-runtime/types": minor
"@node-agent-runtime/memory": minor
"@node-agent-runtime/core": minor
"@node-agent-runtime/provider-openai": patch
---

M7-1 成本与上下文治理（底座收敛首批）：

- 内置计量：新增 `PriceTable` + `usageCost` 纯函数（`types`）；`RunUsage` 增 `cachedInputTokens?` / `costUsd?`；`core` 增加 `pricing?` 选项，优先级高于既有 `costUsd` 宿主钩子（钩子保留为回退）。
- 上下文压缩：新增 `ContextBudget` + `compactMessages` 确定性纯函数（`memory`，零依赖、结构化折叠保留用户原始目标与工具结果关键字段）；`core` 在 step 循环内 provider 调用前执行压缩并发 `context:compacted`。
- 事件与配置：新增 `usage:update` / `context:compacted` 事件；`core` 配置接入 `AGENT_CONTEXT_*` 环境变量；`provider-openai` 解析缓存命中 token。

全部 additive（minor），provider-openai 为 patch 级解析增强。
