import { evaluate } from "./calculator.js";
import { defineTool } from "@agent-runtime/core";
import { fmtNumber } from "@agent-runtime/types";

/** Evaluate arithmetic expressions, e.g. "(3.5 + 2) * 4". */
const calculatorTool = defineTool({
  name: "calculator",
  description:
    "计算一个纯数学表达式并返回数值结果。支持 + - * / % ^（乘方）、括号、小数与一元正负号，例如 (3.5 + 2) * 4 或 2 ^ 10。",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "要计算的数学表达式，仅允许数字与 + - * / % ^ ( ) 等符号",
      },
    },
    required: ["expression"],
  },
  execute(args: { expression: string }) {
    const result = evaluate(String(args.expression ?? ""));
    return { result, formatted: fmtNumber(result) };
  },
});

/** Get the current wall-clock time. */
const nowTool = defineTool({
  name: "now",
  description: "获取当前本地日期与时间（年/月/日、星期、时分秒、ISO 时间戳）。",
  parameters: {
    type: "object",
    properties: {},
  },
  execute(_args, ctx) {
    const d = ctx.now();
    const iso = d.toISOString();
    const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(d);
    const dateStr = d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return {
      iso,
      date: dateStr,
      weekday,
      time: timeStr,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      epochMs: d.getTime(),
    };
  },
});

/** Static city -> (lat,lon) gazetteer for the demo. */
const GAZETTEER: Record<string, { lat: number; lon: number; country: string }> = {
  北京: { lat: 39.9042, lon: 116.4074, country: "中国" },
  beijing: { lat: 39.9042, lon: 116.4074, country: "中国" },
  上海: { lat: 31.2304, lon: 121.4737, country: "中国" },
  shanghai: { lat: 31.2304, lon: 121.4737, country: "中国" },
  深圳: { lat: 22.5431, lon: 114.0579, country: "中国" },
  shenzhen: { lat: 22.5431, lon: 114.0579, country: "中国" },
  广州: { lat: 23.1291, lon: 113.2644, country: "中国" },
  杭州: { lat: 30.2741, lon: 120.1551, country: "中国" },
  成都: { lat: 30.5728, lon: 104.0668, country: "中国" },
  东京: { lat: 35.6762, lon: 139.6503, country: "日本" },
  tokyo: { lat: 35.6762, lon: 139.6503, country: "日本" },
  伦敦: { lat: 51.5074, lon: -0.1278, country: "英国" },
  london: { lat: 51.5074, lon: -0.1278, country: "英国" },
  纽约: { lat: 40.7128, lon: -74.006, country: "美国" },
  "new york": { lat: 40.7128, lon: -74.006, country: "美国" },
};

/** Resolve a city name to coordinates. */
const geocodeTool = defineTool({
  name: "geocode",
  description: "把城市名称解析为经纬度坐标，用于后续查询天气等场景。",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "城市名称，例如：北京 / beijing" },
    },
    required: ["city"],
  },
  execute(args: { city: string }) {
    const key = String(args.city ?? "").trim().toLowerCase();
    const hit = GAZETTEER[key];
    if (!hit) {
      return { error: `未收录城市 "${key}"`, city: key };
    }
    return { city: key, country: hit.country, lat: hit.lat, lon: hit.lon };
  },
});

const CONDITIONS = ["晴", "多云", "阴", "小雨", "雷阵雨"] as const;

/** Deterministic pseudo weather so the demo is reproducible offline. */
const weatherTool = defineTool({
  name: "weather",
  description: "根据经纬度查询当地当前天气（温度、体感、天气状况、湿度、风速）。",
  parameters: {
    type: "object",
    properties: {
      lat: { type: "number", description: "纬度" },
      lon: { type: "number", description: "经度" },
    },
    required: ["lat", "lon"],
  },
  execute(args: { lat: number; lon: number }) {
    const lat = Number(args.lat);
    const lon = Number(args.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { error: "经纬度必须是数字" };
    }
    const h = Math.floor((Math.abs(lat) * 7 + Math.abs(lon) * 13) % 97);
    const tempC = Math.round(10 + (h % 19)); // 10..28
    const feels = tempC + ((h % 5) - 2);
    const condition = CONDITIONS[h % CONDITIONS.length];
    const humidity = Math.round(35 + (h % 55));
    const windKmh = Math.round(3 + (h % 22));
    return {
      temperature_C: tempC,
      condition,
      feels_like_C: feels,
      humidity_pct: humidity,
      wind_kmh: windKmh,
    };
  },
});

/** Static demo FX rates (per 1 base -> quote), deterministic. */
const RATES: Record<string, Record<string, number>> = {
  USD: { CNY: 7.15, EUR: 0.92, JPY: 147.5, GBP: 0.79, HKD: 7.8, USD: 1 },
  CNY: { USD: 0.14, EUR: 0.129, JPY: 20.63, GBP: 0.11, HKD: 1.09, CNY: 1 },
  EUR: { USD: 1.086, CNY: 7.77, JPY: 160.3, GBP: 0.86, HKD: 8.47, EUR: 1 },
  JPY: { USD: 0.00678, CNY: 0.0485, EUR: 0.00624, GBP: 0.00535, HKD: 0.0529, JPY: 1 },
  GBP: { USD: 1.263, CNY: 9.03, EUR: 1.163, JPY: 186.9, HKD: 9.85, GBP: 1 },
  HKD: { USD: 0.128, CNY: 0.917, EUR: 0.118, JPY: 18.9, GBP: 0.1015, HKD: 1 },
};

export type CurrencyCode = keyof typeof RATES;

export const CURRENCY_ALIASES: Record<string, CurrencyCode> = {
  美元: "USD",
  美金: "USD",
  人民币: "CNY",
  日元: "JPY",
  日圆: "JPY",
  欧元: "EUR",
  英镑: "GBP",
  港币: "HKD",
  港元: "HKD",
};

/** Convert a currency amount at static reference rates. */
const exchangeTool = defineTool({
  name: "exchange",
  description:
    "按参考汇率换算货币金额。币种支持：USD 美元、CNY 人民币、EUR 欧元、JPY 日元、GBP 英镑、HKD 港币。",
  parameters: {
    type: "object",
    properties: {
      amount: { type: "number", description: "要换算的金额" },
      from: {
        type: "string",
        description: "源币种代码（如 USD）",
        enum: Object.keys(RATES),
      },
      to: {
        type: "string",
        description: "目标币种代码（如 CNY）",
        enum: Object.keys(RATES),
      },
    },
    required: ["amount", "from", "to"],
  },
  execute(args: { amount: number; from: CurrencyCode; to: CurrencyCode }) {
    const amount = Number(args.amount);
    const from = String(args.from).toUpperCase() as CurrencyCode;
    const to = String(args.to).toUpperCase() as CurrencyCode;
    if (!Number.isFinite(amount) || amount < 0) {
      return { error: "金额必须是非负数" };
    }
    const table = RATES[from];
    if (!table) return { error: `不支持的源币种 "${from}"` };
    const rate = table[to];
    if (rate === undefined) return { error: `不支持的目标币种 "${to}"` };
    return {
      amount,
      from,
      to,
      rate,
      amount_to: fmtNumber(Math.round(amount * rate * 100) / 100),
    };
  },
});

/** Built-in demo tools ready to attach to an agent. */
export const builtinTools = [
  calculatorTool,
  nowTool,
  geocodeTool,
  weatherTool,
  exchangeTool,
];
