# @node-agent-runtime/tools-basic

## 0.4.1

### Patch Changes

- Fixed: 补齐 10 个包缺失的内部 workspace 运行时依赖声明

  0.4.0 的构建产物实际 import 了其他 workspace 包（如 core 引用 @node-agent-runtime/artifact、host 引用 core/types/artifact），但 package.json 未声明。本地 workspace 符号链接掩盖了这个问题，发布后 npm install 无法解析依赖，import 时抛 ERR_MODULE_NOT_FOUND。本次补齐全部缺失依赖声明。

- Updated dependencies
  - @node-agent-runtime/core@0.4.1
  - @node-agent-runtime/types@0.4.1

## 0.4.0

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
