/**
 * API 表面复核脚本（CI 作业 `api-surface`）— 实现 docs/api-surface.md §13「快照复核」。
 *
 * 用途：每次发布前，用与冻结快照同一的提取方式重新解析各包公共导出面，
 * 与基线（scripts/api-surface.baseline.json，由本脚本 --update 固化）比对，
 * 差异即为待评审项（新增→补快照表+CHANGELOG，删除/重命名→BREAKING 评审）。
 *
 * 提取口径（与 docs/api-surface.md §0 一致）：
 *   - 解析各包 dist/index.d.ts（需先 `npm run build`）；
 *   - 本地相对路径 `export *`（./x）→ 递归展开；
 *   - 本地/跨包**具名** re-export（export { a } / export { a } from ...）→ 计入符号；
 *   - 跨包 `export * from "@node-agent-runtime/X"`（facade 转发）→ 不展开，仅记转发目标 X。
 *
 * 用法：
 *   tsx scripts/check-api-surface.ts            # 复核（差异≠0 时退出码 1）
 *   tsx scripts/check-api-surface.ts --update   # 重新冻结基线（评审通过后执行）
 *   tsx scripts/check-api-surface.ts --summary  # 仅打印各包符号数（含与文档 §0 期望值对照）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const ROOT = path.resolve(path.dirname(process.argv[1]), "..");

/** 与 docs/api-surface.md §0 表相同的包序与期望符号数（仅摘要对照，不参与门禁判定）。 */
const PACKAGES = [
  { name: "@node-agent-runtime/types", dir: "types", expect: null }, // §0 未给数字（子模块聚合）
  { name: "@node-agent-runtime/memory", dir: "memory", expect: 14 },
  { name: "@node-agent-runtime/artifact", dir: "artifact", expect: 8 },
  { name: "@node-agent-runtime/sandbox", dir: "sandbox", expect: 14 },
  { name: "@node-agent-runtime/policy", dir: "policy", expect: 15 },
  { name: "@node-agent-runtime/core", dir: "core", expect: 49 },
  { name: "@node-agent-runtime/tools-basic", dir: "tools-basic", expect: 4 },
  { name: "@node-agent-runtime/mock", dir: "mock", expect: 1 },
  { name: "@node-agent-runtime/host", dir: "host", expect: 10 },
  { name: "@node-agent-runtime/mcp", dir: "mcp", expect: 28 },
  { name: "@node-agent-runtime/provider-openai", dir: "provider-openai", expect: 2 },
  { name: "@node-agent-runtime/store-sqlite", dir: "store-sqlite", expect: 2 },
];

const BASELINE_FILE = path.join(ROOT, "scripts", "api-surface.baseline.json");

type PkgSurface = { symbols: string[]; forwards: string[] };
type Snapshot = { generatedAt: string; note: string; packages: Record<string, PkgSurface> };

const BARE_RE = /^@node-agent-runtime\//;

function isBareSpec(spec: string): boolean {
  return BARE_RE.test(spec);
}

function resolveLocal(importerFile: string, spec: string): string | null {
  const dir = path.dirname(importerFile);
  let base = spec;
  if (base.endsWith(".js") || base.endsWith(".ts")) base = base.slice(0, -3);
  for (const cand of [path.join(dir, base + ".d.ts"), path.join(dir, base, "index.d.ts")]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods !== undefined && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function addDeclaredNames(stmt: ts.Statement, out: Set<string>): void {
  if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
    if (stmt.name) out.add(stmt.name.text);
  } else if (
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isModuleDeclaration(stmt)
  ) {
    out.add(stmt.name.text);
  } else if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) out.add(d.name.text);
    }
  }
}

