// Agent Runtime Console — Desktop shell (Tauri v2)
//
// 窗口加载 `examples/web` 控制台：dev 由 `beforeDevCommand` 启动 Node server
// （http://localhost:8787，提供 API + 静态）；release 以 Tauri sidecar 启动
// app 自带 Node 运行时执行打包好的 server bundle（见 build-server.mjs）。
// 本壳不依赖任何内部 API，与 examples 其他演示同源消费 `@node-agent-runtime/core` 公共能力。

use serde::Serialize;
use tauri::Builder;
use tauri_plugin_updater::UpdaterExt;

/// 更新检查结果（P5.4）：前端据此展示「发现新版本 x.y.z」并提供安装入口。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    available: bool,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
}

/// 查询是否有新版本；未配置 endpoints 或网络不可达时返回错误文本。
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            current_version: update.current_version.clone(),
            version: Some(update.version.clone()),
            notes: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            current_version,
            version: None,
            notes: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

/// 下载并安装有更新，完成后重启应用（P5.4）。
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "当前没有可用更新".to_string())?;

    update
        .download_and_install(|_chunk_len, _content_len| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    // 永不返回：进程在此重启。
    app.restart();
}

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
        // P5.4：以自定义命令暴露更新能力，前端无需引入额外 npm 包
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![check_update, install_update])
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
