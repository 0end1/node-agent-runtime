---
"@node-agent-runtime/acp": minor
"@node-agent-runtime/host": minor
---

M8-3 ACP 权限桥接与模式协商：

- **权限**：`session/request_permission` ↔ `PermissionManager` 的 pending decision —— 桥接**保留** `ask` 判定（替换 M8-2 的 `NoAskPolicy` 兜底，后者仍可通过 `permissions: "deny"` 使用），四个标准 option 映射为 `approve()` / `approve({ always: true })`（落 P3 grant 持久化）/ `deny()` / `deny()` + 会话内记住；请求携带**真实 `toolCallId`**（`tool:start` 先于 `gate()` 发出）且参数过 `redact()`；客户端回 `-32601` 时**降级为拒绝**而非空等 60s 审批超时。
- **模式**：`session/set_mode` ↔ `SandboxMode`，并按规范「set_mode 将被 Session Config Options 取代」**双轨**提供 `session/set_config_option`；`session/new` 同时返回 `modes` 与 `configOptions`（同表生成、取值恒一致）。
- **底座增量（additive）**：`host` 的 `SessionManager` 新增 `setSandboxMode()` / `getSandboxMode()` —— `sandboxMode` 由构造期只读改为可运行时切换。因 `sandbox.begin()` 在每次 run 开始时重读模式，**切换自下一次 run 生效**，故不会在已授权的工具执行中悄悄移动沙箱边界；既有构造签名与行为不变，**非破坏**。
