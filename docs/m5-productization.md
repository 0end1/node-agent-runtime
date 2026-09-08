# M5 产品化可前置清单（非拆包）

> 记录时间：2026-09-07
> 背景：M5 行内定义 = **独立分包 + Desktop 壳 + Web 控制台全面 Session 化**（`docs/architecture.md` §11，验收：桌面 demo 全流程可用）。
> 决策：拆包暂缓（C3~C6/C8/facade 见 `docs/crate-split-todo.md`），本清单只列**与拆包解耦、现在即可前置**的工作。
> 原则：仅消费引擎包的**公共 API**（`@agent-runtime/core` 及已外置的 `provider-openai` / `store-sqlite` / `host` 等）；C8 host 已于 M6 拆出，examples 改从 `@agent-runtime/host` 导入，本清单前置工作不白做。
>
> **阶段状态（2026-09-07 收尾）**：本清单前置项全部落地并验证；余下 #5 验收（安装分发实机验证、自动化 E2E、typecheck/test 全绿）移交**下一开发阶段**跟踪，本文件保留为验收依据。

## 1. 现状核实（2026-09-07）

- `examples/`：`cli.ts` + `web/`（`server.ts` 等）+ `desktop-tauri/`（Tauri v2 壳，M5-4 已建）。
- 已到 M1 会话化：CLI 会话持久化（`.runtime-data/`）与 `/new` `/list` `/use`、重启自动续最近会话；Web 端浏览器 localStorage 固定会话跨刷新/跨服务重启恢复。
- **缺口已补齐**：#1 CLI / #2 Web / #3 Desktop 已消费 M2~M4 公开 API（`resume` / `pendingApprovals` / `approve` / `McpRegistry` / `ArtifactManager` / `Sandbox` / `PermissionManager` / `SessionMemory`），examples 操作面完整；仅余 #5 E2E 验收（含自动化）未做。

## 2. 可前置清单

| # | 事项 | 交付物 | 依据 | 状态 |
|---|---|---|---|---|
| 1 | examples 操作面补齐 M2~M4 | CLI 命令 + Web 视图接上新能力 | §11「产品化」 | ✅（CLI 完成；Web 见 #2） |
| 2 | Web 控制台全面 Session 化 | 审批 / artifact / 续跑视图 | §11 M5 行原文 | ✅ |
| 3 | Desktop 壳 | `examples/desktop-tauri/`（Tauri v2） | §11 M5 交付物 | ✅（dev 跑通 + 生产打包验证通过：`tauri build` 产出 .app/.dmg，自带 Node sidecar 实跑 :8787 → 200） |
| 4 | store-sqlite 演示接入 | 可选后端替换 `FileStorage` 的验证 | M5-1 外置包配套 | ✅ |
| 5 | M5 E2E 验收 | 桌面 demo 全流程（含自动化） | §11 M5 验收 | ➡️ 移交下一开发阶段（2026-09-07 阶段收尾）：生产打包已验证（.app/.dmg + sidecar 自包含，app 自带 node 实跑 :8787 → 200）；待补：安装分发实机验证、自动化 E2E、仓库级 typecheck/test 全绿 |
| 6 | 文档 / README 子系统化 | 参考页按能力粒度补齐 | dsh P1 借鉴 | ✅ |

## 3. 明细（#1 / #2 / #3 展开）

### #1 CLI（`examples/cli.ts`）

- `resume <checkpointId>`：基于 checkpoint 续跑同一 task
- 审批交互：监听 `permission:request` → `pendingApprovals()` → `approve(decisionId, { always })` / `deny`（⚠ 见 §5，不接线 ask 会挂起）
- `mcp register <server 入口>`：注册 MCP server，工具并入会话
- `artifacts` / `artifact <id>`：列出与查看会话 artifact
- 演示写工具 `demo_write_file`（`kind: "write"`）：让 M3 审批/沙箱在 CLI demo 中可见——模型调用时默认策略 ask，CLI 订阅 `permission:request` 显示待授权项，`/approve` 放行后沙箱校验路径并 emit `sandbox:write`（带 diff）展示。

### #2 Web（`examples/web/`）

