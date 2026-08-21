#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod backend;
mod context;
mod local_server;
mod screenshot;

use backend::AgentConfig;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

// Only an enrolled employee should live on in the tray after its window
// closes (that's the whole point — silent background tracking). Admins,
// super admins, and the first-run setup window should behave like a normal
// app: closing the window quits it, since there's no ongoing background job
// and no tray icon for those paths to quit from otherwise.
struct StaysInTray(AtomicBool);

fn tray_icon() -> Image<'static> {
    let icon_png = include_bytes!("../icons/32x32.png");
    let decoded = image::load_from_memory(icon_png)
        .expect("bundled tray icon is a valid PNG")
        .to_rgba8();
    let (w, h) = decoded.dimensions();
    Image::new_owned(decoded.into_raw(), w, h)
}

// Opens (or focuses, if already open) a full-size window pointed at the
// dashboard, handing it an already-authenticated session via a URL token —
// the dashboard's own App.jsx picks it up on load — so it opens straight onto
// the right role's view instead of showing its login screen a second time
// right after a native login form already collected the password.
fn open_dashboard_window_with_token(app: &AppHandle, backend_url: &str, token: &str) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let url_str = format!("{backend_url}/?token={token}");
    let url = Url::parse(&url_str).map_err(|e| tauri::Error::InvalidUrl(e))?;
    WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::External(url))
        .title("BIG BOSS")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .build()?;
    Ok(())
}

// The "I am a(n)" chooser — shown on every launch (cold start or a
// deliberate reopen while already running), per explicit request.
fn open_setup_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("setup") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
        .title("BIG BOSS")
        .inner_size(420.0, 520.0)
        .resizable(false)
        .center()
        .build()?;
    Ok(())
}

/// Builds the tray icon and starts the tracking loops. Called either at
/// startup (config already on disk) or right after the setup window enrolls.
fn start_tray_and_tracking(app: &AppHandle, cfg: AgentConfig, backend_url: String, agent_name: String) -> tauri::Result<()> {
    let status_item = MenuItem::with_id(app, "status", "Starting…", false, None::<&str>)?;
    let dashboard_item = MenuItem::with_id(app, "dashboard", "Open My Dashboard", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&status_item, &dashboard_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(tray_icon())
        .menu(&menu)
        .tooltip("BIG BOSS")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "quit" => app.exit(0),
                // Viewing the dashboard always requires a fresh login (this
                // opens the setup window's dashboard-login screen, not the
                // dashboard itself) — tracking keeps running either way.
                "dashboard" => {
                    let _ = open_setup_window(app);
                }
                _ => {}
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

    app.state::<StaysInTray>().0.store(true, Ordering::Relaxed);
    let _ = app.autolaunch().enable();
    start_tray_and_tracking(&app, cfg, backend_url, name).map_err(|e| e.to_string())?;

    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }

    Ok(manager_label)
}

// The one login used by every role after picking Employee or Admin/Super
// Admin — same account as the dashboard website. An employee account also
// carries an agent_key, so this both starts background tracking and opens
// the dashboard; a manager/super admin account just opens the dashboard.
// Always asked fresh on every launch, by explicit request — no "remember me".
#[tauri::command]
async fn submit_login(app: AppHandle, backend_url: String, name: String, password: String) -> Result<(), String> {
    let trimmed = backend_url.trim().trim_end_matches('/').to_string();
    let outcome = agent::login(&name, &password, &trimmed).await?;

    if let Some(cfg) = outcome.agent_config {
        app.state::<StaysInTray>().0.store(true, Ordering::Relaxed);
        let _ = app.autolaunch().enable();
        start_tray_and_tracking(&app, cfg, trimmed.clone(), name).map_err(|e| e.to_string())?;
    }

    open_dashboard_window_with_token(&app, &trimmed, &outcome.token).map_err(|e| e.to_string())?;

    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }
    Ok(())
}

// Open self-service manager/superadmin signup — no invite link required.
// Otherwise identical to submit_login (a fresh admin account never carries
// an agent_key, so this never starts tracking, only opens the dashboard).
#[tauri::command]
async fn submit_register_admin(app: AppHandle, backend_url: String, name: String, password: String, role: String) -> Result<(), String> {
    let trimmed = backend_url.trim().trim_end_matches('/').to_string();
    let outcome = agent::register_admin(&name, &password, &role, &trimmed).await?;

    open_dashboard_window_with_token(&app, &trimmed, &outcome.token).map_err(|e| e.to_string())?;

    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }
    Ok(())
}

// Tells the setup window which screen to open on: an employee PC that's
// already tracking silently in the background skips straight to a
// dashboard-only login (server address already known) instead of the full
// "I am a(n)" chooser, which would be a confusing question to ask again on a
// machine that's already been set up.
#[tauri::command]
fn is_tracking_active() -> bool {
    agent::load_config().is_some()
}

// Viewing the dashboard always requires a fresh login, for every role —
// separate from whatever tracking is already silently running, which this
// never touches. Used when the setup window opens straight to the
// dashboard-login screen (see is_tracking_active).
#[tauri::command]
async fn submit_dashboard_login(app: AppHandle, name: String, password: String) -> Result<(), String> {
    let cfg = agent::load_config().ok_or_else(|| "no saved connection found".to_string())?;
    let outcome = agent::login(&name, &password, &cfg.backend_url).await?;

    open_dashboard_window_with_token(&app, &cfg.backend_url, &outcome.token).map_err(|e| e.to_string())?;

    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Must be registered first. Without this, every reopen (or an
        // auto-start launch racing a manual one) silently starts a second
        // fully independent copy of the agent, each with its own tray icon —
        // confusing, and only the most-recently-started one's local browser-
        // extension listener actually wins the port.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("setup") {
                let _ = window.show();
                let _ = window.set_focus();
                return;
            }
            if let Some(window) = app.get_webview_window("dashboard") {
                let _ = window.show();
                let _ = window.set_focus();
                return;
            }
            // Already running silently (employee tray mode) with no window
            // open — this callback only fires when someone deliberately tries
            // to launch the app again (e.g. clicking the Start Menu icon), as
            // opposed to the original silent auto-start-at-login launch. Opens
            // straight to the dashboard-login screen (is_tracking_active makes
            // that call), since we already know this is an employee machine.
            let _ = open_setup_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(StaysInTray(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            submit_setup,
            submit_login,
            submit_register_admin,
            is_tracking_active,
            submit_dashboard_login
        ])
        .setup(|app| {
            if let Some(cfg) = agent::load_config() {
                // Employee already enrolled — resume tracking silently, no
                // window at all. Auto-start-at-login stays truly silent this
                // way; viewing the dashboard is a separate, always-fresh
                // login (see submit_dashboard_login), not tied to this.
                app.state::<StaysInTray>().0.store(true, Ordering::Relaxed);
                let _ = app.autolaunch().enable();
                let backend_url = cfg.backend_url.clone();
                let agent_name = cfg.name.clone();
                start_tray_and_tracking(app.handle(), cfg, backend_url, agent_name)?;
            } else {
                // No saved tracking config — first run, or an admin/super
                // admin machine (which never persists anything). Always ask
                // "I am a(n) Employee / Admin or Super Admin".
                open_setup_window(app.handle())?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building desklog agent")
        .run(|app_handle, event| {
            // Employees live in the tray — closing a window must never quit
            // the app, only the tray menu's "Quit" does that. Admins/super
            // admins and the first-run setup window have no tray icon, so
            // they should behave like a normal app and exit on window close.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app_handle.state::<StaysInTray>().0.load(Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
        });
}
