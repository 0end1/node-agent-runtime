// 跨形态 E2E · Web 形态（M6 P2.4）
//
// 覆盖：新建会话 → 对话（单步/多步工具）→ ask 审批 → approve → 沙箱写入落盘
//       → artifact 接口 → checkpoint → 续跑（resume）。
// 依赖 MockProvider（免密钥、确定性），不访问外网。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REPO_ROOT,
  assertIncludes,
  createReporter,
  makeWorkdir,
  postJSON,
  readSSE,
  removeDir,
  startProcess,
  waitForHttp,
  waitForValue,
} from "./lib.mjs";

const SERVER_ENTRY = join(REPO_ROOT, "examples", "web", "server.ts");
const MATH_INPUT = "3.5 + 2 * 4 等于多少";
const WEATHER_INPUT = "北京天气怎么样";
const WRITE_INPUT = "请把 'hello e2e' 写入文件 .demo-out/e2e.txt";
const WRITE_FILE = join(".demo-out", "e2e.txt");

export async function runWeb({ port = 8791 } = {}) {
  const workdir = makeWorkdir("agent-runtime-e2e-web-");
  const proc = startProcess("npx", ["tsx", SERVER_ENTRY], {
    cwd: workdir,
    env: { PORT: String(port), RUNTIME_DATA: join(workdir, ".runtime-data") },
  });
  const base = `http://127.0.0.1:${port}`;
  const report = createReporter("web");
  const events = [];
  let sessionId;
  let lastDone;

  async function chat(input, { timeoutMs = 90000 } = {}) {
    const local = [];
    const stream = readSSE(
      `${base}/api/chat?session=${encodeURIComponent(sessionId)}&input=${encodeURIComponent(input)}`,
      (event) => {
        local.push(event);
        events.push(event);
        if (event.type === "done") lastDone = event.payload;
      },
      { timeoutMs },
    );
    return {
      local,
      async finished() {
        await stream;
        return lastDone;
      },
    };
  }

  try {
    await report.step("Web server 启动就绪", () => waitForHttp(`${base}/api/sessions`));

    await report.step("治理事件通道连通（/api/events）", async () => {
      const stream = readSSE(`${base}/api/events`, (event) => events.push(event), {
        timeoutMs: 180000,
      });
      stream.catch(() => {}); // 后台长连接，结束即取消
      await waitForValue(() => events.some((e) => e.type === "system"), {
        timeoutMs: 10000,
        label: "events system 帧",
      });
    });

    await report.step("新建会话（/api/new）", async () => {
      const { status, json } = await postJSON(`${base}/api/new`);
      if (status !== 200 || !json.id) throw new Error(`新建会话失败：${JSON.stringify(json)}`);
      sessionId = json.id;
    });

    await report.step("对话 + 单步工具：calculator（3.5 + 2 * 4 = 11.5）", async () => {
      const run = await chat(MATH_INPUT);
      const done = await run.finished();
      if (!done) throw new Error("chat 未返回 done 帧");
      assertIncludes(done.output, "11.5", "calculator 结果");
    });

    await report.step("对话 + 多步工具：geocode → weather", async () => {
      const run = await chat(WEATHER_INPUT);
      const done = await run.finished();
      const names = run.local
        .filter((e) => e.type === "tool:start")
        .map((e) => e.payload?.toolCall?.name);
      if (!names.includes("geocode") || !names.includes("weather")) {
        throw new Error(`未观察到多步工具调用：${names.join(", ") || "无"}`);
      }
      assertIncludes(done?.output ?? "", "°C", "天气结果");
    });

    await report.step("审批链路：ask → approve → 沙箱写入落盘", async () => {
      const run = await chat(WRITE_INPUT);
      const decisionId = await waitForValue(
        () => events.find((e) => e.type === "permission:request")?.payload?.decisionId,
        { timeoutMs: 25000, label: "permission:request" },
      );
      const approved = await postJSON(`${base}/api/approve`, { decisionId });
      if (!approved.json?.ok) throw new Error(`approve 失败：${JSON.stringify(approved.json)}`);
      await run.finished();
      const file = join(workdir, WRITE_FILE);
      if (!existsSync(file)) throw new Error(`文件未落盘：${file}`);
      assertIncludes(readFileSync(file, "utf8"), "hello e2e", "写入内容");
    });

    await report.step("artifact 强校验：写文件登记 file 产物 + 内容可读", async () => {
      const res = await fetch(`${base}/api/artifacts?session=${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`artifacts 请求失败：${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error("artifacts 返回非数组");
      // 写文件步骤应已登记一个 file artifact（M4 在端到端真正生效）。
      const hit = list.find((a) => a.kind === "file" && String(a.name).includes("e2e.txt"));
      if (!hit) throw new Error(`未找到写文件登记的 artifact（list=${JSON.stringify(list)}）`);
      const art = await (await fetch(`${base}/api/artifact/${hit.id}`)).json();
      if (!art.text || !art.text.includes("hello e2e")) {
        throw new Error(`artifact 内容校验失败：${JSON.stringify(art)}`);
      }
    });

    await report.step("checkpoint → 续跑（/api/checkpoints + /api/resume）", async () => {
      const taskId = lastDone?.taskId;
      if (!taskId) throw new Error("未取得 taskId（chat done 帧缺失）");
      const res = await fetch(`${base}/api/checkpoints?task=${encodeURIComponent(taskId)}`);
      const list = await res.json();
      if (!Array.isArray(list) || list.length === 0) throw new Error("该任务没有 checkpoint");
      const checkpointId = list[list.length - 1].id;

      let resumed = null;
      await readSSE(
        `${base}/api/resume`,
        (event) => {
          if (event.type === "done") resumed = event.payload;
        },
        {
          timeoutMs: 90000,
          init: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ checkpointId, continuation: "继续" }),
          },
        },
      );
      if (!resumed) throw new Error("resume 未返回 done 帧");
      if (resumed.error) throw new Error(`resume 出错：${resumed.error}`);
    });
  } finally {
    proc.stop();
    removeDir(workdir);
  }

  return report.steps;
}
