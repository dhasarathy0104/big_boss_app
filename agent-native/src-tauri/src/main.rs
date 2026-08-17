#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod backend;
mod context;
mod local_server;
mod screenshot;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let status_item = MenuItem::with_id(app, "status", "Starting…", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status_item, &quit_item])?;

            // Tauri's Image wants raw RGBA + dimensions, not encoded PNG bytes.
            let icon_png = include_bytes!("../icons/32x32.png");
            let decoded = image::load_from_memory(icon_png)?.to_rgba8();
            let (icon_w, icon_h) = decoded.dimensions();
            let icon = Image::new_owned(decoded.into_raw(), icon_w, icon_h);

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Desklog Agent")
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            let status_item_for_agent = status_item.clone();
            tauri::async_runtime::spawn(async move {
                agent::run(move |text: String| {
                    let _ = status_item_for_agent.set_text(text);
                })
                .await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running desklog agent");
}
