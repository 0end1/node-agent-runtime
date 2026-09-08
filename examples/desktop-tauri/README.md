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
- `agent-server.js` —— `examples/web/server.ts` 经 esbuild 打成的自包含 CJS 单文件
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

## 与拆包（C8 host）的关系

Desktop 壳不引用任何内部模块，仅通过 `examples/web` 的 HTTP 面消费 Agent Runtime
公共能力。C8 host 已于 M6 拆为 `@agent-runtime/host`，CLI/Web 示例均改从对应子包
导入（`@agent-runtime/core` / `@agent-runtime/host` / `@agent-runtime/mock` /
`@agent-runtime/tools-basic` 等，见 README「项目结构」）；本壳不参与包内实现，
后续包结构再调整也无需改动本壳。
