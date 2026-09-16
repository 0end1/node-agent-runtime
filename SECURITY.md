# Security Policy

**文档作者：wangzhiyong** · GitHub：[0end1](https://github.com/0end1) · 联系邮箱：[y1378379002@gmail.com](mailto:y1378379002@gmail.com)

## 支持版本

本项目处于 `0.x`，安全修复只针对**最新发布的版本线**（当前 `0.4.x`，latest=`0.4.1`，发版由 changesets 管理）。请升级到最新版本后再报告问题。

> 注意：`0.4.0` 因缺少 workspace 内部依赖声明已被 `deprecate`，请直接使用 `0.4.1`。

| 版本 | 支持 |
| --- | --- |
| 最新 tag（`v*`） | ✅ |
| 更早的 0.x | ❌（请升级后复现） |

## 报告渠道

**请优先使用私密渠道**，不要在公开 issue 中披露细节：

1. GitHub Security Advisories：<https://github.com/0end1/node-agent-runtime/security/advisories/new>（推荐，可直接起草修复与 CVE）
2. 邮件：<y1378379002@gmail.com>，标题以 `[SECURITY]` 开头

请尽量提供：

- 影响的包名与版本；
- 最小复现（代码片段 / 配置 / 环境）；
- 影响面（凭据泄露 / 越权 / SSRF / 沙箱逃逸 / 拒绝服务…）；
- 你判断的严重度与是否有已知缓解方式。

## 响应目标

| 阶段 | 目标 |
| --- | --- |
| 确认收到 | 3 个工作日内 |
| 初步评估（确认/驳回 + 严重度） | 7 个工作日内 |
| 修复发布 | 视严重度：高危尽快发补丁版，中低危随下一个常规版本 |

## 范围说明

**属于本项目安全范围**：

- 沙箱/权限边界被绕过（路径越界、网络未受限、执行域提升）；
- 事件与日志中的凭据泄露（P3.2 脱敏失效）；
- Web 控制台的鉴权/跨站防护失效（P3.5）；
- MCP 传输的 SSRF 或子进程凭据泄露（P3.6）；
- 审批审计被绕过或白名单持久化异常（P3.3）。

**不属于本项目范围**（请直接向上游报告或按设计处理）：

- 第三方依赖自身的漏洞 —— 走对应上游（CI 已用 `npm audit --omit=dev` 把守高危依赖）；
- 使用者把无鉴权的 loopback 控制台直接暴露到公网 —— 这是部署问题，参见下方"安全默认值"；
- 模型输出内容本身（提示注入、有害内容）—— 属应用层治理，本项目只提供工具审批与沙箱边界；
- 需要本地代码执行权限才能触发的问题（`full-access` 模式下的行为由使用者负责）。

## 安全默认值（部署者须知）

项目默认按"收紧"方向设计，但**默认不等于生产就绪**，部署时请显式配置：

| 项 | 环境变量 / API | 建议 |
| --- | --- | --- |
| 控制台鉴权 | `AGENT_API_TOKEN` | 非 loopback 监听**必须**设置（否则拒绝启动，P3.5） |
| 跨站来源白名单 | `AGENT_CORS_ALLOW_ORIGINS` | 显式列出允许的 Origin，勿用 `*` |
| MCP 端点白名单 | `AGENT_MCP_HTTP_ALLOWLIST` | 列出允许的 origin，阻断 SSRF（P3.6） |
| MCP 子进程凭据 | `AGENT_MCP_ENV_<NAME>` | 只注入所需变量；默认不继承宿主 env |
| 运行预算 | `AGENT_LIMIT_*`、`AGENT_RATE_TOOL_*` | 设置步数/时长/cost/工具速率上限（P3.4） |
| 安全策略包 | `createProductionDefaults(workspace)` | 最小权限 + 沙箱锁域（禁网、仅工作区可写，P3.7） |

更多细节见 `docs/m6-productionization.md` §3（P3 安全与可观测性）与 `docs/p3-review.md`（含已修复项与已知边界）。

## 致谢

报告者默认会在修复版本的 `CHANGELOG.md` 与 advisory 中被致谢；如果你希望匿名，请在报告中说明。
