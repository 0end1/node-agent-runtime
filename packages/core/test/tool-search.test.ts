import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AnyTool, type ToolExecutionContext, createToolSearchTool, ToolIndex } from "@node-agent-runtime/core";

function tool(name: string, description: string): AnyTool {
  return { name, description, execute: async () => "ok" };
}

const dummyCtx: ToolExecutionContext = { conversationId: "c", runId: "r", now: () => new Date() };

describe("M7-6a ToolIndex", () => {
  const tools = [
    tool("weather", "获取天气数据 forecast"),
    tool("geocode", "地理编码与天气查询"),
    tool("exchange", "货币汇率换算"),
    tool("t_file", "写入文件 write file"),
  ];
  const index = new ToolIndex(tools);

  it("中文查询命中 weather / geocode，不命中 exchange", () => {
    const names = index.search("天气").map((e) => e.name);
    assert.ok(names.includes("weather"));
    assert.ok(names.includes("geocode"));
    assert.ok(!names.includes("exchange"));
  });

  it("英文查询命中 weather", () => {
    assert.ok(index.search("weather").map((e) => e.name).includes("weather"));
  });

  it("整短语匹配优先于分词匹配", () => {
    const idx = new ToolIndex([tool("abc", "abc"), tool("abcd", "abc def")]);
    const r = idx.search("abc");
    assert.equal(r[0].name, "abc"); // 含整短语 "abc" 的排前
  });

  it("空查询返回空且不抛错", () => {
    assert.deepEqual(index.search(""), []);
    assert.deepEqual(index.search("   "), []);
  });

  it("limit 约束返回数量", () => {
    const many = Array.from({ length: 20 }, (_, i) => tool(`k${i}`, "keyword match"));
    const idx = new ToolIndex(many);
    assert.equal(idx.search("keyword", 5).length, 5);
  });

  it("重名工具只索引一次", () => {
    const dup = new ToolIndex([tool("x", "a"), tool("x", "b")]);
    assert.equal(dup.all().length, 1);
  });

  it("无命中返回空列表且不抛错", () => {
    assert.deepEqual(index.search("zzz不存在"), []);
  });
});

describe("M7-6a createToolSearchTool", () => {
  it("返回匹配工具名与描述，kind 取自声明/推断", async () => {
    const index = new ToolIndex([tool("weather", "获取天气"), tool("geocode", "地理编码天气")]);
    const search = createToolSearchTool(index);
    assert.equal(search.name, "tool_search");
    assert.equal(search.meta?.kind, "harmless");
    const out = (await search.execute({ query: "天气", limit: 5 }, dummyCtx)) as {
      query: string;
      count: number;
      tools: { name: string; kind: string }[];
    };
    assert.equal(out.query, "天气");
    assert.equal(out.count, 2);
    assert.deepEqual(
      out.tools.map((t) => t.name).sort(),
      ["geocode", "weather"],
    );
  });

  it("返回结构可供模型按名调用（不收窄权限）", async () => {
    const index = new ToolIndex([tool("secret", "credential 凭据")]);
    const out = (await createToolSearchTool(index).execute({ query: "凭据" }, dummyCtx)) as {
      tools: { name: string; kind: string }[];
    };
    assert.equal(out.tools[0].name, "secret");
    assert.equal(out.tools[0].kind, "credential");
  });
});
