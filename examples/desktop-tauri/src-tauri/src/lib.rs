// Agent Runtime Console — Desktop shell (Tauri v2)
//
// 窗口加载 `examples/web` 控制台：dev 由 `beforeDevCommand` 启动 Node server
// （http://localhost:8787，提供 API + 静态）；release 以 Tauri sidecar 启动
// 预打包的 agent-server（见 tauri.conf.json bundle.externalBin）。
// 本壳不依赖任何内部 API，与 examples 其他演示同源消费 `@agent-runtime/core` 公共能力。

use tauri::Builder;

/// 生产（release）构建：以 sidecar 启动 Node 运行时跑 examples/web/server.ts。
/// 需预先把 server 打包为 src-tauri/binaries/agent-server（见 README「生产打包」）。
#[cfg(not(debug_assertions))]
fn spawn_server(app: &tauri::App) {
    match tauri::process::Command::new_sidecar("agent-server") {
        Ok(cmd) => {
            if let Err(e) = cmd.spawn(app.handle()) {
                eprintln!("启动 agent-server sidecar 失败: {e}");
            }
        }
        Err(e) => eprintln!("未找到 agent-server sidecar，请先打包（见 README）：{e}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            spawn_server(app);
            #[cfg(debug_assertions)]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Agent Runtime Console");
}
