# P3 安全与可观测性 —— 代码评审（2026-09-08）

评审范围：P3.1 ~ P3.8（M6-18 `e7e8e53` + M6-19 `6883bc6`），对照 `docs/m6-productionization.md` §3 的验收口径。

初评发现 8 项问题（1 中高危 / 2 中 / 5 低）。**H1、M1、M2、L3 已于评审后同日修复**，其余低危项转入后续加固。

复跑现状（修后）：`eslint` 干净 · `npm run check:api` 零差异 · 全量 217 用例 0 失败（3 例为既有 skip）。

## 0. 结论

功能面已闭环：八项均有实现与自动化测试，默认收紧方向正确（fail-closed 启动校验、脱敏统一兜底、审计只留指纹）。

初评的验收口径偏差已修正。修复后 P3.4 / P3.5 / P3.6 与验收口径严格对齐，**Gate 3 结论成立**。

| 级别 | 项 | 状态 |
| --- | --- | --- |
| 中高危（防护可绕过） | H1 MCP 白名单可被 30x 重定向绕过 | ✅ 已修 |
| 中（与验收不符） | M1 `maxSteps` 超限不产 `run:error` | ✅ 已修 |
| 中（与验收不符） | M2 CORS 预检缺响应头（拒得住、放不开） | ✅ 已修 |
| 低 | L1 `redact` 深度 > 8 不脱敏 | ⏸ 待办 |
| 低 | L2 强密钥 key 白名单漏带前缀形式 | ⏸ 待办 |
| 低 | L3 stdio 子进程继承完整 `process.env` | ✅ 已修 |
| 低 | L4 令牌非恒定时间比较 + 无 Origin 放行 | ⏸ 待办 |
| 低 | L5 空串 `OPENAI_API_KEY` 静默降级 mock | ⏸ 待办 |

---

## 1. 已修复项

### ✅ H1 · P3.6 MCP 白名单可被 30x 重定向绕过（SSRF）

原 `post()` 直接 `fetch` 而未设 `redirect`（默认 `follow`），URL 只在构造时校验一次 —— 白名单内的端点返回 `302 → http://169.254.169.254/...` 即被跟随并读回响应。

修复（`packages/mcp/src/transport.ts`）：

- 新增 `requestOnce()`：单次请求强制 `redirect: "manual"`。
- 新增 `requestWithGuardedRedirects()`：手动跟随，**每一跳都重新过 `validateMcpServerUrl`**（协议 + 白名单），跳数上限 `MAX_REDIRECTS = 3`，超额或非法 `location` 直接 `McpConnectionError`。
- `notify()` 同样改用 `requestOnce()`，并拒绝跟随 3xx。
- 测试：`重定向到内网地址 → 拒绝且从未真正请求该地址`；`白名单内重定向 → 正常跟随并完成调用`。

> 边界：DNS rebinding（域名先解析到白名单 IP、再重绑定到内网）无法在 fetch 层拦截，需在网络层（egress 代理 / 防火墙）兜底。

### ✅ M1 · P3.4 `maxSteps` 超限不产 `run:error`

原 `runtime.ts` 把 `limits.maxSteps` 同时当循环上界，使 `checkRunLimits` 的 `steps > maxSteps` 恒为假 —— 触及上限按"自然结束"处理，无 `run:error`、无 `limit_exceeded`。

修复（`packages/core/src/runtime.ts`）：循环上界固定为 `agent.maxSteps`（软停止），`limits.maxSteps` 作为**独立预算**：越界的那一步抛 `LimitExceededError`，经既有 catch 发出 `run:error` + `code: limit_exceeded`。

- 测试：`limits: { maxSteps: 1 }` + 永不收敛的 provider → 断言 reject `LimitExceededError`，且事件流含 `run:error` 且 `code === "limit_exceeded"`。

### ✅ M2 · P3.5 CORS 预检缺少响应头

原 OPTIONS 分支只回 204 + `Access-Control-Max-Age`，缺 `ACAO/ACAM/ACAH` 且未校验 Origin —— 白名单来源的非简单请求预检必失败。

