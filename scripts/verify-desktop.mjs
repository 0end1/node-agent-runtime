/**
 * P5.1 · 桌面产物验收（macOS）。
 *
 * 在真实目标机上把"双击 .app / 安装 dmg"的口头验收变成可复跑、可留痕的检查：
 *   1. 产物结构（.app / dmg 是否存在，Resources 里 sidecar 三件套是否齐全）
 *   2. 代码签名与 Gatekeeper（`codesign` / `spctl` —— 未签名或未公证会明确报出）
 *   3. dmg 挂载后内容核对（对应"安装到 /Applications 复验"的前置）
 *   4. 可选 `--launch`：真的拉起 .app 并对 :8787 探活（对应"窗口渲染 + 控制台可用"）
 *
 * Usage:
 *   node scripts/verify-desktop.mjs
 *   node scripts/verify-desktop.mjs --launch               # 额外启动并探活
 *   node scripts/verify-desktop.mjs --app=/path/to/X.app
 *   node scripts/verify-desktop.mjs --json                 # 机器可读输出
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd());
const DEFAULT_APP = join(
  REPO_ROOT,
  "examples/desktop-tauri/src-tauri/target/release/bundle/macos/Agent Runtime Console.app",
);
const BUNDLE_DIR = join(REPO_ROOT, "examples/desktop-tauri/src-tauri/target/release/bundle");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const doLaunch = args.includes("--launch");
const appArg = args.find((a) => a.startsWith("--app="));
const APP = appArg ? appArg.slice("--app=".length) : DEFAULT_APP;

const checks = [];
const add = (name, ok, detail = "") => checks.push({ name, ok, detail });

function run(cmd, cmdArgs, allowFail = true) {
  try {
    const out = execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (err) {
    if (!allowFail) throw err;
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() };
  }
}

// ---- 1. 产物结构 ----------------------------------------------------------
add(".app 存在", existsSync(APP), APP);
if (existsSync(APP)) {
  const resources = join(APP, "Contents/Resources");
  const macos = join(APP, "Contents/MacOS");
  add("可执行文件存在", existsSync(macos) && readdirSync(macos).length > 0, macos);

  for (const item of ["agent-server.js", "public"]) {
    add(`Resources 含 ${item}`, existsSync(join(resources, item)), join(resources, item));
  }
  const sidecar = existsSync(resources)
    ? readdirSync(resources).find((f) => f.startsWith("node-"))
    : undefined;
  add("Resources 含 sidecar node-<triple>", Boolean(sidecar), sidecar ?? "未找到");

  const info = run("defaults", ["read", join(APP, "Contents/Info.plist"), "CFBundleIdentifier"]);
  add("Info.plist 可读", info.ok, info.out.trim());

  // ---- 2. 签名 ----------------------------------------------------------
  const sign = run("codesign", ["-dv", "--verbose=2", APP]);
  add("代码签名（codesign -dv）", sign.ok, sign.ok ? "已签名" : sign.out.split("\n")[0] ?? "未签名");

  const gate = run("spctl", ["--assess", "--type", "execute", "--verbose=2", APP]);
  add(
    "Gatekeeper（spctl --assess）",
    gate.ok,
    gate.ok ? "accepted" : (gate.out.split("\n")[0] || "rejected（未签名或未公证，见 P5.2）").trim(),
  );
}

// ---- 3. dmg ---------------------------------------------------------------
const dmgDir = join(BUNDLE_DIR, "dmg");
if (existsSync(dmgDir)) {
  const dmg = readdirSync(dmgDir).find((f) => f.endsWith(".dmg"));
  add("dmg 产物存在", Boolean(dmg), dmg ?? "未找到");
  if (dmg) {
    const mount = mkdtempSync(join(tmpdir(), "ar-dmg-"));
    const attach = run("hdiutil", ["attach", join(dmgDir, dmg), "-nobrowse", "-quiet", "-mountpoint", mount]);
    add("dmg 可挂载", attach.ok, attach.out.trim());
    if (attach.ok) {
      const mounted = readdirSync(mount);
      add("dmg 内含 .app", mounted.some((f) => f.endsWith(".app")), mounted.join(", "));
      run("hdiutil", ["detach", mount, "-quiet"]);
    }
    rmSync(mount, { recursive: true, force: true });
  }
} else {
  add("dmg 产物存在", false, `未找到目录：${dmgDir}`);
}

// ---- 4. 可选：启动并探活 ---------------------------------------------------
if (doLaunch && existsSync(APP)) {
  const exe = join(APP, "Contents/MacOS", readdirSync(join(APP, "Contents/MacOS"))[0]);
  const child = spawn(exe, [], { env: { ...process.env }, stdio: "ignore", detached: false });
  let healthy = false;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:8787/healthz");
      if (res.ok && (await res.json())?.ok === true) {
        healthy = true;
        break;
      }
    } catch {
      /* 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill("SIGKILL");
  add("启动 .app 后 :8787 探活", healthy, healthy ? "窗口内控制台可用" : "60s 内未就绪");
}

// ---- 输出 -----------------------------------------------------------------
const failed = checks.filter((c) => !c.ok);
if (asJson) {
  console.log(JSON.stringify({ checks, ok: failed.length === 0 }, null, 2));
} else {
  console.log("P5.1 桌面产物验收");
  for (const c of checks) {
    console.log(`  ${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(failed.length === 0 ? "\n✅ 全部通过" : `\n❌ ${failed.length} 项未通过`);
}
process.exit(failed.length === 0 ? 0 : 1);
