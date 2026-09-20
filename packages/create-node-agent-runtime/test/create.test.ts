import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { scaffold } from "../src/scaffold.js";
import { toPackageName } from "../src/name.js";
import { templateFiles } from "../src/template.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "create-node-agent-runtime-"));
}

describe("templateFiles", () => {
  const files = templateFiles({ name: "demo-agent" });
  const byPath = new Map(files.map((file) => [file.path, file.contents]));

  it("produces a runnable project skeleton", () => {
    assert.deepEqual(
      [...byPath.keys()].sort(),
      [".env.example", ".gitignore", "README.md", "package.json", "src/main.ts", "tsconfig.json"],
    );
  });

  it("writes a valid package.json bound to the runtime packages", () => {
    const pkg = JSON.parse(byPath.get("package.json")!) as {
      name: string;
      type: string;
      dependencies: Record<string, string>;
    };
    assert.equal(pkg.name, "demo-agent");
    assert.equal(pkg.type, "module");
    for (const dep of ["core", "host", "mock", "policy", "tools-basic"]) {
      assert.ok(pkg.dependencies[`@node-agent-runtime/${dep}`], `缺少依赖 ${dep}`);
    }
  });

  it("shows the governance path in the generated entry point", () => {
    const main = byPath.get("src/main.ts")!;
    // 生成物必须真的把三件事接上：策略默认值、沙箱域、审批决策点。
    for (const needle of [
      "createProductionDefaults",
      "SessionManager",
      "defineTool",
      "permission:request",
      "sandbox:write",
    ]) {
      assert.ok(main.includes(needle), `main.ts 未包含 ${needle}`);
    }
    // 模板拼接失败的典型症状：插值被当成字面量漏进生成物。
    assert.ok(!main.includes("${"), "main.ts 残留了未转义的模板插值");
  });
});

describe("scaffold", () => {
  it("writes every template file into the target directory", async () => {
    const dir = join(tempDir(), "app");
    const result = await scaffold({ dir, name: "app" });

    assert.equal(result.files.length, 6);
    for (const file of result.files) {
      assert.ok(existsSync(join(dir, file)), `${file} 未落盘`);
    }
    assert.equal(
      (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string }).name,
      "app",
    );
  });

  it("refuses to overwrite an existing project", async () => {
    const dir = join(tempDir(), "app");
    await scaffold({ dir, name: "app" });

    await assert.rejects(() => scaffold({ dir, name: "app" }), /拒绝覆盖/);
  });
});

describe("toPackageName", () => {
  it("normalises a directory name into a valid npm name", () => {
    assert.equal(toPackageName("My Agent"), "my-agent");
    assert.equal(toPackageName("../weird//dir"), "weird-dir");
    assert.equal(toPackageName(""), "my-agent");
  });
});
