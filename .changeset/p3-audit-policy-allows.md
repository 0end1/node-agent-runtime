---
"@node-agent-runtime/policy": minor
"@node-agent-runtime/core": minor
"@node-agent-runtime/host": minor
"@node-agent-runtime/acp": minor
---

P3 §3 第 3 项：新增 `auditPolicyAllows` 审计开关（`PermissionManagerOptions` → `RuntimeConfig.permission` → `AGENT_PERMISSION_AUDIT_POLICY_ALLOWS` → `SessionManagerOptions` → `AcpAgentOptions` 全链路透传，additive）。

默认 **true**（`policy-allow` 全量留痕）；设为 `false` 可跳过放行类审计行，缓解高频无害工具（只读查询等）把审批存储写满的问题。**`deny` / `ask` / 宿主决策 / grant 持久化始终留痕**，不受开关影响 —— 安全语义不因调参而退化。调用方若自行注入 `permission` 实例，则以该实例为准（开关不生效）。
