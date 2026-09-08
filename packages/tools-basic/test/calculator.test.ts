import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "@agent-runtime/tools-basic";

describe("calculator (safe arithmetic)", () => {
  it("evaluates precedence & parentheses", () => {
    assert.equal(evaluate("2 + 3 * 4"), 14);
    assert.equal(evaluate("(2 + 3) * 4"), 20);
    assert.equal(evaluate("2 ^ 3 ^ 2"), 512); // right assoc
    assert.equal(evaluate("-2 ^ 2"), -4); // pow binds tighter than unary minus
    assert.equal(evaluate("3 * -2"), -6);
    assert.equal(evaluate("(3.5 + 2) * 4"), 22);
    assert.equal(evaluate("10 % 3"), 1);
    assert.equal(evaluate("2e2 + 1"), 201);
  });

  it("rejects unsafe / malformed input (no eval)", () => {
    assert.throws(() => evaluate("process.exit(1)"));
    assert.throws(() => evaluate("1/0"));
    assert.throws(() => evaluate("(2+3"));
    assert.throws(() => evaluate("2+"));
    assert.throws(() => evaluate(""));
    assert.throws(() => evaluate("2**3"));
  });
});
