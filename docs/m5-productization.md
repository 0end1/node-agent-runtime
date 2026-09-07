# M5 产品化可前置清单（非拆包）

> 记录时间：2026-09-07
> 背景：M5 行内定义 = **独立分包 + Desktop 壳 + Web 控制台全面 Session 化**（`docs/architecture.md` §11，验收：桌面 demo 全流程可用）。
> 决策：拆包暂缓（C3~C6/C8/facade 见 `docs/crate-split-todo.md`），本清单只列**与拆包解耦、现在即可前置**的工作。
> 原则：仅消费 `@agent-runtime/core`（及已外置 `provider-openai` / `store-sqlite`）的**公共 API**；未来若拆 C8 host，examples 只需把 import 源从 core 换成 host，不白做。

## 1. 现状核实（2026-09-07）

- `examples/`：仅 `cli.ts` + `web/`（`server.ts` 等），**无 desktop**。
- 已到 M1 会话化：CLI 会话持久化（`.runtime-data/`）与 `/new` `/list` `/use`、重启自动续最近会话；Web 端浏览器 localStorage 固定会话跨刷新/跨服务重启恢复。
- **缺口**：全仓 examples 未引用任何 M2~M4 公开 API——`resume` / `pendingApprovals` / `approve` / `McpRegistry` / `ArtifactManager` / `Sandbox` / `PermissionManager` / `SessionMemory` 均无使用点。M2~M4 的宿主能力已内建于 `SessionManager`，仅差 examples 的操作面暴露。

## 2. 可前置清单

| # | 事项 | 交付物 | 依据 | 状态 |
|---|---|---|---|---|
| 1 | examples 操作面补齐 M2~M4 | CLI 命令 + Web 视图接上新能力 | §11「产品化」 | ✅（CLI 完成；Web 见 #2） |
| 2 | Web 控制台全面 Session 化 | 审批 / artifact / 续跑视图 | §11 M5 行原文 | ✅ |
| 3 | Desktop 壳 | `examples/desktop-tauri/`（Tauri v2） | §11 M5 交付物 | 🟡（骨架已建，dev 模式可验证） |
| 4 | store-sqlite 演示接入 | 可选后端替换 `FileStorage` 的验证 | M5-1 外置包配套 | ✅ |
| 5 | M5 E2E 验收 | 桌面 demo 全流程（含自动化） | §11 M5 验收 | ☐ |
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

- 壳用 **Tauri v2**：窗口加载 `examples/web` 控制台（`devUrl=http://localhost:8787`，由 `beforeDevCommand: npm run demo:web` 启动 Node server 提供 API + 静态）。
- 仅依赖 `@agent-runtime/core` 公共 API（与 #1/#2 同源），未来 C8 host 不白做。
- 生产打包需 Node 运行时随应用启动（cargo sidecar 打包 `tsx`/编译产物），列入 #5 验收前补齐；dev 演示已可全流程。
- 图标：首次需 `npx tauri icon <png>` 生成 `src-tauri/icons/`（Tauri 上下文依赖）。

## 4. 建议执行顺序

**#1 → #4 → #2 → #3 → #5**（#6 文档全程并行）。

理由：#1 先让 CLI 用上全部引擎能力，暴露操作面缺口最便宜；#4 验证新外置存储后端；#2/#3 是同一宿主能力的多形态搬运；#5 收口验收。

## 5. 前置注意点

- **审批挂起风险已解除（CLI）**：`examples/cli.ts` 已订阅 `permission:request` 并订阅 `sandbox:write`，run 阻塞等待授权时仍可接收 `/approve` `/deny`（事件驱动，不挂起）。新增演示写工具 `demo_write_file`（`kind: "write"`）默认触发 ask，可在 CLI demo 中直接演练 M3；Web 端（#2）仍需补齐审批 UI 才能不挂起。
- **根 `engines` 不一致**：根 `node >=18.17` vs `@agent-runtime/store-sqlite` `>=22.13`（node:sqlite），接入 sqlite 演示前需统一口径。
- **Desktop 技术栈已定 Tauri v2**（见 #3 明细）：仅依赖 `core` 公共 API；生产侧 Node 运行时 sidecar 打包列入 #5 验收前补齐。
- **M2 续跑语义**：`resume` 无 `continuation` 时不追加用户轮次；CLI 续跑后的输入需走 `continuation` 传参，注意消息时序与一次性跑完一致（test 即规格，`core/test/session.test.ts`）。

## 6. 验收标准

- CLI：续跑 / 审批 / artifact / MCP 注册全流程可用
- Web：审批与 `sandbox:write` diff 可视化、artifact 面板、续跑可用
- Desktop：桌面 demo 全流程可用（§11 M5 验收）
- `npm run typecheck` 与 `npm test` 全绿；每模块能力变更随包测试
- CHANGELOG 同步（维护约定：代码与文档同一 commit）

## 7. 相关文档

- 顶层架构与路线图：`docs/architecture.md` §11
- 包边界与 M5 收口：`docs/crate-architecture.md` §6 / §8 / §9
- 拆包执行清单（并行参考）：`docs/crate-split-todo.md`
- codex / dsh 参考：`docs/codex-reference.md`、`docs/deepseek-harness-reference.md`
