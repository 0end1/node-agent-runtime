import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validate, validateSchema, type JsonSchema } from "@node-agent-runtime/types";

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
    assert.deepEqual(
      validate({ amount: 12.5, from: "USD", tags: ["a"], meta: { note: "x" } }, schema),
      [],
    );
  });

  it("reports missing required fields", () => {
    const errors = validate({ amount: 1 }, schema);
    assert.ok(errors.some((e) => e.includes("from")));
  });

  it("reports type & enum violations with paths", () => {
    const errors = validate({ amount: "x", from: "GBP" }, schema);
    assert.ok(
      errors.some((e) => e.includes("$.amount")),
      `errors: ${errors.join(" | ")}`,
    );
    assert.ok(
      errors.some((e) => e.includes("$.from")),
      `errors: ${errors.join(" | ")}`,
    );
  });

  it("checks nested array items", () => {
    const errors = validate({ amount: 1, from: "USD", tags: ["ok", 42] }, schema);
    assert.ok(errors.some((e) => e.includes("$.tags[1]")));
  });
});

// M7-5 (docs/m7-base-governance.md §8-11): a wrong *schema* never fails loudly
// at run time — the model just keeps calling the tool wrong. `validateSchema`
// checks the contract itself, so recipes can be rejected at compile time.
describe("validateSchema (schema itself, not a value)", () => {
  it("accepts a well-formed schema", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { q: { type: "string" }, n: { type: "integer", minimum: 1, maximum: 5 } },
      required: ["q"],
      additionalProperties: false,
    };
    assert.deepEqual(validateSchema(schema), []);
  });

  it("accepts the open-ended {} schema", () => {
    assert.deepEqual(validateSchema({}), []);
  });

  it("rejects an unknown type", () => {
    const errors = validateSchema({ type: "strng" } as unknown as JsonSchema);
    assert.ok(errors.some((e) => e.includes("未知 type")), errors.join(" | "));
  });

  it("rejects an empty type array", () => {
    const errors = validateSchema({ type: [] } as unknown as JsonSchema);
    assert.ok(errors.length > 0);
  });

  it("rejects `required` naming a property that is not defined", () => {
    const errors = validateSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", "b"],
    });
    assert.ok(errors.some((e) => e.includes('"b"')), errors.join(" | "));
  });

  it("rejects minimum > maximum", () => {
    const errors = validateSchema({ type: "number", minimum: 10, maximum: 1 });
    assert.ok(errors.some((e) => e.includes("minimum")), errors.join(" | "));
  });

  it("rejects a non-string-array `required`", () => {
    const errors = validateSchema({
      type: "object",
      required: "a",
    } as unknown as JsonSchema);
    assert.ok(errors.some((e) => e.includes("required")), errors.join(" | "));
  });

  it("descends into properties and items with paths", () => {
    const errors = validateSchema({
      type: "object",
      properties: { tags: { type: "array", items: { type: "nope" } } },
    } as unknown as JsonSchema);
    assert.ok(errors.some((e) => e.includes("$.tags.items")), errors.join(" | "));
  });

  it("rejects a non-boolean additionalProperties", () => {
    const errors = validateSchema({
      type: "object",
      additionalProperties: "yes",
    } as unknown as JsonSchema);
    assert.ok(errors.some((e) => e.includes("additionalProperties")), errors.join(" | "));
  });

  it("terminates on pathological nesting instead of recursing forever", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 40; i++) schema = { type: "object", properties: { x: schema } };
    const errors = validateSchema(schema as unknown as JsonSchema);
    assert.ok(errors.some((e) => e.includes("嵌套过深")), errors.join(" | "));
  });
});
