# Agent Runtime Console — Desktop (Tauri v2)

将 `examples/web` 控制台装入桌面窗口，作为 M5「Desktop 壳」交付物。
技术栈：**Tauri v2**，仅依赖 `@agent-runtime/core` 公共 API（与 CLI/Web 演示同源）。

## 目录结构

```
examples/desktop-tauri/
├── package.json          # Tauri CLI 脚本（dev / build / tauri）
├── README.md
└── src-tauri/            # Rust 应用
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── src/main.rs       # 入口，委托 lib::run
    ├── src/lib.rs        # 加载 web 控制台
    └── icons/            # 首次需生成（见下）
```

## 前置

- Rust 工具链（[rustup](https://rustup.rs/)）
- Node ≥ 18.17（sqlite 演示需 ≥ 22.13，见 `docs/m5-productization.md` §5）
- 在 `examples/desktop-tauri` 安装 CLI：`npm install`

## 运行（dev）

```bash
cd examples/desktop-tauri
npm install
npm run tauri dev
```

Tauri 会先执行 `beforeDevCommand: npm run demo:web`（启动 Node server 于
`http://localhost:8787`，提供 API + 静态资源），再开窗口加载该地址。
Web 控制台的全部能力（审批、artifact、续跑、会话切换、store-sqlite 演示）在桌面窗口内可用。

## 图标（首次必做）

Tauri 上下文生成依赖图标。首次需用任意 PNG 生成：

```bash
cd examples/desktop-tauri/src-tauri
npx tauri icon path/to/icon.png   # 生成 src-tauri/icons/*
```

未生成图标前 `tauri dev` / `tauri build` 会报错。

## 生产打包（自带 Node sidecar，已验证）

```bash
cd examples/desktop-tauri
npm install
npm run build          # = tauri build
```

`beforeBuildCommand`（`build-server.mjs`）在打包前生成三样产物到 `src-tauri/binaries/`：
- `agent-server.js` —— `examples/web/server.ts` 经 esbuild 打成的自包含 ESM 单文件（同目录 `package.json` 声明 `type: module`，不依赖 Node 的模块语法探测）
- `node-<triple>` —— 当前 Node 运行时副本（**app 自带，不依赖目标机安装 Node**）
- `public/` —— 控制台静态资源

打包后的 app 结构：

```
Agent Runtime Console.app/Contents/
├── MacOS/      desktop-tauri, node          # externalBin: binaries/node
└── Resources/  agent-server.js, public/     # resources（平铺）
```

release 构建时 `lib.rs` 的 `spawn_server` 通过 `tauri-plugin-shell` 的 sidecar 启动自带
`node` 执行 `Resources/agent-server.js`，并用 `AGENT_CONSOLE_PUBLIC_DIR` 把
`Resources/public` 告知 server（dev/demo 不设该变量时仍用模块同目录 `public/`）。
窗口 `url` 仍为 `http://localhost:8787`，dev 与生产共用同一控制台与 API 面。
该函数仅在 release（非 debug）生效，避免与 dev 的 `beforeDevCommand` 重复拉起。

产物：`target/release/bundle/macos/*.app`、`target/release/bundle/dmg/*.dmg`。
已验证：用 app 自带 `node` + bundle 实跑，`GET :8787 → 200`。

> `src-tauri/binaries/` 已被 `.gitignore` 忽略（含 ~110MB Node 副本，不入库）。

## 发布工程（P5）

### 产物验收（P5.1）

`npm run verify:desktop` 把"双击 .app / dmg 安装复验"变成可复跑的检查（macOS）：

```bash
node scripts/verify-desktop.mjs            # 结构 + 签名 + Gatekeeper + dmg 挂载
node scripts/verify-desktop.mjs --launch   # 额外拉起 .app 并对 :8787 探活
node scripts/verify-desktop.mjs --json     # 机器可读输出
```

检查项：`.app` 与可执行文件、`Resources/` 含 sidecar 三件套（`agent-server.js`、`public/`、`node-<triple>`）、`Info.plist`、`codesign -dv` 签名状态、`spctl --assess` Gatekeeper 结论、dmg 可挂载且内含 `.app` 与 `Applications`。

> 现状（2026-09-09）：仓库里的 `.app`/`.dmg` 是在 `build-server.mjs` 缺失期间打出的旧产物——`Resources/` 缺 sidecar `node-<triple>`，且未签名（`spctl` rejected）。补齐脚本后需重新 `npm run build` 才能得到真正可跑的产物；完整实机验收（双击无 Gatekeeper 告警）依赖下节签名与公证。

### 签名与公证（P5.2）

`tauri build` 经环境变量启用，证书与账号信息一律不入库：

| 变量 | 用途 |
| --- | --- |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application 证书（base64 后的 `.p12`） |
| `APPLE_SIGNING_IDENTITY` | 签名身份，如 `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公证提交账号（密码用 App 专用密码） |

本地验收：

```bash
codesign -dv --verbose=4 "target/release/bundle/macos/Agent Runtime Console.app"
spctl --assess --type execute --verbose=2 "target/release/bundle/macos/Agent Runtime Console.app"  # 期望 accepted
```

CI：`.github/workflows/desktop.yml` 读取同名 secrets；未配置时 tauri-action 跳过签名（产物仍会 rejected）。

### 三平台构建矩阵（P5.3）

`.github/workflows/desktop.yml` 在 push tag `v*` 或手动触发时构建三平台产物并上传 artifact（draft Release）：

| 平台 | 产物 |
| --- | --- |
| macOS | `.app` / `.dmg` |
| Linux | `.AppImage` / `.deb` |
| Windows | `.msi` / `.exe` |

sidecar Node 由 `build-server.mjs` 准备：同 OS 构建同平台产物时复用当前解释器；**交叉编译必须**用 `NODE_BIN` 指向目标平台的 node 二进制（如 macOS 上出 x64 包需 `NODE_BIN=<x64 node>` + `--target x86_64-apple-darwin`）。

### 自动更新（P5.4，可选门）

链路已接齐：`examples/web` 控制台仅以 HTTP 交互，因此更新能力不引前端 npm 依赖，而是
由 Rust 侧自定义命令（`lib.rs` 的 `check_update` / `install_update`）暴露，前端通过
Tauri 注入的 IPC 调用。

- `src-tauri/Cargo.toml`：`tauri-plugin-updater`
- `tauri.conf.json`：`plugins.updater`（`endpoints` 指向 GitHub Release 的
  `latest/download/latest.json`，`pubkey` 来自本仓库生成的签名密钥对）；
  `bundle.createUpdaterArtifacts: true`（构建即产出可发布的更新包）
- `src-tauri/capabilities/default.json`：控制台以 `http://localhost:8787` 的 remote
  origin 加载，此处放行该 origin 的 IPC
- `examples/web/public/index.html`：标题栏「检查更新 → 下载并安装」入口，点击后
  依次调用 `check_update` / `install_update`（应用安装完成后自动重启）；
  仅 Tauri 壳内显示（检测 `window.__TAURI_INTERNALS__`），浏览器直开无该入口

本地签名密钥对在 `src-tauri/.tauri/`（该目录被根 `.gitignore` 忽略，私钥绝不入库）：

| 文件 | 用途 |
| --- | --- |
| `.tauri/console.key` | 私钥 —— 构建更新包时经 `TAURI_SIGNING_PRIVATE_KEY` 提供 |
| `.tauri/console.key.pub` | 公钥 —— 内容已填入 `tauri.conf.json` 的 `plugins.updater.pubkey` |

`createUpdaterArtifacts: true` 意味着**打包时即需签名**，本地构建与 CI 的 tag 发布都必须注入私钥（可为私钥文件路径或内容）：

```bash
cd examples/desktop-tauri
export TAURI_SIGNING_PRIVATE_KEY="$PWD/.tauri/console.key"   # 或直接写私钥内容
# export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."            # 生成密钥时若设置过密码
npm run build
```

> - 换机/换 CI 后需把私钥导入仓库 Secrets（`TAURI_SIGNING_PRIVATE_KEY`），否则
>   `tauri build` 会在 updater 签名阶段失败。
> - macOS 自动更新同时依赖 P5.2 的 Developer ID 签名与公证；未签名产物无法完成更新安装。
> - 首次发 tag（`v*`，触发 `.github/workflows/desktop.yml`）把更新包连同 `latest.json`
>   发布到 GitHub Release 后，即可在旧版本应用中点「检查更新」走通「旧版 → 新版」链路。

## 与拆包（C8 host）的关系

Desktop 壳不引用任何内部模块，仅通过 `examples/web` 的 HTTP 面消费 Agent Runtime
公共能力。C8 host 已于 M6 拆为 `@agent-runtime/host`，CLI/Web 示例均改从对应子包
导入（`@agent-runtime/core` / `@agent-runtime/host` / `@agent-runtime/mock` /
`@agent-runtime/tools-basic` 等，见 README「项目结构」）；本壳不参与包内实现，
后续包结构再调整也无需改动本壳。
