// Agent Runtime Console — Desktop shell (Tauri v2)
//
// 窗口仅加载 `examples/web` 控制台（dev 模式由 `beforeDevCommand` 启动 Node server
// 于 http://localhost:8787，提供 API + 静态资源）。本壳不依赖任何内部 API，
// 与 examples/cli.ts、examples/web 同源消费 `@agent-runtime/core` 公共能力。

use tauri::Builder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Agent Runtime Console");
}
