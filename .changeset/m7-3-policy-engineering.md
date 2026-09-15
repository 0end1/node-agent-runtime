---
"@node-agent-runtime/policy": minor
"@node-agent-runtime/core": minor
---

M7-3 策略工程化：声明式策略契约（`PolicyDocument` / `PolicyRule` / `PolicyTestCase`）、`validatePolicyDocument` / `compilePolicy` / `testPolicy`、三套组织预设（`prod-strict` / `dev-open` / `readonly-audit`）、`policy:test` 脚本纳入 `npm run ci`；`core` 配置接入 `preset` / `documentPath`（`AGENT_POLICY_*` 环境变量，外部文件先校验后编译）。声明式契约落在 `policy` 包（非 spec 草案的 `types`）以保留 `types ← sandbox` 的依赖 DAG。
