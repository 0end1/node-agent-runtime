---
"@node-agent-runtime/mcp": minor
---

M7-6b MCP 只读资源。`McpClient` 增 `resourcesSupported` / `listResources()` / `readResource(uri)`（JSON-RPC `resources/list` 与 `resources/read`，未声明 `resources` 能力 ⇒ 无资源而非报错）；`McpRegistry` 增 `listResources()` / `readResource(uri, server?)` / `searchTools(query)`，并在 `register()` 时把资源物化为只读工具 `mcp__<server>__resource__<slug>_<fnv1a8>`（URI 在闭包内固定，模型无法在调用期改写）。安全口径：读取**只接受 `resources/list` 已声明的 URI**（越权抛 `McpResourceError` 且不转发），敏感度一律保守取 `network-read`，故走既有 gate 与沙箱禁网判定、不新增旁路。规模与上下文护栏：`maxResourceTools`（默认 50，与 M7-6a `maxDeclared` 对齐）/ `resourceTools`（可关）/ `maxResourceChars`（默认 32k，`resourceText()` 摊平时二进制不进上下文）。`McpServerHandle` 上的资源方法为**可选**，既有 handle 实现零改动，全部 additive、无需 major。
