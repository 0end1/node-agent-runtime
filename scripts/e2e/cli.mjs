// 跨形态 E2E · CLI 形态（M6 P2.4）
//
// 以 stdin 驱动 examples/cli.ts 的 REPL：对话（单步/多步工具）→ 写文件触发 ask
// → /approve 授权 → 沙箱写入落盘 → /checkpoints → /resume → /artifacts。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REPO_ROOT,
  assertIncludes,
  createReporter,
  makeWorkdir,
  removeDir,
  startProcess,
  waitForValue,
} from "./lib.mjs";

const CLI_ENTRY = join(REPO_ROOT, "examples", "cli.ts");
const WRITE_FILE = join(".demo-out", "cli.txt");

export async function runCli() {
  const workdir = makeWorkdir("node-agent-runtime-e2e-cli-");
  const proc = startProcess("npx", ["tsx", CLI_ENTRY], {
    cwd: workdir,
    env: { RUNTIME_DATA: join(workdir, ".runtime-data") },
  });
  const report = createReporter("cli");

  /** 记录当前输出长度，用于判断「本步之后」的新增输出 */
  const mark = () => proc.output.length;

  /**
   * 发送一条对话输入，等待该轮真正结束：run 完成后 CLI 会打印
   * `助手 > ...` + `(round-trips=...)` 并重新给出 prompt。
   * 必须在 `round-trips=` 出现后才发下一条，否则 busy 态下输入会被当成新对话。
   */
  async function chatTurn(input, assertText, { timeoutMs = 60000 } = {}) {
    const before = mark();
    proc.send(input);
    await proc.waitFor(
      (text) => {
        const tail = text.slice(before);
        return tail.includes("round-trips=") && tail.includes(assertText);
      },
      { timeoutMs, label: `对话「${input}」` },
    );
  }

  try {
    await report.step("CLI 启动并自动创建会话", () =>
      proc.waitFor((text) => /新会话已创建|你 \[/.test(text), {
        timeoutMs: 60000,
        label: "CLI 就绪",
      }),
    );

    await report.step("对话 + 单步工具：calculator（3.5 + 2 * 4 = 11.5）", async () => {
      await chatTurn("3.5 + 2 * 4 等于多少", "11.5");
    });

    await report.step("对话 + 多步工具：geocode → weather", async () => {
      await chatTurn("北京天气怎么样", "°C");
    });

    await report.step("审批链路：写文件 → /approve → 沙箱写入落盘", async () => {
      const before = mark();
      proc.send("请把 'hello cli' 写入文件 .demo-out/cli.txt");
      const match = await proc.waitFor(
        (text) => /decisionId=([A-Za-z0-9_-]+)/.exec(text.slice(before)),
        { timeoutMs: 30000, label: "decisionId" },
      );
      proc.send(`/approve ${match[1]}`);
      await waitForValue(() => (existsSync(join(workdir, WRITE_FILE)) ? "ok" : undefined), {
        timeoutMs: 30000,
        label: "文件落盘",
      });
      assertIncludes(readFileSync(join(workdir, WRITE_FILE), "utf8"), "hello cli", "CLI 写入内容");
    });

    await report.step("checkpoint 列表（/checkpoints）与续跑（/resume）", async () => {
      const before = mark();
      proc.send("/checkpoints");
      const ck = await proc.waitFor(
        (text) => /^\s{2,}(\S+)\s+step \d+/m.exec(text.slice(before)),
        { timeoutMs: 30000, label: "checkpoint id" },
      );
      const checkpointId = ck[1];

      const beforeResume = mark();
      proc.send(`/resume ${checkpointId} 继续`);
      await proc.waitFor((text) => text.slice(beforeResume).includes("round-trips"), {
        timeoutMs: 60000,
        label: "resume 完成",
      });
    });

    await report.step("artifact 强校验：写文件登记 file 产物 + 内容可读", async () => {
      const before = mark();
      proc.send("/artifacts");
      const m = await proc.waitFor(
        (text) => /(artifact_\S+)\s+file/.exec(text.slice(before)),
        { timeoutMs: 20000, label: "artifact 行" },
      );
      const artifactId = m[1];
      const beforeArt = mark();
      proc.send(`/artifact ${artifactId}`);
      const content = await proc.waitFor(
        (text) => (/hello cli/.test(text.slice(beforeArt)) ? text.slice(beforeArt) : null),
        { timeoutMs: 20000, label: "artifact 内容" },
      );
      assertIncludes(content, "hello cli", "artifact 内容");
    });
  } finally {
    // 关闭 stdin 触发 readline close → doExit 正常退出（exit 非 cli 命令，
    // 直接 send("exit") 会被当成对话，故改用 stdin.end）。
    try {
      proc.child.stdin.end();
    } catch {
      /* ignore */
    }
    proc.stop();
    removeDir(workdir);
  }

  return report.steps;
}
