// Agent Runtime Console — Desktop shell (Tauri v2)
//
// 窗口加载 `examples/web` 控制台：dev 由 `beforeDevCommand` 启动 Node server
// （http://localhost:8787，提供 API + 静态）；release 以 Tauri sidecar 启动
// app 自带 Node 运行时执行打包好的 server bundle（见 build-server.mjs）。
// 本壳不依赖任何内部 API，与 examples 其他演示同源消费 `@agent-runtime/core` 公共能力。

use tauri::Builder;

/// 生产（release）构建：以 sidecar 启动 app 自带 Node 运行时执行 server bundle。
/// 需先由 `beforeBuildCommand`（build-server.mjs）生成 binaries/agent-server.js 与 node-<triple>。
#[cfg(not(debug_assertions))]
fn spawn_server(app: &tauri::App) {
    use tauri::Manager;
    use tauri_plugin_shell::ShellExt;

    // app 自带 Node 运行时（externalBin: binaries/node）+ 打包好的 server bundle（resources），
    // 因此不依赖目标机器安装 Node。
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("无法定位 app resources 目录：{e}");
            return;
        }
    };
    let script = resource_dir.join("agent-server.js");

    let sidecar = match app.shell().sidecar("node") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("未找到 node sidecar，请先打包（见 README）：{e}");
            return;
        }
    };

    // 静态控制台由 Tauri 打包进 app resources（binaries/public → Resources/public），
    // 通过 env 告知 server。
    let public_dir = resource_dir.join("public");
    if let Err(e) = sidecar
        .args([script])
        .env("AGENT_CONSOLE_PUBLIC_DIR", public_dir)
        .spawn()
    {
        eprintln!("启动 node sidecar 失败: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    Builder::default()
        .plugin(tauri_plugin_shell::init())
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
