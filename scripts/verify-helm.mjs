/**
 * M8-5 · Helm chart 静态校验（零依赖）。
 *
 * 背景：`docs/development-checklist.md` §3.4 给 M8-5 定的验收口径是
 * 「`helm lint` 通过、`helm template` 渲染出预期对象」，但本机与 CI 都没有 helm，
 * 这两条**从未真正跑过** —— chart 一旦写错只能等 `helm install` 时才炸。
 *
 * 本脚本用 `node:` 内置模块做 `helm lint` 能做的**那部分静态检查**：
 *   1. Chart.yaml 必需字段齐备（apiVersion / name / version / appVersion），且 name 与目录名一致
 *   2. 模板引用的每个 `.Values.<a>[.<b>]` 键都在 values.yaml 里有定义
 *      —— 这是最容易犯也最隐蔽的错：Helm 对未定义值**不报错**，直接渲染成空，
 *         于是 `imagePullPolicy:` / `mountPath:` 变空，要到 Pod 起不来才被发现
 *   3. `include "x"` / `template "x"` 引用的命名模板都有对应的 `define "x"`
 *   4. `$.Template.BasePath "/x.yaml"` 引用的模板文件真实存在（改名后会静默渲染成空串）
 *   5. （警告，不阻断）values.yaml 里定义了却没有任何模板引用的键 —— 死值或漏用
 *
 * 刻意**不做**真正的渲染：那需要一个 Go template 引擎，为一个交付物引依赖不值当；
 * 真机验收仍以 `helm lint` / `helm template` 与集群实测为准（清单里标为人工项）。
 *
 * Usage:
 *   node scripts/verify-helm.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHART_DIR = path.join(ROOT, "deploy", "helm", "node-agent-runtime");
const TEMPLATES_DIR = path.join(CHART_DIR, "templates");

const errors = [];
const warnings = [];
const ok = [];

/**
 * 极简 YAML 键提取：只要**顶层**与**第二层**的键名，不看值。
 *
 * values.yaml 是本仓库自己写的（纯 map / 标量 / 行内 `{}` `[]`，无锚点、无多行块、
 * 无流式标量），故缩进扫描足够；真要解析通用 YAML 得引依赖，不划算。
 * 以 `-` 开头的列表项整行跳过 —— 列表元素内部（如 ingress.hosts[].host）不做深挖，
 * 模板里也不会用 `.Values` 直接引用它们。
 */
function collectValueKeys(text) {
  const top = new Set();
  const sub = new Map();
  let currentTop = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const m = trimmed.match(/^([A-Za-z0-9_][\w.-]*)\s*:/);
    if (!m) continue;

    const indent = line.length - line.trimStart().length;
    const key = m[1];
    if (indent === 0) {
      currentTop = key;
      top.add(key);
      if (!sub.has(key)) sub.set(key, new Set());
    } else if (currentTop) {
      sub.get(currentTop).add(key);
    }
  }
  return { top, sub };
}

