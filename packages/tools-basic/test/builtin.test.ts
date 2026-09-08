import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AnyTool, ToolExecutionContext } from "@agent-runtime/types";
import { builtinTools } from "../src/index.js";

const ctx: ToolExecutionContext = {
  conversationId: "conv",
  runId: "run",
  now: () => new Date(0),
};

function tool(name: string): AnyTool {
  const found = builtinTools.find((t) => t.name === name);
  assert.ok(found, `未找到内置工具：${name}`);
  return found as unknown as AnyTool;
}

describe("builtinTools 装配", () => {
  it("暴露五个演示工具且命名稳定", () => {
    assert.deepEqual(
      builtinTools.map((t) => t.name),
      ["calculator", "now", "geocode", "weather", "exchange"],
    );
  });

  it("每个工具都有描述与参数 schema", () => {
    for (const t of builtinTools) {
      assert.ok(t.description.length > 0, `${t.name} 缺少描述`);
      assert.equal(t.parameters?.type, "object");
    }
  });
});

describe("calculator", () => {
  it("计算表达式并给出格式化结果", () => {
    const out = tool("calculator").execute({ expression: "(3.5 + 2) * 4" }, ctx) as {
      result: number;
      formatted: string;
    };
    assert.equal(out.result, 22);
    assert.equal(out.formatted, "22");
  });
});

describe("now", () => {
  it("返回 ISO / 日期 / 星期 / 时间 / 时区 / epoch", () => {
    const out = tool("now").execute({}, ctx) as Record<string, unknown>;
    assert.equal(out.iso, new Date(0).toISOString());
    assert.equal(out.epochMs, 0);
    assert.equal(typeof out.date, "string");
    assert.equal(typeof out.weekday, "string");
    assert.equal(typeof out.time, "string");
    assert.equal(typeof out.timezone, "string");
  });
});

describe("geocode", () => {
  it("命中城市返回经纬度", () => {
    const out = tool("geocode").execute({ city: "北京" }, ctx) as Record<string, unknown>;
    assert.equal(out.city, "北京");
    assert.equal(out.country, "中国");
    assert.equal(out.lat, 39.9042);
  });

  it("未收录城市返回 error", () => {
    const out = tool("geocode").execute({ city: "火星" }, ctx) as Record<string, unknown>;
    assert.match(String(out.error), /未收录城市/);
  });
});

describe("weather", () => {
  it("按经纬度给出确定性天气", () => {
    const out = tool("weather").execute({ lat: 39.9042, lon: 116.4074 }, ctx) as Record<
      string,
      number | string
    >;
    const temp = out.temperature_C as number;
    assert.ok(temp >= 10 && temp <= 28, `温度越界：${temp}`);
    assert.equal(typeof out.condition, "string");
    assert.ok((out.humidity_pct as number) >= 35);
    assert.ok((out.wind_kmh as number) >= 3);
  });

  it("非数字经纬度返回 error", () => {
    const out = tool("weather").execute({ lat: "abc", lon: 0 }, ctx) as Record<string, unknown>;
    assert.match(String(out.error), /经纬度必须是数字/);
  });
});

describe("exchange", () => {
  it("按参考汇率换算", () => {
    const out = tool("exchange").execute({ amount: 100, from: "USD", to: "CNY" }, ctx) as Record<
      string,
      unknown
    >;
    assert.equal(out.rate, 7.15);
    assert.equal(out.amount_to, "715");
  });

  it("同币种换算为 1", () => {
    const out = tool("exchange").execute({ amount: 8, from: "usd", to: "USD" }, ctx) as Record<
      string,
      unknown
    >;
    assert.equal(out.rate, 1);
    assert.equal(out.from, "USD");
  });

  it("负数金额返回 error", () => {
    const out = tool("exchange").execute({ amount: -1, from: "USD", to: "CNY" }, ctx) as Record<
      string,
      unknown
    >;
    assert.match(String(out.error), /金额必须是非负数/);
  });

  it("不支持的币种返回 error", () => {
    const badFrom = tool("exchange").execute({ amount: 1, from: "XYZ", to: "CNY" }, ctx) as Record<
      string,
      unknown
    >;
    assert.match(String(badFrom.error), /不支持的源币种/);

    const badTo = tool("exchange").execute({ amount: 1, from: "USD", to: "XYZ" }, ctx) as Record<
      string,
      unknown
    >;
    assert.match(String(badTo.error), /不支持的目标币种/);
  });
});
