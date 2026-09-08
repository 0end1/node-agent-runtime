# P3 安全与可观测性 —— 代码评审（2026-09-08）

评审范围：P3.1 ~ P3.8（M6-18 `e7e8e53` + M6-19 `6883bc6`），对照 `docs/m6-productionization.md` §3 的验收口径。

初评发现 8 项问题（1 中高危 / 2 中 / 5 低）。**全部 8 项已于评审后同日修复**（H1/M1/M2/L3 在 M6-20，L1/L2/L4/L5 在 M6-21）。

复跑现状（全部修完）：`eslint` 干净 · `npm run check:api` 零差异 · 全量 223 用例 0 失败（3 例为既有 skip）。

## 0. 结论

功能面已闭环：八项均有实现与自动化测试，默认收紧方向正确（fail-closed 启动校验、脱敏统一兜底、审计只留指纹）。

初评的验收口径偏差与低危加固项已全部处理，P3.2 / P3.4 / P3.5 / P3.6 / P3.8 与验收口径严格对齐，**Gate 3 结论成立**。

| 级别 | 项 | 状态 |
| --- | --- | --- |
| 中高危（防护可绕过） | H1 MCP 白名单可被 30x 重定向绕过 | ✅ 已修（M6-20） |
| 中（与验收不符） | M1 `maxSteps` 超限不产 `run:error` | ✅ 已修（M6-20） |
| 中（与验收不符） | M2 CORS 预检缺响应头（拒得住、放不开） | ✅ 已修（M6-20） |
| 低 | L3 stdio 子进程继承完整 `process.env` | ✅ 已修（M6-20） |
| 低 | L1 `redact` 深度 > 8 不脱敏 | ✅ 已修（M6-21） |
| 低 | L2 强密钥 key 白名单漏带前缀形式 | ✅ 已修（M6-21） |
| 低 | L4 令牌非恒定时间比较 + 无 Origin 放行 | ✅ 已修（M6-21） |
| 低 | L5 空串 `OPENAI_API_KEY` 静默降级 mock | ✅ 已修（M6-21） |

---

## 1. 中高危 / 中与验收口径不符（M6-20 已修）

### ✅ H1 · P3.6 MCP 白名单可被 30x 重定向绕过（SSRF）

原 `post()` 直接 `fetch` 而未设 `redirect`（默认 `follow`），URL 只在构造时校验一次 —— 白名单内的端点返回 `302 → http://169.254.169.254/...` 即被跟随并读回响应。

修复（`packages/mcp/src/transport.ts`）：新增 `requestOnce()`（强制 `redirect: "manual"`）与 `requestWithGuardedRedirects()`（手动跟随，**每跳重新 `validateMcpServerUrl`**，跳数上限 `MAX_REDIRECTS = 3`）；`notify()` 同样拒绝跟随 3xx。

- 测试：重定向到内网地址 → 拒绝且从未真正请求该地址；白名单内重定向 → 正常跟随并完成调用。
- 边界：DNS rebinding 无法在 fetch 层拦截，需网络层（egress 代理 / 防火墙）兜底。

### ✅ M1 · P3.4 `maxSteps` 超限不产 `run:error`

原实现把 `limits.maxSteps` 同时当循环上界，使 `checkRunLimits` 的 `steps > maxSteps` 恒为假 —— 触及上限按"自然结束"处理。

修复（`packages/core/src/runtime.ts`）：循环上界固定 `agent.maxSteps`（软停止），`limits.maxSteps` 作为独立预算，越界那一步抛 `LimitExceededError` → 既有 catch 发出 `run:error` + `code: limit_exceeded`。

- 测试：`limits: { maxSteps: 1 }` + 永不收敛 provider → 断言 reject 且事件流含 `run:error(limit_exceeded)`。

### ✅ M2 · P3.5 CORS 预检缺少响应头

修复：`examples/web/security.ts` 新增纯函数 `decidePreflight()`（复用 `decideCors`），放行时回 `ACAO` 回显 + `ACAM: GET, POST, OPTIONS` + `ACAH: content-type, authorization` + `Vary: Origin`，拒绝时 403 + JSON；`server.ts` OPTIONS 分支改为调用它。

### ✅ L3 · P3.6 stdio 子进程继承完整 `process.env`

