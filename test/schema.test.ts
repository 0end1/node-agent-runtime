import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate } from "../src/tools/calculator.js";
import { validate, type JsonSchema } from "../src/schema.js";

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

describe("schema validation (subset)", () => {
  const schema = {
    type: "object",
    properties: {
      amount: { type: "number", minimum: 0 },
      from: { type: "string", enum: ["USD", "CNY", "EUR"] },
      tags: { type: "array", items: { type: "string" } },
      meta: { type: "object", properties: { note: { type: "string" } } },
    },
    required: ["amount", "from"],
  } satisfies JsonSchema;

  it("accepts a valid payload", () => {
    assert.deepEqual(validate({ amount: 12.5, from: "USD", tags: ["a"], meta: { note: "x" } }, schema), []);
  });

  it("reports missing required fields", () => {
    const errors = validate({ amount: 1 }, schema);
    assert.ok(errors.some((e) => e.includes("from")));
  });

  it("reports type & enum violations with paths", () => {
    const errors = validate({ amount: "x", from: "GBP" }, schema);
    assert.ok(errors.some((e) => e.includes("$.amount")), `errors: ${errors.join(" | ")}`);
    assert.ok(errors.some((e) => e.includes("$.from")), `errors: ${errors.join(" | ")}`);
  });

  it("checks nested array items", () => {
    const errors = validate({ amount: 1, from: "USD", tags: ["ok", 42] }, schema);
    assert.ok(errors.some((e) => e.includes("$.tags[1]")));
  });
});
