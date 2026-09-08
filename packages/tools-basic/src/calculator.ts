/**
 * A safe arithmetic expression evaluator (no eval).
 * Supports + - * / % ^ and parentheses / unary signs / decimals.
 */

type Token =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "lparen" }
  | { t: "rparen" };

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };
const RIGHT_ASSOC = new Set(["^"]);

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/\d|\./.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`非法数字 "${ch}"`);
      const value = Number(m[0]);
      if (!Number.isFinite(value)) throw new Error(`数字超出范围 "${m[0]}"`);
      tokens.push({ t: "num", v: value });
      i += m[0].length;
      continue;
    }
    if ("+-*/%^".includes(ch)) {
      tokens.push({ t: "op", v: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ t: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ t: "rparen" });
      i += 1;
      continue;
    }
    throw new Error(`不支持的字符 "${ch}"`);
  }
  return tokens;
}

/**
 * Evaluate a plain arithmetic expression such as "(3.5 + 2) * 4 ^ 2".
 * @throws Error with a human readable message on any invalid input.
 */
export function evaluate(expression: string): number {
  if (!expression.trim()) throw new Error("表达式为空");
  if (expression.length > 512) throw new Error("表达式过长");

  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function next(): Token | undefined {
    return tokens[pos++];
  }

  function parseUnary(): number {
    const tok = peek();
    if (tok?.t === "op" && (tok.v === "-" || tok.v === "+")) {
      next();
      // Unary minus binds looser than '^' so -2^2 === -(2^2)
      const operand = parseExpr(PREC["^"]!);
      return tok.v === "-" ? -operand : operand;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tok = next();
    if (!tok) throw new Error("表达式不完整");
    if (tok.t === "num") return tok.v;
    if (tok.t === "lparen") {
      const inner = parseExpr(0);
      const closing = next();
      if (!closing || closing.t !== "rparen") throw new Error("缺少右括号 )");
      return inner;
    }
    if (tok.t === "rparen") throw new Error("多余的右括号 )");
    throw new Error(`意外的运算符 "${tok.v}"`);
  }

  function parseExpr(minBp: number): number {
    let left = parseUnary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== "op") break;
      const prec = PREC[tok.v];
      if (prec === undefined || prec < minBp) break;
      next();
      const nextMinBp = RIGHT_ASSOC.has(tok.v) ? prec : prec + 1;
      const right = parseExpr(nextMinBp);
      switch (tok.v) {
        case "+":
          left = left + right;
          break;
        case "-":
          left = left - right;
          break;
        case "*":
          left = left * right;
          break;
        case "/":
          if (right === 0) throw new Error("除数不能为 0");
          left = left / right;
          break;
        case "%":
          if (right === 0) throw new Error("模运算除数不能为 0");
          left = left % right;
          break;
        case "^": {
          const value = Math.pow(left, right);
          if (!Number.isFinite(value)) throw new Error("运算结果超出可表示范围");
          left = value;
          break;
        }
      }
      if (!Number.isFinite(left)) throw new Error("运算结果超出可表示范围");
    }
    return left;
  }

  const result = parseExpr(0);
  if (peek()) throw new Error("存在多余的符号");
  return result;
}
