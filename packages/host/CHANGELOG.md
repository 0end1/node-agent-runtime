# @node-agent-runtime/host

## 0.4.2

### Patch Changes

- d70f7bc: chore: release 0.4.2 to verify OIDC trusted publishing (no functional changes)
- Updated dependencies [d70f7bc]
  - @node-agent-runtime/artifact@0.4.2
  - @node-agent-runtime/core@0.4.2
  - @node-agent-runtime/memory@0.4.2
  - @node-agent-runtime/policy@0.4.2
  - @node-agent-runtime/sandbox@0.4.2
  - @node-agent-runtime/types@0.4.2

## 0.4.1

### Patch Changes

- Fixed: 补齐 10 个包缺失的内部 workspace 运行时依赖声明

  0.4.0 的构建产物实际 import 了其他 workspace 包（如 core 引用 @node-agent-runtime/artifact、host 引用 core/types/artifact），但 package.json 未声明。本地 workspace 符号链接掩盖了这个问题，发布后 npm install 无法解析依赖，import 时抛 ERR_MODULE_NOT_FOUND。本次补齐全部缺失依赖声明。

- Updated dependencies
  - @node-agent-runtime/artifact@0.4.1
  - @node-agent-runtime/core@0.4.1
  - @node-agent-runtime/memory@0.4.1
  - @node-agent-runtime/policy@0.4.1
  - @node-agent-runtime/sandbox@0.4.1
  - @node-agent-runtime/types@0.4.1

## 0.4.0

### Minor Changes

- 552076d: M7-2 可观测与合规导出（收尾：OTEL + 审计导出）。`StepStartEvent` / `ToolStartEvent` / `ToolEndEvent` 增可选 `at?`（epoch ms，由 runtime 在发射点补齐），补上此前「仅 run 级有时间戳」的缺口；`core` 新增 `toOtelSpans` 纯函数，产出 OTLP-JSON span 形状（确定性 id、`run→step→tool` 父子关系、单调 `startTimeUnixNano` / `endTimeUnixNano`），**只产形状、不绑定 OTLP 传输**，不新增包、零第三方运行时依赖；`host` 新增 `serializeAudit` / `exportAudit`（CSV RFC 4180 + JSON 稳定键序），固定列序仅含 `argumentsFingerprint`（不含工具参数原文），每条记录先过 `redact` 再落盘。全部 additive，无需 major。
- fa0b539: M7-6a 工具规模治理（检索式声明）：`core` 新增 `ToolIndex` / `createToolSearchTool` 与 `RunOptions.toolBudget`（opt-in 声明面裁剪 + `tool_search` 元工具，非权限收窄）；`StepSnapshot.toolSurface` / `StepStartEvent.declaredTools` 记录本步工具面，`Checkpoint.toolSurface` 同步落库（host 接入）。`StepStartEvent`/`StepSnapshot`/`Checkpoint` 均为 additive 字段，全部 minor。

### Patch Changes

- Updated dependencies [6d7d3ff]
- Updated dependencies [552076d]
- Updated dependencies [65743e8]
- Updated dependencies [26196ca]
- Updated dependencies [3e93fe1]
- Updated dependencies [fa0b539]
  - @node-agent-runtime/types@0.4.0
  - @node-agent-runtime/memory@0.4.0
  - @node-agent-runtime/core@0.4.0
  - @node-agent-runtime/policy@0.4.0
  - @node-agent-runtime/sandbox@0.4.0

## 0.3.0

### Minor Changes

- d19d5ae: P4 SDK 发布工程：MIT LICENSE；各包去 `private` 并补全发布元数据（`publishConfig.access=public`、`sideEffects:false`、仓库/关键词/作者）；`engines` 全仓统一 `>=22.13.0` 并以 `.nvmrc`/`packageManager` 对齐；`@node-agent-runtime/core` 与 `@node-agent-runtime/types` 提为插件包的 peer 依赖边界；新增包体积基线与 CI 门禁；引入 changesets 编排 0.2.0 → 0.3.0。

### Patch Changes

- Updated dependencies [d19d5ae]
  - @node-agent-runtime/types@0.3.0
  - @node-agent-runtime/core@0.3.0
  - @node-agent-runtime/memory@0.3.0
  - @node-agent-runtime/sandbox@0.3.0
  - @node-agent-runtime/policy@0.3.0
