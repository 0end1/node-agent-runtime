/**
 * P3.5: Web/本地 console 的鉴权与防跨站决策——纯函数、无 node:http 依赖，
 * 独立于此文件以便用 node:test 做自动化测试（见 security.test.ts）。
 *
 * 策略（默认收紧）：
 *  1. 仅 loopback 监听且未设令牌时，本机无凭据可用（本地 console 便利）；
 *  2. 显式监听非 loopback 地址而缺令牌 → 拒绝启动（不把无鉴权控制台暴露到网络）；
 *  3. 设置 AGENT_API_TOKEN 后所有非本机/跨源请求需 `Authorization: Bearer`；
 *  4. 浏览器跨站（Origin 非 loopback 且不在白名单）一律 403。
 */

export interface SecurityConfig {
  token: string;
  corsAllow: string[];
}

export type GuardDecision = { allow: true } | { allow: false; status: 401 | 403; error: string };

/** A hostname that can only mean "this machine". `0.0.0.0` is a bind address,
 *  not an origin host, so it must NOT be treated as a safe peer origin. */
export function isLoopbackHost(host: string): boolean {
  return /^(127\.0\.0\.1|::1|localhost)$/i.test(host);
}

/** 绑定地址是否需要强制鉴权（非 loopback 监听 = 对外暴露）。 */
export function requiresTokenToBind(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed || trimmed === "0.0.0.0" || trimmed === "::") return true;
  return !isLoopbackHost(trimmed);
}

/** Return the refusal reason (null = safe to start with no token). */
export function missingTokenWhenExposed(host: string, token: string): string | null {
  if (requiresTokenToBind(host) && !token) {
    return `HOST（${host}）不是 loopback，必须设置 AGENT_API_TOKEN 才能对外提供控制台。`;
  }
  return null;
}

/** CORS / CSRF 决策：无 Origin 放行；loopback 或白名单来源放行；其余 403。 */
export function decideCors(origin: string | undefined, allowlist: readonly string[]): GuardDecision {
  if (!origin) return { allow: true };
  try {
    const u = new URL(origin);
    if (isLoopbackHost(u.hostname)) return { allow: true };
    if (allowlist.includes(u.origin) || allowlist.includes(origin)) return { allow: true };
  } catch {
    // 非法 Origin 字符串按拒绝处理。
  }
  return { allow: false, status: 403, error: "跨站请求被拒绝（CORS）" };
}

/** 令牌决策：未配置令牌 → 放行（仅本机场景可达，见 missingTokenWhenExposed）；
 *  否则要求 `Authorization: Bearer <token>` 精确匹配。 */
export function decideAuth(
  authorization: string | undefined,
  token: string,
): GuardDecision {
  if (!token) return { allow: true };
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (m && m[1].trim() === token) return { allow: true };
  return { allow: false, status: 401, error: "需要 Bearer 令牌" };
}
