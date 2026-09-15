# Contributing

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

感谢你参与 Agent Runtime。本文约定分支、提交、质量门与发版流程，照此执行即可让 PR 一次通过 CI。

## 1. 环境

| 项 | 要求 | 来源 |
| --- | --- | --- |
| Node | `>=22.13.0`（推荐 `.nvmrc` 的 22.22.1） | 根 `package.json` `engines`、`.nvmrc` |
| npm | `10.9.4`（`packageManager`，建议用 `corepack enable`） | 根 `package.json` |
| 安装 | `npm ci`（不要 `npm install`，避免 lockfile 漂移） | — |

```bash
nvm use            # 读取 .nvmrc
npm ci
npm run ci         # 全部门禁：typecheck → lint → test → coverage:gate → check:api → size
```

`npm run ci` 是**唯一的收口口径**，本地通过后再推 PR。

## 2. 仓库结构

npm workspaces monorepo，根包是容器（private），`packages/*` 为可发布包：

| 包 | 职责 |
| --- | --- |
| `@node-agent-runtime/types` | C1 契约层：消息/工具/事件/Storage/Artifact 类型、错误码、schema 校验、零 IO 纯函数 |
| `@node-agent-runtime/core` | C2 引擎：run loop、Agent、事件总线、Provider/Tool 契约、`MemoryStorage`/`FileStorage` |
| `@node-agent-runtime/memory` | C3 会话记忆与 checkpoint |
| `@node-agent-runtime/artifact` | C4 产物管理 |
| `@node-agent-runtime/sandbox` | 执行域（三档模式 + 声明域 + 网络开关） |
| `@node-agent-runtime/policy` | 授权决策与审批流 |
| `@node-agent-runtime/host` | C8 `SessionManager` 会话/任务生命周期 |
| `@node-agent-runtime/mcp` | C6 MCP 客户端（stdio / streamable HTTP） |
| `@node-agent-runtime/provider-openai` | C7 OpenAI 兼容模型后端 |
| `@node-agent-runtime/store-sqlite` | C9 SQLite 存储后端（`node:sqlite`） |
| `@node-agent-runtime/tools-basic` / `@node-agent-runtime/mock` | 内置工具集 / 免密钥 Mock Provider（演示与测试） |

边界规则见 `docs/crate-architecture.md` 与 `docs/api-surface.md`（后者是公共导出面的唯一事实源）。

## 3. 分支与提交

- **分支**：`main`（发布）/ `dev`（日常开发）/ `apps`（桌面与 Web 形态）。CI 对三个分支都跑质量门。
- **提交信息**：Conventional Commits —— `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` / `perf:`。
- **CHANGELOG**：可见改动必须在**同一个 commit** 里追加 `CHANGELOG.md` 条目（`[Unreleased]` 下对应的里程碑段落）。
- **changeset**：用户可见改动（新增/变更/修复）需附一个 changeset：

  ```bash
  npm run changeset          # 交互式选择包与 minor/patch
  git add .changeset         # 随 PR 一起提交
  ```

  没有 changeset 的改动不会触发发版（P4.4）。纯文档/内部重构可用 `patch` 或省略。

## 4. 质量门

| 门禁 | 命令 | 口径 |
| --- | --- | --- |
| 类型 | `npm run typecheck` | `tsc --noEmit`，零错误 |
| Lint / 格式 | `npm run lint`、`npm run format:check` | ESLint + Prettier |
| 测试 | `npm test` | `node:test`，逐包运行 |
| 覆盖率 | `npm run coverage:gate` | 逐包 行≥80 / 分支≥60 / 函数≥55；全仓均值 行≥90 / 分支≥78 / 函数≥85 |
| API 面 | `npm run check:api` | 与 `scripts/api-surface.baseline.json` 零差异 |
| 包体积 | `npm run size` | 单包 tarball 较基线增长 ≤ +25% |

**公共导出面变更**（新增/删除/改名导出符号）：

1. 修改代码后运行 `npm run check:api` 确认差异；
2. 确认是**有意为之**后 `npm run check:api:update` 重新冻结；
3. 同步更新 `docs/api-surface.md` 的符号快照表与 `CHANGELOG.md` 的 Added/Changed。

**包体积基线**因体积增长而失败时，先确认是否有必要；确属必要则 `npm run size:update` 并在 PR 中说明原因。

## 5. 代码风格

- TypeScript 严格模式；优先纯函数与显式类型，避免使用 `any`。
- 包内不得引入未经约定的第三方运行时依赖（本仓库以零运行时依赖为设计取舍）。
- 提交前：`npm run format`（Prettier）与 `npm run lint:fix`。
- 新增能力需同时提供测试；安全相关改动必须附对应用例（见 P3 各节）。

## 6. PR 清单

- [ ] `npm run ci` 全绿
- [ ] 公共 API 有变更 → 基线已更新 + `docs/api-surface.md` 已补快照
- [ ] 用户可见改动 → 已加 changeset + `CHANGELOG.md` 条目
- [ ] 新增/变更行为有测试覆盖，覆盖率未跌破门禁
- [ ] 文档同步（README / `docs/` 中对应章节）

## 7. 发版（维护者）

```bash
npm run version-packages    # 消费 changesets：bump 版本 + 更新 CHANGELOG
npm run release             # 构建并 npm publish（CI 由 .github/workflows/release.yml 执行）
```

所有包 `fixed` 统一版本号；实际发布需仓库配置 `NPM_TOKEN` secret，经 tag `v*` 触发 `npm publish --provenance`。