修复：`examples/web/security.ts` 新增纯函数 `decidePreflight(origin, allowlist, allowedMethods?)`（复用 `decideCors`），放行时回 `ACAO` 回显 + `ACAM: GET, POST, OPTIONS` + `ACAH: content-type, authorization` + `Vary: Origin`，拒绝时 403 + JSON 错误体；`server.ts` OPTIONS 分支改为调用它。

- 测试：白名单 / loopback / 无 Origin / 跨站四种预检场景。

### ✅ L3 · P3.6 stdio 子进程继承完整 `process.env`

原 `env: { ...process.env, ...this.env }` 会把宿主全部凭据暴露给 MCP server。

修复（`packages/mcp/src/transport.ts`）：`buildChildEnv()` 默认只透传 `MINIMAL_ENV_KEYS`（`PATH`/`HOME`/`TMP*`/`SystemRoot`/`LANG` 等）+ 显式 `env`（即 `config.mcp.serverEnv`）；新增 `inheritEnv?: boolean` 供可信 server 显式放开。

- 测试：默认拿不到宿主注入变量；显式注入生效；`inheritEnv: true` 时继承。

---

## 2. 待办（低危，非阻塞）

- **L1 · `redact` 深度 > 8 直接返回原值**（`core/src/log.ts:75`）：第 9 层及以下的密钥不脱敏。建议达上限时整值替换为 `REDACTED`，并改用 `WeakSet` 显式防环。
- **L2 · 强密钥 key 漏带前缀形式**（`log.ts:62`）：`STRONG_SECRET_KEY` 以 `^` 锚定，`x-api-key`、`proxy-authorization` 不匹配，仅靠 `SECRET_VALUE`（`sk-` / JWT / base64）兜底；`ghp_`、`xoxb-`、`AIza` 及纯 32 位十六进制会漏。建议改包含式匹配或补前缀。
- **L4 · 令牌比较非恒定时间 + 无 Origin 放行**（`security.ts:61`）：换 `crypto.timingSafeEqual`；`/api/approve`、`/api/deny` 等状态变更接口在无 `Origin` 且无令牌时应拒绝，或校验 `Sec-Fetch-Site`。
- **L5 · 空串 `OPENAI_API_KEY` 静默降级 mock**（`config.ts:174`）：显式判空并抛 `ConfigError` 或告警。

## 3. 一致性 / 可维护性（非阻塞）

- `parsePositiveInt`（`config.ts:73`）实际返回 number 且允许小数（用于 `MAX_COST_USD`），命名与语义不符；`buildLimits` 中每个字段求值两次，建议抽局部变量。
- `AGENT_LIMIT_MAX_COST_USD=0` 会被当作"未设置"忽略，而 `0` 是合法预算（禁止消费），建议区分。
- P3.3 审计六路齐全，但 `policy-allow` 全量留痕在高频无害工具下会产生大量审计行，建议提供 `auditPolicyAllows` 开关。

## 4. 值得保留的设计

- **脱敏统一兜底**：`AgentRuntime.emit()` 对所有事件统一 `redact(event)`（`runtime.ts`），工具执行仍用真实参数 —— 防漏靠框架而非调用点自觉，是本轮最有效的一处设计。
- **审计不复制密钥**：审批记录只存 `fingerprint()` 排序摘要（`types/util.ts`），不含参数原文。
- **启动期 fail-closed**：`missingTokenWhenExposed` 在非 loopback 绑定且无令牌时拒绝启动，而非运行中兜底。
- **限额是纯数据 + 纯函数**：`RunLimits` + `checkRunLimits` 无时钟无 IO，宿主可做预检与复用。
- **stdio 启动超时 `SIGKILL`**：既修掉了 `node --test` 挂起，也防住了 runaway 子进程。

## 5. 后续动作

1. L1 / L2 / L4 / L5 纳入下一轮安全加固。
2. MCP 供应链面可继续补：DNS rebinding 只能在网络层解决，建议在部署文档中给出 egress 限制建议。
