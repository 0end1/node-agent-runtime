import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { AnyTool, ToolExecutionContext } from "@node-agent-runtime/core";
import {
  createBashTool,
  createCodeTools,
  createEditFileTool,
  createGlobTool,
  createGrepTool,
  createListDirTool,
  createReadFileTool,
  createWriteFileTool,
  type ListDirResult,
} from "@node-agent-runtime/tools-code";

const ctx: ToolExecutionContext = {
  conversationId: "conv-1",
  runId: "run-1",
  now: () => new Date("2026-09-20T00:00:00Z"),
};

function pick(tools: readonly AnyTool[], name: string): AnyTool {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `缺少工具 ${name}`);
  return tool;
}

describe("tools-code — 装配与分类", () => {
  it("七件工具齐备且顺序稳定", () => {
    assert.deepEqual(
      createCodeTools().map((t) => t.name),
      ["read_file", "write_file", "edit_file", "list_dir", "glob", "grep", "bash"],
    );
  });

  it("kind 划分符合治理矩阵", () => {
    const tools = createCodeTools({ workspace: tmpdir() });
    assert.equal(pick(tools, "read_file").meta?.kind, "harmless");
    assert.equal(pick(tools, "list_dir").meta?.kind, "harmless");
    assert.equal(pick(tools, "glob").meta?.kind, "harmless");
    assert.equal(pick(tools, "grep").meta?.kind, "harmless");
    assert.equal(pick(tools, "write_file").meta?.kind, "write");
    assert.equal(pick(tools, "edit_file").meta?.kind, "write");
    assert.equal(pick(tools, "bash").meta?.kind, "exec");
  });

  it("承载路径的字段都声明了 pathArgs（沙箱据此校验）", () => {
    const tools = createCodeTools({ workspace: tmpdir() });
    for (const name of ["read_file", "write_file", "edit_file", "list_dir", "glob", "grep"]) {
      assert.deepEqual(pick(tools, name).meta?.pathArgs, ["path"], `${name} 未声明 pathArgs`);
    }
    // bash 刻意不接受 cwd，也就不应有 pathArgs
    assert.equal(pick(tools, "bash").meta?.pathArgs, undefined);
  });
});