修复：`buildChildEnv()` 默认只透传 `MINIMAL_ENV_KEYS`（`PATH`/`HOME`/`TMP*`/`SystemRoot`/`LANG` 等）+ 显式 `env`（`config.mcp.serverEnv`）；新增 `inheritEnv?: boolean` 供可信 server 显式放开。

## 2. 低危加固（M6-21 已修）

### ✅ L1 · `redact` 深度 > 8 直接返回原值

原 `if (depth > 8) return value;` 让第 9 层及以下的密钥裸奔。

修复（`packages/core/src/log.ts`）：拆出内部 `redactValue(value, seen, depth)`——深度达 `REDACT_DEPTH_LIMIT`(8) 时**整值替换为 `REDACTED`** 而非放行原文；用 `WeakSet` 显式检测循环引用（命中即 `REDACTED`）。公开签名 `redact(value, depth?)` 保持不变。

- 测试：12 层嵌套中的密钥不得出现在输出；循环引用不崩溃且 `self` 被脱敏。

### ✅ L2 · 强密钥 key 漏带前缀形式

修复：键名正则改为 `(^|[-_.])(…)$`，覆盖 `x-api-key`、`proxy-authorization` 等；`SECRET_VALUE` 补充厂商前缀 `gh[pousr]_`（GitHub）、`github_pat_`、`xox[aboprs]-`（Slack）、`AIza`（Google）、`glpat-`（GitLab），并放宽 JWT 分支（不再要求结尾锚定）。

### ✅ L4 · 令牌比较非恒定时间 + 无 Origin 状态变更放行

修复（`examples/web/security.ts`）：`decideAuth` 改走 `tokensEqual()`（`crypto.timingSafeEqual`，长度不等时先做等长比较再返回）；新增纯函数 `decideCsrf({ method, origin, secFetchSite, hasToken })` —— 无令牌部署下，安全方法 / 带 Origin（交给 `decideCors`）/ `Sec-Fetch-Site` 非 cross-site 放行，`cross-site` 的写请求 403；两者均无（curl/CLI）保持放行以维持 loopback 便利模式。`server.ts` 在 `corsGuard` 与 `authGuard` 之间接入 `csrfGuard`。

- 测试：五种组合（跨站写拒绝、同源写放行、GET 放行、带 Origin 放行、已配令牌放行、CLI 放行）。

### ✅ L5 · 空串 `OPENAI_API_KEY` 静默降级 mock

修复（`packages/core/src/config.ts`）：空串/空白 `OPENAI_API_KEY` 直接抛 `ConfigError`（不再静默回落 mock）；`provider.kind === "openai"` 但无密钥同样抛 `ConfigError`（"缺必配报可读错误"）。

- 测试：空串 key 与 `kind: "openai"` 无 key 两种场景均断言 `ConfigError` + `CONFIG_INVALID`。

## 3. 一致性 / 可维护性（非阻塞）

- `parsePositiveInt`（`config.ts`）实际返回 number 且允许小数（用于 `MAX_COST_USD`），命名与语义不符；`buildLimits` 中每个字段求值两次，建议抽局部变量。
- `AGENT_LIMIT_MAX_COST_USD=0` 会被当作"未设置"忽略，而 `0` 是合法预算（禁止消费），建议区分。
- P3.3 审计六路齐全，但 `policy-allow` 全量留痕在高频无害工具下会产生大量审计行，建议提供 `auditPolicyAllows` 开关。

## 4. 值得保留的设计

- **脱敏统一兜底**：`AgentRuntime.emit()` 对所有事件统一 `redact(event)`，工具执行仍用真实参数 —— 防漏靠框架而非调用点自觉，是本轮最有效的一处设计。
- **审计不复制密钥**：审批记录只存 `fingerprint()` 排序摘要，不含参数原文。
- **启动期 fail-closed**：`missingTokenWhenExposed` 在非 loopback 绑定且无令牌时拒绝启动。
- **限额是纯数据 + 纯函数**：`RunLimits` + `checkRunLimits` 无时钟无 IO，宿主可做预检与复用。
- **stdio 启动超时 `SIGKILL`**：既修掉了 `node --test` 挂起，也防住了 runaway 子进程。

## 5. 后续动作

1. 第 3 节的三项可维护性建议纳入下一轮清理。
2. MCP 供应链面：DNS rebinding 只能在网络层解决，建议在部署文档中给出 egress 限制建议。
