import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fmtNumber, newId, stringifyResult } from "../src/util.js";

describe("util: newId", () => {
  it("默认前缀为 id", () => {
    assert.ok(newId().startsWith("id_"));
  });

  it("自定义前缀且每次不同", () => {
    const a = newId("sess");
    const b = newId("sess");
    assert.ok(a.startsWith("sess_"));
    assert.notEqual(a, b);
  });
});

describe("util: stringifyResult", () => {
  it("字符串原样返回", () => {
    assert.equal(stringifyResult("hi"), "hi");
  });

  it("undefined 返回字面量", () => {
    assert.equal(stringifyResult(undefined), "undefined");
  });

  it("对象序列化为 JSON", () => {
    assert.equal(stringifyResult({ a: 1 }), '{"a":1}');
  });

  it("循环引用时回退 String()", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.equal(stringifyResult(cyclic), "[object Object]");
  });
});

describe("util: fmtNumber", () => {
  it("整数直出", () => {
    assert.equal(fmtNumber(42), "42");
  });

  it("消除浮点噪音（0.1+0.2 -> 0.3）", () => {
    assert.equal(fmtNumber(0.1 + 0.2), "0.3");
  });

  it("非有限数直出", () => {
    assert.equal(fmtNumber(Number.NaN), "NaN");
    assert.equal(fmtNumber(Infinity), "Infinity");
  });

  it("超过 1e15 的整数不做科学计数", () => {
    assert.equal(fmtNumber(1e15), "1000000000000000");
  });
});