describe("tools-code — 逐工具行为", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "tools-code-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "const a = 1;\nconst b = 2;\n", "utf8");
    await writeFile(join(dir, "src", "b.js"), "console.log(1);\n", "utf8");
    await writeFile(join(dir, "README.md"), "# demo\nhello world\n", "utf8");
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("read_file 读回内容并给出行号基准", async () => {
    const tool = createReadFileTool({ workspace: dir });
    const out = await tool.execute({ path: "src/a.ts" }, ctx);
    assert.equal(out.content, "const a = 1;\nconst b = 2;");
    assert.equal(out.startLine, 1);
    assert.equal(out.lineCount, 2);
    assert.equal(out.totalLines, 2); // 末尾换行不产生第三个空行
    assert.equal(out.truncated, false);
  });

  it("read_file 支持 offset/limit 分段读", async () => {
    const tool = createReadFileTool({ workspace: dir });
    const out = await tool.execute({ path: "src/a.ts", offset: 2, limit: 1 }, ctx);
    assert.equal(out.content, "const b = 2;");
    assert.equal(out.startLine, 2);
    assert.equal(out.lineCount, 1);
  });

  it("read_file 遇字节上限即截断并标记（不静默）", async () => {
    const big = "x".repeat(5_000);
    await writeFile(join(dir, "big.txt"), big, "utf8");
    const tool = createReadFileTool({ workspace: dir, limits: { readBytes: 1_000 } });
    const out = await tool.execute({ path: "big.txt" }, ctx);
    assert.equal(out.truncated, true);
    assert.equal(out.truncatedBy, "bytes");
    assert.ok(out.bytes <= 1_000);
  });

  it("read_file 拒绝二进制文件而非返回乱码", async () => {
    await writeFile(join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3, 4]));
    const tool = createReadFileTool({ workspace: dir });
    await assert.rejects(() => tool.execute({ path: "bin.dat" }, ctx), /二进制/);
  });

  it("read_file 对目录给出明确错误（引导用 list_dir）", async () => {
    const tool = createReadFileTool({ workspace: dir });
    await assert.rejects(() => tool.execute({ path: "src" }, ctx), /list_dir/);
  });

  it("list_dir 只列单层并标出类型", async () => {
    const tool = createListDirTool({ workspace: dir });
    const out = (await tool.execute({ path: "." }, ctx)) as ListDirResult;
    const names = out.entries.map((e) => e.name).sort();
    assert.ok(names.includes("src"));
    assert.ok(names.includes("README.md"));
    assert.equal(pick([tool], "list_dir").meta?.kind, "harmless");
    assert.equal(out.truncated, false);
  });

  it("glob 按模式匹配（** 跨目录、* 不跨目录）", async () => {
    const tool = createGlobTool({ workspace: dir });
    const ts = await tool.execute({ pattern: "src/**/*.ts" }, ctx);
    assert.deepEqual(ts.matches, ["src/a.ts"]);
    const all = await tool.execute({ pattern: "*.md" }, ctx);
    assert.deepEqual(all.matches, ["README.md"]);
  });

  it("grep 给出命中行号，无效正则显式报错", async () => {
    const tool = createGrepTool({ workspace: dir });
    const out = await tool.execute({ pattern: "hello" }, ctx);
    assert.equal(out.count, 1);
    assert.equal(out.hits[0].file, "README.md");
    assert.equal(out.hits[0].line, 2);

    await assert.rejects(
      () => tool.execute({ pattern: "[", regex: true }, ctx),
      /无效的正则/,
    );
  });

  it("write_file 新建成功；重复写入默认拒绝覆盖", async () => {
    const tool = createWriteFileTool({ workspace: dir });
    const created = await tool.execute({ path: "out/hello.txt", content: "hi" }, ctx);
    assert.equal(created.created, true);
    assert.equal(await readFile(join(dir, "out/hello.txt"), "utf8"), "hi");

    await assert.rejects(
      () => tool.execute({ path: "out/hello.txt", content: "again" }, ctx),
      /已存在/,
    );
    // 显式允许时才覆盖
    const overwrote = await tool.execute(
      { path: "out/hello.txt", content: "again", overwrite: true },
      ctx,
    );
    assert.equal(overwrote.created, false);
    assert.equal(await readFile(join(dir, "out/hello.txt"), "utf8"), "again");
  });

  it("edit_file 唯一命中才替换", async () => {
    await writeFile(join(dir, "edit.txt"), "alpha\nbeta\ngamma\n", "utf8");
    const tool = createEditFileTool({ workspace: dir });
    const out = await tool.execute(
      { path: "edit.txt", oldText: "beta", newText: "BETA" },
      ctx,
    );
    assert.equal(out.occurrences, 1);
    assert.equal(await readFile(join(dir, "edit.txt"), "utf8"), "alpha\nBETA\ngamma\n");
  });

  it("edit_file 多处命中报错且**不改文件**", async () => {
    await writeFile(join(dir, "dup.txt"), "a\na\n", "utf8");
    const tool = createEditFileTool({ workspace: dir });
    await assert.rejects(
      () => tool.execute({ path: "dup.txt", oldText: "a", newText: "b" }, ctx),
      /出现 2 次/,
    );
    assert.equal(await readFile(join(dir, "dup.txt"), "utf8"), "a\na\n");
  });

  it("edit_file 未命中报错且**不改文件**", async () => {
    await writeFile(join(dir, "miss.txt"), "nothing here\n", "utf8");
    const tool = createEditFileTool({ workspace: dir });
    await assert.rejects(
      () => tool.execute({ path: "miss.txt", oldText: "absent", newText: "x" }, ctx),
      /未找到/,
    );
    assert.equal(await readFile(join(dir, "miss.txt"), "utf8"), "nothing here\n");
  });

  it("bash 返回 stdout 与退出码；cwd 锁定在作用域根", async () => {
    const tool = createBashTool({ workspace: dir });
    const ok = await tool.execute({ command: "echo hi" }, ctx);
    assert.equal(ok.exitCode, 0);
    assert.match(ok.stdout, /hi/);

    const cwd = await tool.execute({ command: "pwd" }, ctx);
    // pwd 输出的是真实路径；与 workspace 的 realpath 一致即证明 cwd 被锁定
    assert.ok(
      cwd.stdout.trim().length > 0 && cwd.stdout.includes(dir.split("/").pop() as string),
      `cwd 应在作用域根内，实际 ${cwd.stdout}`,
    );

    const failed = await tool.execute({ command: "exit 3" }, ctx);
    assert.equal(failed.exitCode, 3); // 非 0 退出是信息，不是异常
  });
});
