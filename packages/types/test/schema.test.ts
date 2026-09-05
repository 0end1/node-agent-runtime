import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validate, type JsonSchema } from "@agent-runtime/types";

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
