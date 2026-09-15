/**
 * M7-3: 在 CI 内跑内置策略预设的内联测试。
 * 跑 `PRESETS` 中每套预设自带 `tests`，逐条比对期望 verdict；任一失败即非零退出。
 * 用法：`npm run policy:test`（默认跑全部内置预设）；`npm run policy:test -- --file <path>` 对外部文档跑其内联用例。
 */
import { readFileSync } from "node:fs";
import { PRESETS, testPolicy, validatePolicyDocument, type PolicyDocument } from "@node-agent-runtime/policy";

async function runBuiltinPresets(): Promise<number> {
  let failedPresets = 0;
  for (const [name, doc] of Object.entries(PRESETS)) {
    const results = await testPolicy(doc);
    const failures = results.filter((r) => !r.passed);
    if (failures.length === 0) {
      console.log(`✓ ${name}: ${results.length} 例全通过`);
    } else {
      failedPresets++;
      console.error(`✗ ${name}: ${failures.length}/${results.length} 失败`);
      for (const f of failures) {
        console.error(`   - ${f.name}: 期望 ${f.expected}，实际 ${f.actual}${f.reason ? `（${f.reason}）` : ""}`);
      }
    }
  }
  return failedPresets;
}

async function runExternalFile(path: string): Promise<number> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`✗ 无法读取文件：${path}`);
    return 1;
  }
  let doc: PolicyDocument;
  try {
    doc = validatePolicyDocument(JSON.parse(raw));
  } catch (err) {
    console.error(`✗ 文档校验失败（${path}）：${(err as Error).message}`);
    return 1;
  }
  const results = await testPolicy(doc);
  const failures = results.filter((r) => !r.passed);
  if (failures.length === 0) {
    console.log(`✓ ${path}: ${results.length} 例全通过`);
    return 0;
  }
  console.error(`✗ ${path}: ${failures.length}/${results.length} 失败`);
  for (const f of failures) {
    console.error(`   - ${f.name}: 期望 ${f.expected}，实际 ${f.actual}`);
  }
  return 1;
}

const fileArg = process.argv.find((a) => a.startsWith("--file="));
const file = fileArg ? fileArg.slice("--file=".length) : undefined;

const failed = file ? await runExternalFile(file) : await runBuiltinPresets();
if (failed > 0) {
  console.error(`\n策略测试失败：${failed} 项未通过`);
  process.exit(1);
}
console.log("\n全部预设策略测试通过");
