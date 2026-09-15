import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Agent,
  AgentRuntime,
  ConsoleLogger,
  type Logger,
  type RunEndEvent,
  type RunStartEvent,
  type RuntimeEvent,
} from "@node-agent-runtime/core";
import { MockProvider } from "@node-agent-runtime/mock";
import { builtinTools } from "@node-agent-runtime/tools-basic";

/**
 * M7-2 traceId 横切面（测试即规格）：
 *  · 一次 run 的全部事件 traceId 一致，跨 run 不同；
 *  · 宿主可注入，且 `RunResult` 回显；
 *  · 并发 run 互不串扰（注入点收口在 run 内闭包，非实例字段）；
 *  · `run:start` / `run:end` 带单调时间戳；
 *  · `Logger.child()` 让日志行可关联到同一条链路。
 */

function makeRuntime(logger?: Logger): AgentRuntime {
  return new AgentRuntime({
    provider: new MockProvider({ now: () => new Date("2026-09-04T10:30:00+08:00") }),
    ...(logger ? { logger } : {}),
  });
}

function agent(): Agent {
  return new Agent({ name: "test", tools: builtinTools });
}

/** Run `fn` while capturing every emitted event. */
async function collect<T>(
  runtime: AgentRuntime,
  fn: () => Promise<T>,
): Promise<{ value: T; events: RuntimeEvent[] }> {
  const events: RuntimeEvent[] = [];
  const off = runtime.subscribe((e) => events.push(e));
  try {
    return { value: await fn(), events };
  } finally {
    off();
  }
}

const isStart = (e: RuntimeEvent): e is RunStartEvent => e.type === "run:start";
const isEnd = (e: RuntimeEvent): e is RunEndEvent => e.type === "run:end";

describe("M7-2 traceId 贯穿", () => {
  it("一次 run 的全部事件 traceId 一致", async () => {
    const runtime = makeRuntime();
    const { value: result, events } = await collect(runtime, () =>
      runtime.run({ agent: agent(), input: "2 + 3 * 4 = ?" }),
    );
    assert.ok(events.length > 3, `事件太少：${events.length}`);
    for (const e of events) {
      assert.equal(e.traceId, result.traceId, `事件 ${e.type} 的 traceId 不一致`);
    }
  });

  it("跨 run 的 traceId 不同", async () => {
    const runtime = makeRuntime();
    const a = await runtime.run({ agent: agent(), input: "2 + 2 = ?" });
    const b = await runtime.run({ agent: agent(), input: "3 + 3 = ?" });
    assert.notEqual(a.traceId, b.traceId);
  });

  it("宿主注入的 traceId 被沿用，并由 RunResult 回显", async () => {
    const runtime = makeRuntime();
    const { value: result, events } = await collect(runtime, () =>
      runtime.run({ agent: agent(), input: "2 + 2 = ?", traceId: "trace_host_1" }),
    );
    assert.equal(result.traceId, "trace_host_1");
    assert.ok(events.length > 0);
    for (const e of events) assert.equal(e.traceId, "trace_host_1");
  });

  it("同一 runtime 上并发的 run 不串扰 traceId", async () => {
    const runtime = makeRuntime();
    const events: RuntimeEvent[] = [];
    const off = runtime.subscribe((e) => events.push(e));
    const [a, b] = await Promise.all([
      runtime.run({ agent: agent(), input: "2 + 2 = ?", traceId: "trace_A" }),
      runtime.run({ agent: agent(), input: "北京天气怎么样", traceId: "trace_B" }),
    ]);
    off();

    const byRun = new Map<string, Set<string>>();
    for (const e of events) {
      const runId = (e as { runId?: string }).runId;
      if (!runId) continue;
      const seen = byRun.get(runId) ?? new Set<string>();
      seen.add(e.traceId ?? "");
      byRun.set(runId, seen);
    }
    // 两个 run 各自只对应一个 traceId，且互不相同。
    assert.deepEqual([...(byRun.get(a.runId) ?? [])], ["trace_A"]);
    assert.deepEqual([...(byRun.get(b.runId) ?? [])], ["trace_B"]);
  });

  it("run:start / run:end 带单调递增的 epoch 时间戳", async () => {
    const runtime = makeRuntime();
    const { events } = await collect(runtime, () =>
      runtime.run({ agent: agent(), input: "2 + 2 = ?" }),
    );
    const start = events.find(isStart);
    const end = events.find(isEnd);
    assert.ok(start, "缺少 run:start");
    assert.ok(end, "缺少 run:end");
    assert.equal(typeof start.startedAt, "number");
    assert.equal(typeof end.endedAt, "number");
    assert.ok(end.endedAt >= start.startedAt, "endedAt 不应早于 startedAt");
  });
});

describe("M7-2 Logger.child()", () => {
  it("child 日志行携带 trace / run 上下文", () => {
    const lines: string[] = [];
    const parent = new ConsoleLogger({ level: "debug", stream: (l) => lines.push(l) });
    parent.child({ traceId: "trace_1", runId: "run_1" }).info("hello");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[trace=trace_1 run=run_1\]/);
    assert.match(lines[0], /hello/);
  });

  it("未绑定上下文时输出格式与改动前逐字一致（回归保护）", () => {
    const lines: string[] = [];
    new ConsoleLogger({ level: "debug", stream: (l) => lines.push(l) }).info("plain");
    assert.equal(lines[0], "[node-agent-runtime info] plain");
  });

  it("child 继承父级 level 与 stream，且逐层合并上下文", () => {
    const lines: string[] = [];
    const base = new ConsoleLogger({ level: "error", stream: (l) => lines.push(l) });
    const child = base.child({ traceId: "trace_1" }) as ConsoleLogger;
    child.info("被 level 过滤");
    assert.equal(lines.length, 0, "child 应继承 level=error");
    child.error("boom");
    assert.match(lines[0], /\[trace=trace_1\]/);

    const grandchild = child.child({ step: 2 }) as ConsoleLogger;
    grandchild.error("again");
    assert.match(lines[1], /\[trace=trace_1 step=2\]/);
  });

  it("未提供 child 的 Logger 仍可用（可选方法，运行时回退到父级）", () => {
    const lines: string[] = [];
    const plain: Logger = {
      debug: () => {},
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    };
    assert.equal(plain.child, undefined);
    plain.info("ok");
    assert.equal(lines[0], "ok");
  });
});

describe("M7-2 run 级日志关联", () => {
  it("run 内日志行带上本次 run 的 traceId", async () => {
    const lines: string[] = [];
    const runtime = makeRuntime(
      new ConsoleLogger({ level: "debug", stream: (l) => lines.push(l) }),
    );
    const result = await runtime.run({ agent: agent(), input: "2 + 2 = ?" });
    const startLine = lines.find((l) => l.includes("run:start"));
    assert.ok(startLine, "缺少 run:start 日志行");
    assert.ok(startLine!.includes(`trace=${result.traceId}`), `got: ${startLine}`);
    assert.ok(startLine!.includes(`run=${result.runId}`), `got: ${startLine}`);
  });
});
