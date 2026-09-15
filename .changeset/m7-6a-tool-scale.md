---
"@node-agent-runtime/core": minor
"@node-agent-runtime/types": minor
"@node-agent-runtime/memory": minor
"@node-agent-runtime/host": minor
---

M7-6a 工具规模治理（检索式声明）：`core` 新增 `ToolIndex` / `createToolSearchTool` 与 `RunOptions.toolBudget`（opt-in 声明面裁剪 + `tool_search` 元工具，非权限收窄）；`StepSnapshot.toolSurface` / `StepStartEvent.declaredTools` 记录本步工具面，`Checkpoint.toolSurface` 同步落库（host 接入）。`StepStartEvent`/`StepSnapshot`/`Checkpoint` 均为 additive 字段，全部 minor。
