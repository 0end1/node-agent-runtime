import type { ModelProvider, ModelRequest, ModelResponse, RawToolCall } from "@agent-runtime/core";
import { CURRENCY_ALIASES } from "@agent-runtime/tools-basic";
import type { ChatMessage, ToolCall } from "@agent-runtime/types";
import { newId } from "@agent-runtime/types";

/**
 * A deterministic, KEYLESS model provider for demos / tests / offline runs.
 *
 * It is a tiny "rule-based model": it detects a few intents from the last user
 * turn, issues the right tool calls step by step, and once the tool result comes
 * back it produces a natural-language final answer. This lets the whole runtime
 * (loop, tool validation, events, multi-step reasoning) run with zero setup.
 *
 * Supported intents:
 *   - arithmetic     "3.5 + 2 * 4 = ?"              -> calculator
 *   - time           "现在几点了 / 今天日期"          -> now
 *   - weather        "北京天气怎么样"                 -> geocode -> weather (multi-step)
 *   - currency       "100 美元等于多少人民币"         -> exchange
 *   - otherwise      small canned / reflective chat
 */

const IDLE = 80; // ms "think time" so the demo feels alive

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MockProvider implements ModelProvider {
  readonly id = "mock";
  label = "Mock (rule-based, no API key needed)";

  private readonly nowFn: () => Date;
  private issued = new Map<string, { name: string; args: Record<string, unknown> }>();

  constructor(options: { now?: () => Date } = {}) {
    this.nowFn = options.now ?? (() => new Date());
  }

  async chat(request: ModelRequest): Promise<ModelResponse> {
    await sleep(IDLE);
    const last = request.messages.at(-1);

    // Branch A: the model's previous turn produced tool calls, and the newest
    // message is a tool result. Conclude that pending work.
    if (last?.role === "tool") {
      return this.conclude(last, request);
    }

    // Branch B: a brand new user turn. Detect intent and start work.
    const userMsg = [...request.messages].reverse().find((m) => m.role === "user");
    if (userMsg?.role === "user") {
      return this.startFromUser(userMsg.content, request);
    }

    return this.final("请再说一遍？我可以帮你计算、查时间、看天气或换算汇率。");
  }

  // ------------------------------------------------------------------ intents

  private startFromUser(content: string, request: ModelRequest): ModelResponse {
    const text = content.trim();
    const has = (name: string) => request.tools?.some((t) => t.name === name);

    // 写文件意图（M6-16）：此前规则模型不会调用 `demo_write_file`，导致
    // 「ask 审批 → approve → 沙箱写入」链路在演示与 E2E 中不可达。
    if (
      has("demo_write_file") &&
      /(写文件|写入文件|保存文件|写到|记下来|write\s+file|save\s+file)/i.test(text)
    ) {
      const pathMatch = text.match(/[\w./-]+\.(?:txt|md|json|log)/i);
      const quoted = text.match(/["'“”‘’]([^"'“”‘’]{1,80})["'“”‘’]/);
      return this.toolCallStep(
        "demo_write_file",
        {
          path: pathMatch ? pathMatch[0] : ".demo-out/note.txt",
          content: quoted ? quoted[1]! : "由 MockProvider 写入的演示内容",
        },
        "我来把这段内容写入工作区文件（需要授权）。",
      );
    }

    const mathExpr = has("calculator") ? detectMath(text) : null;
    if (mathExpr) {
      return this.toolCallStep(
        "calculator",
        { expression: mathExpr },
        `我需要调用计算器算出准确结果。`,
      );
    }
    if (
      has("now") &&
      /(现在|当前|几点|时间|日期|几号|星期|today|time|date|what time)/i.test(text)
    ) {
      return this.toolCallStep("now", {}, "我先获取一下当前的时间。");
    }
    if (has("geocode") && has("weather")) {
      const city = detectCity(text);
      if (city) {
        return this.toolCallStep(
          "geocode",
          { city },
          `我来分两步：先解析城市“${city}”的坐标，再查询当地天气。`,
        );
      }
      if (/(天气|气温|weather)/i.test(text)) {
        return this.toolCallStep(
          "geocode",
          { city: "北京" },
          "请告诉我城市，我先按“北京”演示一次坐标解析。",
        );
      }
    }
    if (has("exchange") && /(汇率|兑换|等于多少|换算|exchange|convert)/i.test(text)) {
      const fx = parseExchange(text);
      if (fx) {
        const { amount, from, to } = fx;
        return this.toolCallStep(
          "exchange",
          { amount, from, to },
          `我来查询 ${amount} ${from} → ${to} 的参考汇率。`,
        );
      }
    }

    return this.final(pickChatReply(text));
  }

  // ----------------------------------------------------------------- finalize

  private conclude(
    last: Extract<ChatMessage, { role: "tool" }>,
    _request: ModelRequest,
  ): ModelResponse {
    const pending = this.issued.get(last.toolCallId);
    const content = last.content;
    if (!pending) {
      return this.final(content.length ? `工具返回：${content}` : "工具已执行完成。");
    }
    const { name, args } = pending;
    this.issued.delete(last.toolCallId);

    switch (name) {
      case "calculator": {
        const expr = String(args.expression ?? "");
        const v = safeParse(content);
        const shown =
          v !== null && typeof v === "object" && "formatted" in v
            ? String((v as { formatted: unknown }).formatted)
            : content;
        return this.final(`计算完成：${expr} = ${shown}`);
      }
      case "now": {
        const v = safeParse(content) as Record<string, unknown> | null;
        if (!v) return this.final(`当前时间：${content}`);
        return this.final(
          `现在是 ${v.date}（${v.weekday}）${v.time}，时区 ${v.timezone}，ISO 时间 ${v.iso}。`,
        );
      }
      case "exchange": {
        const v = safeParse(content) as Record<string, unknown> | null;
        if (!v || (v as { error?: string }).error) {
          const err = (v as { error?: string } | null)?.error ?? "换算失败";
          return this.final(err);
        }
        const { amount, from, to, rate, amount_to } = v as {
          amount: number;
          from: string;
          to: string;
          rate: number;
          amount_to: string;
        };
        return this.final(
          `按参考汇率 1 ${from} = ${rate} ${to}，${amount} ${from} ≈ ${amount_to} ${to}。`,
        );
      }
      case "geocode": {
        const city = String(args.city ?? "");
        const v = safeParse(content) as Record<string, unknown> | null;
        if (!v || (v as { error?: string }).error) {
          const err = (v as { error?: string } | null)?.error ?? `无法解析城市`;
          return this.final(
            `抱歉，${err}。可以试试演示城市：北京 / 上海 / 深圳 / 广州 / 杭州 / 东京 / 伦敦 / 纽约。`,
          );
        }
        // Success -> next step: query weather at those coordinates.
        const lat = v.lat as number;
        const lon = v.lon as number;
        return this.toolCallStep(
          "weather",
          { lat, lon, city },
          `已定位“${city}”（${lat}, ${lon}），接下来查询当地天气。`,
        );
      }
      case "demo_write_file": {
        const v = safeParse(content) as { ok?: boolean; path?: string; bytes?: number } | null;
        if (!v?.ok) return this.final(`写入失败：${content}`);
        return this.final(`已写入 ${v.path ?? "文件"}（${v.bytes ?? 0} 字节）。`);
      }
      case "weather": {
        const v = safeParse(content) as Record<string, unknown> | null;
        if (!v || (v as { error?: string }).error) {
          return this.final((v as { error?: string } | null)?.error ?? "天气查询失败");
        }
        const city = args.city ? `“${String(args.city)}”` : "该地";
        const { temperature_C, feels_like_C, condition, humidity_pct, wind_kmh } = v as Record<
          string,
          number
        >;
        return this.final(
          `${city}当前天气：${condition}，气温 ${temperature_C}°C，体感 ${feels_like_C}°C，湿度 ${humidity_pct}%，风速 ${wind_kmh} km/h。`,
        );
      }
      default:
        return this.final(`工具 ${name} 返回：${content}`);
    }
  }

  // ----------------------------------------------------------------- helpers

  private toolCallStep(
    name: string,
    args: Record<string, unknown>,
    reasoning: string,
  ): ModelResponse {
    const call: ToolCall = { id: newId("call"), name, arguments: args };
    this.issued.set(call.id, { name, args });
    return {
      content: reasoning,
      toolCalls: [toRaw(call)],
      finishReason: "tool_calls",
    };
  }

  private final(content: string): ModelResponse {
    return {
      content,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: content.length, outputTokens: content.length },
    };
  }
}

