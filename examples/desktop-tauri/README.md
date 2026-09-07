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

## 生产打包（sidecar，已接入）

生产模式下 Rust 在 `setup` 中以 Tauri **sidecar** 启动 Node 运行时跑
`examples/web/server.ts`（监听 `http://localhost:8787`），窗口 `url` 固定指向该地址，
因此 dev 与生产共用同一控制台与 API 面。生产打包前需在 `tauri.conf.json` 的
`bundle.externalBin` 加入 `["binaries/agent-server"]`（骨架当前未写死该配置，避免无二进制时
阻断 `tauri build`）；`lib.rs` 的 `spawn_server` 仅在 release（非 debug）构建生效，
避免与 dev 的 `beforeDevCommand` 重复拉起。

前置（打包前一次性）：将 server 打包为 sidecar 二进制放入 `src-tauri/binaries/`：
- macOS：`agent-server`（可执行，`chmod +x`）
- Windows：`agent-server.exe`
- Linux：`agent-server`

推荐方式（任选）：
1. 用 `esbuild` 将 `examples/web/server.ts` 打包为单文件 CJS/ESM，再用 `pkg` 或
   `bun build --compile` 编为平台二进制；
2. 或直接随包分发 `node` + `tsx`，将 `lib.rs` 的 `new_sidecar("agent-server")`
   改为 `tauri::process::Command::new("node").args(["examples/web/server.ts"])`。

> dev 演示：`npm run tauri dev` 仍由 `beforeDevCommand` 启 Node server，无需 sidecar 二进制。

## 与拆包（C8 host）的关系

Desktop 壳不引用任何内部模块，仅通过 `examples/web` 的 HTTP 面消费 `core`
公共能力。未来若拆 C8 host，examples 整体把 import 源从 core 换成 host 即可，
本壳无需改动。