/** 解析 Chart.yaml 的顶层标量字段（同样只取 `key: value` 形式）。 */
function chartFields(text) {
  const fields = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.+?)\s*$/);
    if (m) fields.set(m[1], m[2].replace(/^["']|["']$/g, ""));
  }
  return fields;
}

if (!fs.existsSync(CHART_DIR)) {
  console.error(`❌ 找不到 chart 目录：${path.relative(ROOT, CHART_DIR)}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. Chart.yaml
const chartPath = path.join(CHART_DIR, "Chart.yaml");
if (!fs.existsSync(chartPath)) {
  errors.push("缺少 Chart.yaml");
} else {
  const fields = chartFields(fs.readFileSync(chartPath, "utf8"));
  const required = ["apiVersion", "name", "version", "appVersion"];
  const missing = required.filter((k) => !fields.has(k));
  if (missing.length > 0) {
    errors.push(`Chart.yaml 缺少必需字段：${missing.join(" / ")}`);
  } else {
    const dirName = path.basename(CHART_DIR);
    if (fields.get("name") !== dirName) {
      errors.push(`Chart.yaml 的 name（${fields.get("name")}）与目录名（${dirName}）不一致`);
    } else {
      ok.push(`Chart.yaml 必需字段齐备（name / version ${fields.get("version")} / appVersion ${fields.get("appVersion")}）`);
    }
  }
}

// ------------------------------------------------- 2~4. 模板引用完整性
const templateFiles = fs.existsSync(TEMPLATES_DIR)
  ? fs.readdirSync(TEMPLATES_DIR).filter((f) => /\.(yaml|tpl)$/.test(f))
  : [];

if (templateFiles.length === 0) {
  errors.push("templates/ 下没有 .yaml / .tpl 文件");
}

const valuesPath = path.join(CHART_DIR, "values.yaml");
const defined = fs.existsSync(valuesPath)
  ? collectValueKeys(fs.readFileSync(valuesPath, "utf8"))
  : { top: new Set(), sub: new Map() };
if (!fs.existsSync(valuesPath)) errors.push("缺少 values.yaml");

// 被引用的键 / 命名模板 / 模板文件，跨所有模板文件汇总
const usedTopKeys = new Set();
const missingValues = new Set();
const usedTemplates = new Set();
const missingTemplates = new Set();
const missingFiles = new Set();

for (const file of templateFiles) {
  const text = fs.readFileSync(path.join(TEMPLATES_DIR, file), "utf8");

  // 2. .Values.<top>[.<sub>]
  for (const m of text.matchAll(/\.Values\.([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?/g)) {
    const [, top, sub] = m;
    usedTopKeys.add(top);
    if (!defined.top.has(top)) {
      missingValues.add(`${top}${sub ? `.${sub}` : ""}`);
    } else if (sub && !defined.sub.get(top)?.has(sub)) {
      missingValues.add(`${top}.${sub}`);
    }
  }

  // 3. include "x" / template "x" —— 注意 `include (print ...)` 不会被误匹配
  for (const m of text.matchAll(/\binclude\s+"([^"]+)"/g)) usedTemplates.add(m[1]);
  for (const m of text.matchAll(/\{\{[^}]*?\btemplate\s+"([^"]+)"/g)) usedTemplates.add(m[1]);

  // 4. $.Template.BasePath "/x.yaml" —— 用于 checksum 注解
  for (const m of text.matchAll(/\$\.Template\.BasePath\s+"\/([^"]+)"/g)) {
    if (!templateFiles.includes(m[1])) missingFiles.add(m[1]);
  }
}

// define "x" 只可能出现在 _helpers.tpl 之类的 .tpl 里，但全扫一遍更省心
const definedTemplates = new Set();
for (const file of templateFiles) {
  const text = fs.readFileSync(path.join(TEMPLATES_DIR, file), "utf8");
  for (const m of text.matchAll(/\bdefine\s+"([^"]+)"/g)) definedTemplates.add(m[1]);
}

if (missingValues.size > 0) {
  errors.push(
    `模板引用了 values.yaml 中未定义的键（Helm 会静默渲染成空）：${[...missingValues].sort().join(" / ")}`,
  );
} else if (templateFiles.length > 0) {
  ok.push(`模板引用的 .Values.* 键全部有定义（${usedTopKeys.size} 个顶层键）`);
}

for (const t of usedTemplates) {
  if (!definedTemplates.has(t)) missingTemplates.add(t);
}
if (missingTemplates.size > 0) {
  errors.push(`引用了未定义的命名模板：${[...missingTemplates].sort().join(" / ")}`);
} else if (usedTemplates.size > 0) {
  ok.push(`引用的命名模板全部已定义（${usedTemplates.size} 个）`);
}

if (missingFiles.size > 0) {
  errors.push(`$.Template.BasePath 引用了不存在的模板文件：${[...missingFiles].sort().join(" / ")}`);
} else if (templateFiles.length > 0) {
  ok.push(`$.Template.BasePath 引用的模板文件全部存在`);
}

// 5. 死值警告（不阻断）
const unused = [...defined.top].filter((k) => !usedTopKeys.has(k)).sort();
if (unused.length > 0) {
  warnings.push(`values.yaml 中未被任何模板引用的顶层键：${unused.join(" / ")}`);
}

// ---------------------------------------------------------------------- 输出
console.log("M8-5 Helm chart 静态校验（不替代 helm lint / helm template，真机验收仍待人工）");
console.log(`chart: ${path.relative(ROOT, CHART_DIR)}`);
console.log("");

for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of warnings) console.log(`  ⚠ ${line}`);
console.log("");

if (errors.length > 0) {
  console.error("❌ Helm chart 校验失败：");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("✅ Helm chart 校验通过");
