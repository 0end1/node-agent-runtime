import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConsoleLogger,
  errorPayload,
  toLogger,
  redact,
  RunAbortedError,
  type Logger,
} from "@node-agent-runtime/core";
import { errorInfo, ErrorCode } from "@node-agent-runtime/types";
import { SandboxViolationError } from "@node-agent-runtime/sandbox";

describe("Logger / ConsoleLogger", () => {
  it("filters by level", () => {
    const lines: string[] = [];
    const logger = new ConsoleLogger({ level: "warn", stream: (l) => lines.push(l) });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    assert.deepEqual(lines, ["[node-agent-runtime warn] w", "[node-agent-runtime error] e"]);
  });

  it("serializes meta as JSON", () => {
    const lines: string[] = [];
    const logger = new ConsoleLogger({ level: "debug", stream: (l) => lines.push(l) });
    logger.info("hi", { a: 1 });
    assert.match(lines[0], /hi \{"a":1\}$/);
  });
});

describe("toLogger", () => {
  it("normalizes a legacy callback into a Logger", () => {
    const seen: string[] = [];
    const logger = toLogger((line) => seen.push(line)) as Logger;
    logger.info("x");
    logger.warn("y");
    logger.error("z");
    assert.deepEqual(seen, ["x", "y", "z"]);
    logger.debug("ignored"); // debug is a no-op for legacy callbacks
    assert.equal(seen.length, 3);
  });

  it("returns undefined when input is missing", () => {
    assert.equal(toLogger(undefined), undefined);
  });
});

describe("errorInfo / errorPayload", () => {
  it("maps an error instance carrying a code", () => {
    const info = errorInfo(new SandboxViolationError("nope"));
    assert.equal(info.code, ErrorCode.SANDBOX_VIOLATION);
    assert.equal(info.message, "nope");
  });

  it("falls back to class-name map for legacy errors", () => {
    const info = errorInfo(new RunAbortedError());
    assert.equal(info.code, ErrorCode.RUN_ABORTED);
  });

  it("returns UNKNOWN for arbitrary values", () => {
    assert.equal(errorInfo("boom").code, ErrorCode.UNKNOWN);
    assert.equal(errorInfo({}).code, ErrorCode.UNKNOWN);
  });

  it("errorPayload shapes { error: { code, message } }", () => {
    const payload = errorPayload(new SandboxViolationError("x"));
    assert.deepEqual(payload, { error: { code: ErrorCode.SANDBOX_VIOLATION, message: "x" } });
  });
});

describe("redact (P3.2)", () => {
  it("masks strong-secret keys", () => {
    assert.deepEqual(redact({ apiKey: "sk-123", password: "p" }), {
      apiKey: "***REDACTED***",
      password: "***REDACTED***",
    });
  });

  it("masks weak keys only when the value looks like a secret", () => {
    assert.deepEqual(redact({ key: "sk-abcdefghij" }), { key: "***REDACTED***" });
    assert.deepEqual(redact({ key: "public-key-123" }), { key: "public-key-123" });
  });

  it("masks secret-shaped values (sk-/JWT/base64)", () => {
    assert.deepEqual(redact({ token: "sk-abcdefghij" }), { token: "***REDACTED***" });
    assert.deepEqual(redact({ jwt: "eyJhbGci.eyJzdWIi.SflKxw" }), { jwt: "***REDACTED***" });
  });

  it("leaves ordinary tool args intact", () => {
    assert.deepEqual(redact({ expression: "3.5+2*4", path: ".out/note.txt" }), {
      expression: "3.5+2*4",
      path: ".out/note.txt",
    });
  });

  it("recurses into nested objects and arrays", () => {
    assert.deepEqual(
      redact({ a: { password: "x" }, b: [{ secret: "y" }] }),
      { a: { password: "***REDACTED***" }, b: [{ secret: "***REDACTED***" }] },
    );
  });

  it("masks deep values instead of passing them through (depth limit)", () => {
    let deep: Record<string, unknown> = { password: "sk-abcdefghij" };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    const out = redact(deep);
    // 到达深度上限后整值被脱敏，原文不得出现在输出里
    assert.ok(!JSON.stringify(out).includes("sk-abcdefghij"));
    assert.ok(JSON.stringify(out).includes("***REDACTED***"));
  });

  it("survives circular references", () => {
    const cyclic: Record<string, unknown> = { name: "a" };
    cyclic.self = cyclic;
    const out = redact(cyclic) as Record<string, unknown>;
    assert.equal(out.name, "a");
    assert.equal(out.self, "***REDACTED***");
  });

  it("masks prefixed key names and vendor token shapes", () => {
    assert.deepEqual(redact({ "x-api-key": "abc", "proxy-authorization": "abc" }), {
      "x-api-key": "***REDACTED***",
      "proxy-authorization": "***REDACTED***",
    });
    assert.deepEqual(redact({ note: "ghp_abcdefghijklmnop1234" }), { note: "***REDACTED***" });
    assert.deepEqual(redact({ note: "xoxb-1234567890-abcdef" }), { note: "***REDACTED***" });
  });
});
