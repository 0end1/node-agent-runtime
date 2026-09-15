# @node-agent-runtime/policy

## 0.4.0

### Minor Changes

- 26196ca: M7-3 策略工程化：声明式策略契约（`PolicyDocument` / `PolicyRule` / `PolicyTestCase`）、`validatePolicyDocument` / `compilePolicy` / `testPolicy`、三套组织预设（`prod-strict` / `dev-open` / `readonly-audit`）、`policy:test` 脚本纳入 `npm run ci`；`core` 配置接入 `preset` / `documentPath`（`AGENT_POLICY_*` 环境变量，外部文件先校验后编译）。声明式契约落在 `policy` 包（非 spec 草案的 `types`）以保留 `types ← sandbox` 的依赖 DAG。

### Patch Changes

- Updated dependencies [6d7d3ff]
- Updated dependencies [552076d]
- Updated dependencies [65743e8]
- Updated dependencies [3e93fe1]
- Updated dependencies [fa0b539]
  - @node-agent-runtime/types@0.4.0
  - @node-agent-runtime/sandbox@0.4.0

## 0.3.0

### Minor Changes

- d19d5ae: P4 SDK 发布工程：MIT LICENSE；各包去 `private` 并补全发布元数据（`publishConfig.access=public`、`sideEffects:false`、仓库/关键词/作者）；`engines` 全仓统一 `>=22.13.0` 并以 `.nvmrc`/`packageManager` 对齐；`@node-agent-runtime/core` 与 `@node-agent-runtime/types` 提为插件包的 peer 依赖边界；新增包体积基线与 CI 门禁；引入 changesets 编排 0.2.0 → 0.3.0。

### Patch Changes

- Updated dependencies [d19d5ae]
  - @node-agent-runtime/types@0.3.0
  - @node-agent-runtime/sandbox@0.3.0
