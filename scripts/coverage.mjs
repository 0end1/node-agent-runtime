#!/usr/bin/env node
/**
 * 覆盖率水位报告（M6 P2.3 第一步：先出水位，暂不设门槛）
 *
 * 逐包运行 `node --import tsx --test --experimental-test-coverage`，解析各包汇总行
 * （all files）的行/分支/函数覆盖率，最后打印全仓摘要并把完整输出写入
 * `coverage/report.txt`。
 *
 * 退出码：任一包测试失败 → 1；覆盖率数值仅报告，不阻断（门槛待水位评审后设定）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");
const outDir = join(root, "coverage");

// Node 22 覆盖率汇总行形如：`all files | 46.19 | 80.70 | 66.67 |`（三列：行 / 分支 / 函数）
const ALL_FILES_RE = /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/i;

/**
 * P2.3 门禁阈值（2026-09-08 定档，随测试补齐逐档提升）：
 *   · 逐包：行 ≥ 80 / 分支 ≥ 60 / 函数 ≥ 55
 *   · 全仓均值：行 ≥ 90 / 分支 ≥ 78 / 函数 ≥ 85
 * 分支低水位区（< 80）经评审豁免：mcp / host / core / provider-openai / tools-basic / policy。
 */
const THRESHOLDS = {
  perPackage: { lines: 80, branch: 60, funcs: 55 },
  global: { lines: 90, branch: 78, funcs: 85 },
};
const KEYS = ["lines", "branch", "funcs"];

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function collectPackages() {
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => {
      const pkg = readJson(join(dir, "package.json"));
      const testDir = join(dir, "test");
      const files = existsSync(testDir)
        ? readdirSync(testDir)
            .filter((f) => f.endsWith(".test.ts"))
            .map((f) => join("test", f))
        : [];
      return { dir, name: pkg.name ?? dir, files };
    });
}

function runWithCoverage(pkg) {
  // 注①：node 内置 reporter 只有 tap / spec / dot / junit / lcov，写错名字会被当作自定义模块解析
  // 注②：只统计本仓代码 —— 排除依赖、测试自身与外部宿主路径（tsx loader 位于宿主 App 目录内）
  const args = [
    "--import",
    "tsx",
    "--test",
    "--experimental-test-coverage",
    "--test-reporter=spec",
    "--test-coverage-exclude=**/node_modules/**",
    "--test-coverage-exclude=**/Applications/**",
    "--test-coverage-exclude=**/test/**",
    // 口径：只统计「本包」代码（src 源码 + dist 产物），排除被依赖包（types/policy/...）的 dist 干扰
    "--test-coverage-include=src/**",
    "--test-coverage-include=dist/**",
    ...pkg.files,
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: pkg.dir,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const matched = output.match(ALL_FILES_RE);
  return {
    name: pkg.name,
    ok: result.status === 0,
    status: result.status,
    coverage: matched
      ? {
          lines: Number(matched[1]),
          branch: Number(matched[2]),
          funcs: Number(matched[3]),
        }
      : null,
    output,
  };
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function main() {
  const packages = collectPackages();
  mkdirSync(outDir, { recursive: true });

  const results = [];
  let logs = "";

  for (const pkg of packages) {
    if (pkg.files.length === 0) {
      logs += `\n===== ${pkg.name}：无 test/*.test.ts，跳过 =====\n`;
      results.push({ name: pkg.name, ok: true, skipped: true, coverage: null, output: "" });
      continue;
    }
    const result = runWithCoverage(pkg);
    results.push(result);
    logs += `\n===== ${pkg.name} =====\n${result.output}`;
  }

  writeFileSync(join(outDir, "report.txt"), logs.trim() + "\n", "utf8");

  console.log("\n覆盖率水位（M6 P2.3，暂不设门槛）");
  console.log("列顺序：行% · 分支% · 函数%（Node 22 内置覆盖率输出为三列）");
  console.log(pad("包", 34), pad("行%", 8), pad("分支%", 8), "函数%");
  console.log("-".repeat(62));
  const covered = results.filter((r) => r.coverage);
  for (const r of results) {
    const c = r.coverage;
    const cells = c
      ? [c.lines.toFixed(2), c.branch.toFixed(2), c.funcs.toFixed(2)]
      : ["—", "—", "—"];
    console.log(
      pad(r.skipped ? `${r.name}（跳过）` : r.name, 34),
      pad(cells[0], 8),
      pad(cells[1], 8),
      cells[2],
    );
  }
  const avg = (key) => covered.reduce((sum, r) => sum + r.coverage[key], 0) / covered.length;
  const globals =
    covered.length > 0 ? { lines: avg("lines"), branch: avg("branch"), funcs: avg("funcs") } : null;
  if (globals) {
    console.log("-".repeat(62));
    console.log(
      pad(`全仓均值（${covered.length} 个有测试的包）`, 34),
      pad(globals.lines.toFixed(2), 8),
      pad(globals.branch.toFixed(2), 8),
      globals.funcs.toFixed(2),
    );
  }
  console.log(`\n完整报告：coverage/report.txt`);

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(
      `\n以下包测试未通过：${failed.map((r) => `${r.name}(exit ${r.status})`).join(", ")}`,
    );
    process.exit(1);
  }

  if (!process.argv.includes("--gate")) return;

  const violations = [];
  for (const r of covered) {
    for (const key of KEYS) {
      const min = THRESHOLDS.perPackage[key];
      if (r.coverage[key] < min) {
        violations.push(`${r.name} · ${key} ${r.coverage[key].toFixed(2)}% < ${min}%`);
      }
    }
  }
  if (globals) {
    for (const key of KEYS) {
      const min = THRESHOLDS.global[key];
      if (globals[key] < min) {
        violations.push(`全仓均值 · ${key} ${globals[key].toFixed(2)}% < ${min}%`);
      }
    }
  }
  if (violations.length > 0) {
    console.error("\n覆盖率门禁未通过：");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(
    "\n覆盖率门禁通过（逐包 行≥80 / 分支≥60 / 函数≥55；全仓均值 行≥90 / 分支≥78 / 函数≥85）",
  );
}

main();
