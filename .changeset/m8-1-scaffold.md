---
"create-node-agent-runtime": minor
---

M8-1 脚手架：`create-node-agent-runtime` 首个版本。`npx create-node-agent-runtime my-agent` 生成第一个受治理 Agent 项目 —— 生成的 `src/main.ts` 直接接好三条主链：`createProductionDefaults()` 的最小权限策略 + 锁定沙箱域、`permission:request` / `sandbox:write` 事件订阅、`FileStorage` 落盘（会话 / 检查点 / 审批审计可续跑）；默认 `MockProvider`，**无需 API Key** 即可 `npm start`。

四条取舍：① **零运行时依赖**（只用 `node:` 内置 —— 别人 `npx` 拉的第一个包，不该让人等下载）；② 模板以字符串常量**编译进 `dist`**（`files: ["dist"]`，没有「资源没被打进 tarball」这类发布事故）；③ **遇到已存在的文件一律报错而非覆盖**（在非空目录误跑时，最不该发生的是毁掉用户文件）；④ 交互只在 TTY 下进行，非 TTY（CI / 管道）取默认值。