- ✅ 审批 UI：常驻 `/api/events` 流推送 `permission:request`，前端渲染「需要授权」卡片（批准 / 始终允许 / 拒绝），调用 `/api/approve` `/api/deny`（事件驱动，run 阻塞时不挂起）
- ✅ 事件流渲染：`permission:request` / `permission:approved|denied` / `sandbox:write`（含 diff）经治理流展示
- ✅ artifact 面板：按会话列出、点击预览文本/元数据（`/api/artifacts`、`/api/artifact/:id` + 侧栏）
- ✅ 续跑入口：checkpoint 列表 → resume（`/api/checkpoints`、`/api/resume` SSE + 侧栏）
- ✅ 会话列表 / 切换（`/api/sessions`、`/api/new` + 侧栏）

### #3 Desktop（`examples/desktop-tauri/`，Tauri v2）

- 壳用 **Tauri v2**：窗口加载 `examples/web` 控制台（`devUrl=http://localhost:8787`，由 `beforeDevCommand: npm --prefix ../../ run demo:web` 启动 Node server 提供 API + 静态，见 M5-4 Fixed）。
- 仅依赖引擎公共 API（与 #1/#2 同源）；M6 起 C8 host 已拆为 `@agent-runtime/host`，示例改从子包导入，前置工作不白做。
- **生产 sidecar 已接入并验证**：release 构建时 `lib.rs::spawn_server` 以 `tauri-plugin-shell` sidecar 拉起 app 自带 Node 运行时执行打包好的 server bundle（监听 8787），窗口 `url` 固定指向该地址，dev/生产共用同一控制台与 API 面。`build-server.mjs` 在打包前生成 bundle + node 运行时副本 + 静态资源（`src-tauri/binaries/`，gitignore 忽略）；`tauri build` 产出 .app/.dmg，实跑 :8787 → 200（M5-6）。
- **图标已生成**：`npx tauri icon` 产出 `src-tauri/icons/`（含 icns/ico/png），源码 `icon-source.png` 同目录。
- 环境已具备：`cargo 1.98` + `node v22` + Xcode CLI + `@tauri-apps/cli`；`cargo check` 绿、`npm run tauri dev` 已点开验证窗口渲染（M5-4）。

## 4. 建议执行顺序

**#1 → #4 → #2 → #3 → #5**（#6 文档全程并行）。

理由：#1 先让 CLI 用上全部引擎能力，暴露操作面缺口最便宜；#4 验证新外置存储后端；#2/#3 是同一宿主能力的多形态搬运；#5 收口验收。

## 5. 前置注意点

- **审批挂起风险已解除（CLI）**：`examples/cli.ts` 已订阅 `permission:request` 并订阅 `sandbox:write`，run 阻塞等待授权时仍可接收 `/approve` `/deny`（事件驱动，不挂起）。新增演示写工具 `demo_write_file`（`kind: "write"`）默认触发 ask，可在 CLI demo 中直接演练 M3；Web 端（#2）仍需补齐审批 UI 才能不挂起。
- **根 `engines` 不一致**：根 `node >=18.17` vs `@agent-runtime/store-sqlite` `>=22.13`（node:sqlite），接入 sqlite 演示前需统一口径。
- **Desktop 技术栈已定 Tauri v2**（见 #3 明细）：仅依赖 `core` 公共 API；生产侧**自带 Node 运行时** sidecar 已打包验证（M5-6）。
- **M2 续跑语义**：`resume` 无 `continuation` 时不追加用户轮次；CLI 续跑后的输入需走 `continuation` 传参，注意消息时序与一次性跑完一致（test 即规格，`core/test/session.test.ts`）。

## 6. 验收标准（下一开发阶段执行）

- CLI：续跑 / 审批 / artifact / MCP 注册全流程可用
- Web：审批与 `sandbox:write` diff 可视化、artifact 面板、续跑可用
- Desktop：dev 模式 `npm run tauri dev` 窗口渲染 + 控制台全流程可用；release 构建启用 `bundle.externalBin` 并打包 `binaries/agent-server` 后 `tauri build` 通过（§11 M5 验收）
- `npm run typecheck` 与 `npm test` 全绿；每模块能力变更随包测试
- CHANGELOG 同步（维护约定：代码与文档同一 commit）

## 7. 相关文档

- 顶层架构与路线图：`docs/architecture.md` §11
- 包边界与 M5 收口：`d