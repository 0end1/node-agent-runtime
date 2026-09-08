---
"@agent-runtime/types": minor
"@agent-runtime/core": minor
"@agent-runtime/memory": minor
"@agent-runtime/artifact": minor
"@agent-runtime/sandbox": minor
"@agent-runtime/policy": minor
"@agent-runtime/tools-basic": minor
"@agent-runtime/mock": minor
"@agent-runtime/host": minor
"@agent-runtime/mcp": minor
"@agent-runtime/provider-openai": minor
"@agent-runtime/store-sqlite": minor
---

P4 SDK 发布工程：MIT LICENSE；各包去 `private` 并补全发布元数据（`publishConfig.access=public`、`sideEffects:false`、仓库/关键词/作者）；`engines` 全仓统一 `>=22.13.0` 并以 `.nvmrc`/`packageManager` 对齐；`@agent-runtime/core` 与 `@agent-runtime/types` 提为插件包的 peer 依赖边界；新增包体积基线与 CI 门禁；引入 changesets 编排 0.2.0 → 0.3.0。
