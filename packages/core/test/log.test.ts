import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConsoleLogger,
  errorPayload,
  toLogger,
  RunAbortedError,
  type Logger,
} from "@agent-runtime/core";
import { errorInfo, ErrorCode } from "@agent-runtime/types";
import { SandboxViolationError } from "@agent-runtime/sandbox";

describe("Logger / ConsoleLogger", () => {
  it("filters by level", () => {
    const lines: string[] = [];
    const logger = new ConsoleLogger({ level: "warn", stream: (l) => lines.push(l) });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    assert.deepEqual(lines, ["[agent-runtime warn] w", "[agent-runtime error] e"]);
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
