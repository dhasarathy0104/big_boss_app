#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod backend;
mod context;
mod local_server;
mod screenshot;

use backend::AgentConfig;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn tray_icon() -> Image<'static> {
    let icon_png = include_bytes!("../icons/32x32.png");
    let decoded = image::load_from_memory(icon_png)
        .expect("bundled tray icon is a valid PNG")
        .to_rgba8();
    let (w, h) = decoded.dimensions();
    Image::new_owned(decoded.into_raw(), w, h)
}

/// Builds the tray icon and starts the tracking loops. Called either at
/// startup (config already on disk) or right after the setup window enrolls.
fn start_tray_and_tracking(app: &AppHandle, cfg: AgentConfig, backend_url: String, agent_name: String) -> tauri::Result<()> {
    let status_item = MenuItem::with_id(app, "status", "Starting…", false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&status_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(tray_icon())
        .menu(&menu)
        .tooltip("Desklog Agent")
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                app.exit(0);
            }
        })
        .build(app)?;

    tauri::async_runtime::spawn(async move {
        agent::start_tracking(cfg, backend_url, agent_name, move |text: String| {
            let _ = status_item.set_text(text);
        })
        .await;
    });

    Ok(())
}

#[tauri::command]
async fn submit_setup(app: AppHandle, name: String, invite_token: String, backend_url: String) -> Result<String, String> {
    let cfg = agent::enroll_and_save(&name, Some(invite_token), &backend_url).await?;
    let manager_label = cfg.manager_name.clone().unwrap_or_else(|| "your manager".to_string());

    start_tray_and_tracking(&app, cfg, backend_url, name).map_err(|e| e.to_string())?;

    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }

    Ok(manager_label)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![submit_setup])
        .setup(|app| {
            if let Some(cfg) = agent::load_config() {
                start_tray_and_tracking(app.handle(), cfg, agent::default_backend_url(), agent::default_agent_name())?;
            } else {
                WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                    .title("Connect Desklog Agent")
                    .inner_size(420.0, 480.0)
                    .resizable(false)
                    .center()
                    .build()?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building desklog agent")
        .run(|_app_handle, event| {
            // This app lives in the tray — closing the setup window (or any
            // window) must never quit it. Only the tray menu's "Quit" does that.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
