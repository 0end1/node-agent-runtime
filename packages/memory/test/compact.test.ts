import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "@node-agent-runtime/types";
import {
  compactMessages,
  countMessagesTokens,
  estimateTokens,
} from "@node-agent-runtime/memory";

const big = (s: string): string => s.repeat(200); // ≈100 tokens each

function turn(i: number, withTool = false): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: "user", content: big(`user${i}`) },
    { role: "assistant", content: big(`assist${i}`) },
  ];
  if (withTool) {
    msgs[1] = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: `call_${i}`, name: "search", arguments: {} }],
    };
    msgs.push({ role: "tool", toolCallId: `call_${i}`, content: big(`result${i}`) });
  }
  return msgs;
}

function manyTurns(n: number, withTool = false): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i++) out.push(...turn(i, withTool));
  return out;
}

describe("estimateTokens / countMessagesTokens (M7-1)", () => {
  it("字符/4 向上取整", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2);
  });
  it("统计整段消息 token", () => {
    assert.ok(countMessagesTokens(manyTurns(1)) > 0);
  });
});

describe("compactMessages (M7-1)", () => {
  it("无 maxInputTokens 时原样返回", () => {
    const msgs = manyTurns(5);
    const r = compactMessages(msgs, {});
    assert.equal(r.removed, 0);
    assert.equal(r.messages.length, msgs.length);
  });

  it("低于预算时原样返回", () => {
    const msgs = manyTurns(2);
    const r = compactMessages(msgs, { maxInputTokens: 10_000 });
    assert.equal(r.removed, 0);
  });

  it("超过预算触发压缩：保留尾部轮次，removed>0 且更小", () => {
    const msgs = manyTurns(5);
    const before = countMessagesTokens(msgs);
    const r = compactMessages(msgs, { maxInputTokens: 50, keepLastTurns: 1 });
    assert.ok(r.removed > 0);
    assert.ok(r.estimatedTokens < before);
    const tail = r.messages.filter((m) => m.role !== "system");
    assert.deepEqual(tail.at(-2), { role: "user", content: big("user4") });
    assert.deepEqual(tail.at(-1), { role: "assistant", content: big("assist4") });
  });

  it("折叠结构化保留原始目标与工具结果关键字段", () => {
    const msgs = manyTurns(5, true);
    const r = compactMessages(msgs, { maxInputTokens: 50, keepLastTurns: 1 });
    const summary = r.messages.find((m) => m.role === "system") as { content: string };
    assert.ok(summary.content.includes(big("user0").slice(0, 12))); // 原始目标
    assert.ok(summary.content.includes("call_0")); // 工具结果关键字段
  });

  it("确定性：相同输入产生相同输出", () => {
    const msgs = manyTurns(5);
    const a = compactMessages(msgs, { maxInputTokens: 50, keepLastTurns: 1 });
    const b = compactMessages(msgs, { maxInputTokens: 50, keepLastTurns: 1 });
    assert.equal(JSON.stringify(a.messages), JSON.stringify(b.messages));
    assert.equal(a.removed, b.removed);
    assert.equal(a.estimatedTokens, b.estimatedTokens);
  });

  it("keepLastTurns 超出总轮次时不折叠", () => {
    const msgs = manyTurns(5);
    const r = compactMessages(msgs, { maxInputTokens: 50, keepLastTurns: 99 });
    assert.equal(r.removed, 0);
  });

  it("单轮超预算无法拆分时不折叠（保持可续跑）", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: big("only") },
      { role: "assistant", content: big("turn") },
    ];
    const r = compactMessages(msgs, { maxInputTokens: 50 });
    assert.equal(r.removed, 0);
  });
});
