# @node-agent-runtime/mcp

## 0.4.0

### Minor Changes

- c1dafef: M7-6b MCP 只读资源。`McpClient` 增 `resourcesSupported` / `listResources()` / `readResource(uri)`（JSON-RPC `resources/list` 与 `resources/read`，未声明 `resources` 能力 ⇒ 无资源而非报错）；`McpRegistry` 增 `listResources()` / `readResource(uri, server?)` / `searchTools(query)`，并在 `register()` 时把资源物化为只读工具 `mcp__<server>__resource__<slug>_<fnv1a8>`（URI 在闭包内固定，模型无法在调用期改写）。安全口径：读取**只接受 `resources/list` 已声明的 URI**（越权抛 `McpResourceError` 且不转发），敏感度一律保守取 `network-read`，故走既有 gate 与沙箱禁网判定、不新增旁路。规模与上下文护栏：`maxResourceTools`（默认 50，与 M7-6a `maxDeclared` 对齐）/ `resourceTools`（可关）/ `maxResourceChars`（默认 32k，`resourceText()` 摊平时二进制不进上下文）。`McpServerHandle` 上的资源方法为**可选**，既有 handle 实现零改动，全部 additive、无需 major。

### Patch Changes

- Updated dependencies [6d7d3ff]
- Updated dependencies [552076d]
- Updated dependencies [65743e8]
- Updated dependencies [26196ca]
- Updated dependencies [3e93fe1]
- Updated dependencies [fa0b539]
  - @node-agent-runtime/types@0.4.0
  - @node-agent-runtime/core@0.4.0

## 0.3.0

### Minor Changes

- d19d5ae: P4 SDK 发布工程：MIT LICENSE；各包去 `private` 并补全发布元数据（`publishConfig.access=public`、`sideEffects:false`、仓库/关键词/作者）；`engines` 全仓统一 `>=22.13.0` 并以 `.nvmrc`/`packageManager` 对齐；`@node-agent-runtime/core` 与 `@node-agent-runtime/types` 提为插件包的 peer 依赖边界；新增包体积基线与 CI 门禁；引入 changesets 编排 0.2.0 → 0.3.0。

### Patch Changes

- Updated dependencies [d19d5ae]
  - @node-agent-runtime/types@0.3.0
  - @node-agent-runtime/core@0.3.0