// -------------------------------------------------------------------- helpers

function toRaw(call: ToolCall): RawToolCall {
  return { id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeMath(text: string): string {
  return text
    .replace(/[=?？=]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[×xX]/g, "*")
    .replace(/÷/g, "/")
    .replace(/(\d)\s*加\s*(\d)/g, "$1 + $2")
    .replace(/(\d)\s*(?:减去|减)\s*(\d)/g, "$1 - $2")
    .replace(/(\d)\s*(?:乘以|乘)\s*(\d)/g, "$1 * $2")
    .replace(/(\d)\s*除以\s*(\d)/g, "$1 / $2");
}

/**
 * Extract an arithmetic expression from (mostly) free text.
 * Handles "3.5 + 2 * 4 = ?", "那 4 + 5 呢", "计算 2^10", "2 加 3 乘以 4" etc.
 */
function detectMath(text: string): string | null {
  const normalized = normalizeMath(text);
  if (!/\d/.test(normalized)) return null;

  // Pick the longest contiguous math-ish span that contains a real operator.
  let best: string | null = null;
  for (const span of normalized.matchAll(/[0-9+\-*/^%().\s]+/g)) {
    const expr = span[0].trim();
    if (!expr || !/\d/.test(expr) || !/[+\-*/^%]/.test(expr)) continue;
    if (!best || expr.length > best.length) best = expr;
  }
  if (best) return best;

  // Fallback for explicit Chinese triggers like "计算 2^10"
  if (/(计算|算一下|等于多少|求解)/.test(text)) {
    const m = text.match(/(\d[\d.+\-*/^%()\s]*)/);
    if (m) return normalizeMath(m[1]).trim();
  }
  return null;
}

const CITY_WORDS = [
  "北京",
  "beijing",
  "上海",
  "shanghai",
  "深圳",
  "shenzhen",
  "广州",
  "杭州",
  "成都",
  "东京",
  "tokyo",
  "伦敦",
  "london",
  "纽约",
  "new york",
];

function detectCity(text: string): string | null {
  const lower = text.toLowerCase();
  for (const city of CITY_WORDS) {
    if (lower.includes(city)) return city;
  }
  const m = text.match(/^(.{1,6}?)\s*的?\s*(天气|气温|下雨|温度)/);
  if (m) return m[1]!.trim();
  return null;
}

function parseExchange(text: string): { amount: number; from: string; to: string } | null {
  const amountMatch = text.match(
    /(\d+(?:\.\d+)?)\s*([\u4e00-\u9fa5]+|usd|eur|cny|jpy|gbp|hkd|美元|人民币)/i,
  );
  if (!amountMatch) return null;

  const amount = Number(amountMatch[1]);
  const mentions: string[] = [];
  for (const [alias, code] of Object.entries(CURRENCY_ALIASES)) {
    if (text.includes(alias)) mentions.push(code);
  }
  for (const code of ["USD", "EUR", "CNY", "JPY", "GBP", "HKD"]) {
    if (new RegExp(`\\b${code}\\b`, "i").test(text)) mentions.push(code);
  }
  if (!mentions.length) return null;
  const uniq = [...new Set(mentions)];
  if (uniq.length < 2) return null;
  // From = the currency attached to the amount (leftmost), to = the other one.
  const from = CURRENCY_ALIASES[String(amountMatch[2]).trim()] ?? uniq[0]!;
  const to = uniq.find((c) => c !== from);
  if (!to || !Number.isFinite(amount) || amount <= 0) return null;
  if (to === from) return null;
  return { amount, from, to };
}

function pickChatReply(text: string): string {
  const t = text.toLowerCase();
  if (/(你好|您好|hi|hello|hey)/i.test(t)) {
    return "你好！我是基于 Agent 运行时的演示助手。你可以让我：算一个表达式（如 3.5+2*4）、报当前时间、问城市天气（如“北京天气”），或做汇率换算（如“100美元等于多少人民币”）。";
  }
  if (/(能做什么|会什么|帮助|help|功能)/i.test(t)) {
    return "我挂了 5 个工具：calculator（数学计算）、now（当前时间）、geocode（城市坐标）、weather（天气）、exchange（汇率）。这些能力都由运行时事件循环驱动：模型决定调用 → 运行时校验并执行 → 结果回填 → 继续推理，直到给出最终回答。";
  }
  if (/(who are you|你是谁|你叫什么|介绍)/i.test(t)) {
    return "我是 MockProvider 驱动的最小 Agent。当前 provider 是纯规则实现（免 API Key），换成 OpenAI 兼容服务后同一套运行时即可接入真实 LLM。";
  }
  if (/(谢谢|感谢|thank)/i.test(t)) {
    return "不客气，随时可以再问我。";
  }
  return `我听到了：“${text.slice(0, 80)}”。这个演示 provider 能识别数学、时间、天气、汇率四类意图；更复杂的问题建议配置真实模型（见 README）。`;
}
