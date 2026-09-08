/**
 * P4.6 · Package size baseline + CI guard.
 *
 * Measures every publishable workspace package by asking npm what it would
 * pack (`npm pack --dry-run --json`), compares the result against
 * `scripts/size-baseline.json` and fails when a package grew by more than
 * `SIZE_THRESHOLD_PCT` (default 25%) in **package** (tarball) size.
 *
 * Usage:
 *   node scripts/size-report.mjs            # check against the baseline
 *   node scripts/size-report.mjs --update   # (re)write the baseline
 *
 * Writes a human-readable report to `coverage/size-report.txt`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "scripts", "size-baseline.json");
const REPORT_PATH = path.join(ROOT, "coverage", "size-report.txt");
const UPDATE = process.argv.includes("--update");
const THRESHOLD_PCT = Number(process.env.SIZE_THRESHOLD_PCT ?? 25);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

function packageNames() {
  const dir = path.join(ROOT, "packages");
  return fs
    .readdirSync(dir)
    .map((d) => JSON.parse(fs.readFileSync(path.join(dir, d, "package.json"), "utf8")).name)
    .sort();
}

function measure(name) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "-w", name], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
  });
  const entry = JSON.parse(out)[0];
  return {
    packageSize: entry.size ?? 0,
    unpackedSize: entry.unpackedSize ?? 0,
    entryCount: entry.entryCount ?? entry.files?.length ?? 0,
  };
}

const measured = packageNames().map((name) => ({ name, ...measure(name) }));

if (UPDATE) {
  const baseline = Object.fromEntries(
    measured.map(({ name, ...rest }) => [name, rest]),
  );
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`baseline written: ${path.relative(ROOT, BASELINE_PATH)}`);
}

const baseline = UPDATE
  ? Object.fromEntries(measured.map(({ name, ...rest }) => [name, rest]))
  : JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));

const rows = measured.map((m) => {
  const base = baseline[m.name];
  const deltaPct =
    base && base.packageSize ? ((m.packageSize - base.packageSize) / base.packageSize) * 100 : 0;
  return {
    package: m.name,
    tarball: kb(m.packageSize),
    unpacked: kb(m.unpackedSize),
    files: m.entryCount,
    baseline: base ? kb(base.packageSize) : "(new)",
    delta: base ? `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%` : "(new)",
    over: base ? deltaPct > THRESHOLD_PCT : false,
  };
});

const lines = [
  "P4.6 package size report",
  `threshold: +${THRESHOLD_PCT}% package (tarball) size vs baseline`,
  "",
  ["package".padEnd(28), "tarball".padStart(10), "unpacked".padStart(10), "files".padStart(6), "baseline".padStart(10), "delta".padStart(9)].join(" "),
  "-".repeat(78),
  ...rows.map((r) =>
    [
      r.package.padEnd(28),
      r.tarball.padStart(10),
      r.unpacked.padStart(10),
      String(r.files).padStart(6),
      r.baseline.padStart(10),
      r.delta.padStart(9),
    ].join(" "),
  ),
  "",
];
const report = lines.join("\n");
console.log(report);

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, report);

const offenders = rows.filter((r) => r.over);
if (offenders.length > 0) {
  console.error(
    `❌ 体积超阈值（>+${THRESHOLD_PCT}%）：\n` +
      offenders.map((r) => `  - ${r.package}: ${r.baseline} → ${r.tarball} (${r.delta})`).join("\n") +
      `\n若为有意增长，请运行 \`npm run size:update\` 更新基线并说明原因。`,
  );
  process.exit(1);
}
console.log("✅ 体积基线检查通过");
