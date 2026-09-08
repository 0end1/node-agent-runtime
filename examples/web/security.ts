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

import { timingSafeEqual } from "node:crypto";

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

/** Preflight (OPTIONS) answer for `origin`. Allowlisted origins must get a
 *  *usable* 204 — echoing no CORS headers would make the allowlist a no-op. */
export interface PreflightResponse {
  status: 204 | 403;
  headers: Record<string, string>;
  /** JSON error body, set only when refused. */
  body?: string;
}

export function decidePreflight(
  origin: string | undefined,
  allowlist: readonly string[],
  allowedMethods = "GET, POST, OPTIONS",
): PreflightResponse {
  const decision = decideCors(origin, allowlist);
  if (!decision.allow) {
    return {
      status: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: decision.error }),
    };
  }
  const headers: Record<string, string> = {
    "access-control-max-age": "600",
    "access-control-allow-methods": allowedMethods,
    "access-control-allow-headers": "content-type, authorization",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "Origin";
  }
  return { status: 204, headers };
}

/** 令牌决策：未配置令牌 → 放行（仅本机场景可达，见 missingTokenWhenExposed）；
 *  否则要求 `Authorization: Bearer <token>` 精确匹配。 */
/** Constant-time comparison so a wrong token cannot be probed byte by byte. */
function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still burn one comparison of equal length before bailing out.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function decideAuth(
  authorization: string | undefined,
  token: string,
): GuardDecision {
  if (!token) return { allow: true };
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (m && tokensEqual(m[1].trim(), token)) return { allow: true };
  return { allow: false, status: 401, error: "需要 Bearer 令牌" };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF backstop for tokenless (loopback) deployments (P3.5).
 *
 * `decideCors` can only judge requests that carry an `Origin`. Modern browsers
 * also send `Sec-Fetch-Site`, so a cross-site state-changing request that
 * somehow has no `Origin` is still refused. Requests with neither header (curl,
 * CLI scripts) are allowed — that is the documented loopback convenience mode.
 */
export function decideCsrf(input: {
  method?: string;
  origin?: string;
  secFetchSite?: string;
  hasToken: boolean;
}): GuardDecision {
  // With a token configured `decideAuth` already demands a Bearer header that
  // a cross-site page cannot forge.
  if (input.hasToken) return { allow: true };
  if (SAFE_METHODS.has((input.method ?? "GET").toUpperCase())) return { allow: true };
  if (input.origin) return { allow: true }; // already vetted by decideCors
  if (input.secFetchSite?.toLowerCase() === "cross-site") {
    return { allow: false, status: 403, error: "跨站请求被拒绝（CSRF）" };
  }
  return { allow: true };
}