/** 提取某包的导出符号与 facade 转发目标。 */
function extractPackage(pkgDir: string): PkgSurface {
  const entry = path.join(ROOT, "packages", pkgDir, "dist", "index.d.ts");
  if (!fs.existsSync(entry)) {
    throw new Error(`缺少 ${entry} —— 请先执行 npm run build`);
  }
  const symbols = new Set<string>();
  const forwards = new Set<string>();
  const visited = new Set<string>();

  const walk = (file: string): void => {
    const full = path.resolve(file);
    if (visited.has(full)) return;
    visited.add(full);
    const source = ts.createSourceFile(
      full,
      fs.readFileSync(full, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const stmt of source.statements) {
      if (ts.isExportDeclaration(stmt)) {
        const spec = stmt.moduleSpecifier
          ? (stmt.moduleSpecifier as ts.StringLiteral).text
          : undefined;
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          // export { a, b as c } [from ...] —— 具名导出（含本地/跨包 re-export）计入
          for (const el of stmt.exportClause.elements) symbols.add(el.name.text);
        } else if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
          // export * as ns from ...
          symbols.add(stmt.exportClause.name.text);
        } else if (spec) {
          // export * from ...
          if (isBareSpec(spec)) {
            // 跨包 facade 转发：仅记目标，不展开（口径：core 49 + 5 转发）
            forwards.add(spec);
          } else if (spec.startsWith(".")) {
            const target = resolveLocal(full, spec);
            if (target) walk(target);
          }
        }
      } else if (hasExportModifier(stmt)) {
        // 被触及文件的具名导出声明（export declare const/function/class/interface/type/namespace）。
        // 注意：经本地 `export *` 递归到达的模块，其导出同样会被转发，故必须计入。
        addDeclaredNames(stmt, symbols);
      }
    }
  };

  walk(entry);
  return { symbols: [...symbols].sort(), forwards: [...forwards].sort() };
}

function loadBaseline(): Snapshot | null {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) as Snapshot;
}

function writeBaseline(snapshot: Snapshot): void {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(snapshot, null, 2) + "\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const summary = args.includes("--summary");

  const current: Snapshot = {
    generatedAt: new Date().toISOString(),
    note: "由 scripts/check-api-surface.ts --update 生成；随 docs/api-surface.md 同步冻结/刷新。",
    packages: {},
  };
  for (const p of PACKAGES) current.packages[p.name] = extractPackage(p.dir);

  if (summary || update) {
    console.log("API 表面提取摘要（代码事实源）：");
    for (const p of PACKAGES) {
      const s = current.packages[p.name];
      const mark =
        p.expect == null ? "" : s.symbols.length === p.expect ? " ✓" : ` ✗ 文档期望 ${p.expect}`;
      console.log(
        `  ${p.name.padEnd(28)} ${String(s.symbols.length).padStart(3)} 符号  ${s.forwards.length ? "+ " + s.forwards.join(", ") + " 转发" : ""}${mark}`,
      );
    }
    if (update) {
      writeBaseline(current);
      console.log(
        `\n已更新基线：${path.relative(ROOT, BASELINE_FILE)}（评审通过后随快照文档一起提交）`,
      );
      process.exit(0);
    }
    process.exit(0);
  }

  const base = loadBaseline();
  if (!base) {
    console.error("缺少基线文件 scripts/api-surface.baseline.json。");
    console.error(
      "首次冻结请运行：tsx scripts/check-api-surface.ts --update（提交前人工核验符号与 docs/api-surface.md 一致）",
    );
    process.exit(2);
  }

  let dirty = false;
  for (const p of PACKAGES) {
    const prev = base.packages[p.name] ?? { symbols: [], forwards: [] };
    const cur = current.packages[p.name];
    const added = cur.symbols.filter((s) => !prev.symbols.includes(s));
    const removed = prev.symbols.filter((s) => !cur.symbols.includes(s));
    const fAdded = cur.forwards.filter((s) => !prev.forwards.includes(s));
    const fRemoved = prev.forwards.filter((s) => !cur.forwards.includes(s));
    const changed = added.length || removed.length || fAdded.length || fRemoved.length;
    if (changed) dirty = true;
    console.log(
      `\n== ${p.name} ==  ${cur.symbols.length} 符号（基线 ${prev.symbols.length}）` +
        (changed ? "" : "  无差异"),
    );
    for (const s of added) console.log(`  [新增·兼容]  ${s}  → 需补快照表 + CHANGELOG(Added)`);
    for (const s of removed) console.log(`  [删除·破坏]  ${s}  → 需 BREAKING 评审（§13）`);
    for (const s of fAdded) console.log(`  [新增转发]   facade → ${s}`);
    for (const s of fRemoved) console.log(`  [移除转发]   facade - ${s}`);
  }

  console.log(
    "\n" +
      (dirty
        ? "公共 API 表面与基线存在差异：按 docs/api-surface.md §13 逐条评审后执行 --update 重新冻结。"
        : "公共 API 表面与基线一致：无待评审变更。"),
  );
  process.exit(dirty ? 1 : 0);
}

main();
