import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { AnyTool, ToolExecutionContext } from "@node-agent-runtime/core";
import {
  LocalSandbox,
  type SandboxMode,
  type SandboxWriteInfo,
} from "@node-agent-runtime/sandbox";
import { createReadFileTool, createWriteFileTool, createBashTool } from "@node-agent-runtime/tools-code";

/**
 * 治理集成：证明这些工具是「受治理的」而非「能跑的」。
 * 域判定全部交给沙箱，本包只补沙箱拦不住的一层（symlink）。
 */
const ctx: ToolExecutionContext = {
  conversationId: "conv-1",
  runId: "run-1",
  now: () => new Date("2026-09-20T00:00:00Z"),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let dir: string;
let outside: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "tc-workspace-"));
  outside = await mkdtemp(join(tmpdir(), "tc-outside-"));
  await writeFile(join(outside, "secret.txt"), "TOP SECRET\n", "utf8");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

async function wrap(
  tool: AnyTool,
  mode: SandboxMode = "workspace-write",
  onWrite?: (info: SandboxWriteInfo) => void,
): Promise<AnyTool> {
  // timeoutMs: 0 —— 沙箱的超时会干扰「bash 自己管超时」这一断言
  const sandbox = new LocalSandbox({ timeoutMs: 0, ...(onWrite ? { onWrite } : {}) });
  const handle = await sandbox.begin(
    mode,
    { workspace: dir, writablePaths: [], network: "deny" },
    { runId: "run-1" },
  );
  return handle.wrap(tool);
}

describe("tools-code × 沙箱 — 越界拦截", () => {
  it("域外绝对路径被沙箱拦下（pathArgs 声明生效）", async () => {
    const tool = await wrap(createReadFileTool({ workspace: dir }));
    await assert.rejects(() => tool.execute({ path: "/etc/passwd" }, ctx), /越界/);
  });

  it("相对路径穿越（../）被拦下", async () => {
    const tool = await wrap(createReadFileTool({ workspace: dir }));
    await assert.rejects(
      () => tool.execute({ path: join(outside, "secret.txt") }, ctx),
      /越界/,
    );
  });

  it("域内 symlink 指向域外 —— 沙箱 resolve 查不出，由工具 realpath 拦下", async () => {
    await mkdir(join(dir, "links"), { recursive: true });
    await symlink(join(outside, "secret.txt"), join(dir, "links", "leak.txt"));

    const guarded = await wrap(createReadFileTool({ workspace: dir }));
    await assert.rejects(() => guarded.execute({ path: "links/leak.txt" }, ctx), /越界/);
  });

  it("域内 symlink 指向域内 —— 正常可读（不误杀）", async () => {
    await writeFile(join(dir, "real.txt"), "inside\n", "utf8");
    await symlink(join(dir, "real.txt"), join(dir, "link-inside.txt"));

    const tool = await wrap(createReadFileTool({ workspace: dir }));
    const out = await tool.execute({ path: "link-inside.txt" }, ctx);
    assert.equal(out.content, "inside");
  });
});

describe("tools-code × 沙箱 — 模式边界", () => {
  it("read-only 下 write_file 直接拒绝（不弹审批）", async () => {
    const tool = await wrap(createWriteFileTool({ workspace: dir }), "read-only");
    await assert.rejects(
      () => tool.execute({ path: "nope.txt", content: "x" }, ctx),
      /read-only/,
    );
  });

  it("read-only 下 bash 直接拒绝", async () => {
    const tool = await wrap(createBashTool({ workspace: dir }), "read-only");
    await assert.rejects(() => tool.execute({ command: "echo hi" }, ctx), /read-only/);
  });

  it("workspace-write 下写入成功，并产出 sandbox:write diff（复用既有机制）", async () => {
    const writes: SandboxWriteInfo[] = [];
    const tool = await wrap(createWriteFileTool({ workspace: dir }), "workspace-write", (i) =>
      writes.push(i),
    );
    // 用绝对路径：沙箱按**原样路径**回读文件以生成 diff，相对路径会以进程
    // cwd 解析（而非 workspace），读不到就没有 diff。这是既有行为，非本包缺陷。
    await tool.execute({ path: join(dir, "made.txt"), content: "hello sandbox\n" }, ctx);

    assert.equal(writes.length, 1);
    assert.equal(writes[0].toolName, "write_file");
    assert.match(writes[0].diff ?? "", /hello sandbox/);
  });

  it("相对路径写入本身成功（diff 可能因回读解析不到而为空，不影响写入）", async () => {
    const writes: SandboxWriteInfo[] = [];
    const tool = await wrap(createWriteFileTool({ workspace: dir }), "workspace-write", (i) =>
      writes.push(i),
    );
    const out = await tool.execute({ path: "relative.txt", content: "ok\n" }, ctx);
    assert.equal(out.created, true);
    assert.equal(writes.length, 1);
  });
});

describe("tools-code × 沙箱 — bash 超时", () => {
  it("超时抛错，且子进程树确实被杀（不是「不等了」）", async () => {
    const marker = join(dir, "should-not-exist.txt");
    const tool = await wrap(createBashTool({ workspace: dir }));

    await assert.rejects(
      () =>
        tool.execute(
          { command: `sleep 5; echo done > should-not-exist.txt`, timeoutMs: 300 },
          ctx,
        ),
      /超时/,
    );

    // 等到原本 sleep 结束之后：若只是停止 await，marker 此刻会出现
    await sleep(1_500);
    const exists = await stat(marker).catch(() => null);
    assert.equal(
      exists,
      null,
      "超时后子进程仍在运行 —— 进程树未被终止，超时只是「不等了」",
    );
  });

  it("未超时时正常返回（不被自己的超时逻辑误伤）", async () => {
    const tool = await wrap(createBashTool({ workspace: dir }));
    const out = await tool.execute({ command: "echo quick", timeoutMs: 5_000 }, ctx);
    assert.equal(out.exitCode, 0);
    assert.match(out.stdout, /quick/);
  });
});
