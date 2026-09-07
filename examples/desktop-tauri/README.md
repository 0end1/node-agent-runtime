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

## 生产打包（#5 验收前补齐）

当前 dev 模式演示已可走完桌面全流程。生产打包需 Node 运行时随应用启动：
用 cargo sidecar 打包 `tsx examples/web/server.ts`（或预编译产物），在
`tauri.conf.json` 配置 `bundle.externalBin`，Rust 侧以
`tauri::process::Command` 拉起 server，再让窗口加载 `http://localhost:8787`。
此项列入 M5 #5 验收前完成。

## 与拆包（C8 host）的关系

Desktop 壳不引用任何内部模块，仅通过 `examples/web` 的 HTTP 面消费 `core`
公共能力。未来若拆 C8 host，examples 整体把 import 源从 core 换成 host 即可，
本壳无需改动。
