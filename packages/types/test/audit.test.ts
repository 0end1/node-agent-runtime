import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fingerprint } from "../src/util.js";

describe("fingerprint (P3.3 audit-safe argument digest)", () => {
  it("is stable for the same object regardless of key order", () => {
    const a = fingerprint({ token: "sk-x", nested: { b: 1, a: [1, 2] } });
    const b = fingerprint({ nested: { a: [1, 2], b: 1 }, token: "sk-x" });
    assert.equal(a, b);
    assert.ok(a.length > 0);
  });

  it("never embeds the raw value", () => {
    const secret = "sk-0123456789abcdef";
    const digest = fingerprint({ password: secret });
    assert.ok(!digest.includes("sk-"));
    assert.ok(digest.includes("-")); // <hash>-<len>
  });

  it("differs across values", () => {
    assert.notEqual(fingerprint("a"), fingerprint("b"));
    assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  });

  it("ignores undefined keys so partial payloads hash consistently", () => {
    assert.equal(fingerprint({ a: 1, b: undefined }), fingerprint({ a: 1 }));
  });
});
