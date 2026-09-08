import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideAuth,
  decideCors,
  isLoopbackHost,
  missingTokenWhenExposed,
} from "./security.js";

describe("P3.5 security guard", () => {
  it("isLoopbackHost: 只认 127.0.0.1/::1/localhost", () => {
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("0.0.0.0"), false); // 绑定位，不是可信来源
    assert.equal(isLoopbackHost("192.168.1.10"), false);
  });

  it("missingTokenWhenExposed: 非 loopback 监听无令牌 → 拒绝启动", () => {
    assert.ok(missingTokenWhenExposed("0.0.0.0", ""));
    assert.ok(missingTokenWhenExposed("::", ""));
    assert.ok(missingTokenWhenExposed("192.168.1.10", ""));
    assert.equal(missingTokenWhenExposed("0.0.0.0", "sk-live"), null);
    assert.equal(missingTokenWhenExposed("127.0.0.1", ""), null);
    assert.equal(missingTokenWhenExposed("localhost", ""), null);
  });

  it("decideCors: 无 Origin 放行，loopback 放行，跨站 403，白名单放行", () => {
    assert.deepEqual(decideCors(undefined, []), { allow: true });
    assert.deepEqual(decideCors("http://127.0.0.1:5173", []), { allow: true });
    assert.deepEqual(decideCors("http://localhost:5173", []), { allow: true });
    const evil = decideCors("https://evil.example", []);
    assert.equal(evil.allow, false);
    assert.equal((evil as { status: number }).status, 403);
    assert.deepEqual(decideCors("https://console.example", ["https://console.example"]), {
      allow: true,
    });
    assert.deepEqual(decideCors("not-a-url", []).allow, false);
  });

  it("decideAuth: 未配置令牌放行；配置后要求精确 Bearer", () => {
    assert.deepEqual(decideAuth(undefined, ""), { allow: true });
    assert.deepEqual(decideAuth("Bearer correct-token", "correct-token"), { allow: true });
    const bad = decideAuth("Bearer wrong", "correct-token");
    assert.equal(bad.allow, false);
    assert.equal((bad as { status: number }).status, 401);
    assert.equal(decideAuth(undefined, "correct-token").allow, false);
  });
});
