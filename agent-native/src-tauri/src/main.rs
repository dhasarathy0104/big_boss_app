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

// Opens (or focuses, if already open) a full-size window pointed straight at
// the dashboard website. Login, session persistence, and role-based routing
// are all handled by the dashboard itself, exactly as if it were opened in a
// browser — nothing extra to build here.
fn open_dashboard_window(app: &AppHandle, backend_url: &str) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let url = Url::parse(backend_url).map_err(|e| tauri::Error::InvalidUrl(e))?;
    WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::External(url))
        .title("Desklog")
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
        .title("Desklog")
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

    let dashboard_url = backend_url.clone();
    TrayIconBuilder::new()
        .icon(tray_icon())
        .menu(&menu)
        .tooltip("Desklog Agent")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "quit" => app.exit(0),
                "dashboard" => {
                    let _ = open_dashboard_window(app, &dashboard_url);
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

// Admin / super admin path: no enrollment, no tracking — just remember the
// server address and hand off to the dashboard website for everything else
// (login, session, role-based view).
#[tauri::command]
async fn submit_viewer_setup(app: AppHandle, backend_url: String) -> Result<(), String> {
    let trimmed = backend_url.trim().trim_end_matches('/').to_string();
    agent::check_backend_reachable(&trimmed).await?;
    agent::save_viewer_config(&trimmed);

    open_dashboard_window(&app, &trimmed).map_err(|e| e.to_string())?;

    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }
    Ok(())
}

// The "I am a(n)" screen always shows on every launch — these two commands
// let each button try to resume an already-configured role first, so
// picking the same answer as before never requires re-pasting the invite
// link or server address. Returns false only when there's genuinely nothing
// saved yet, telling the UI to show that role's setup form instead.
#[tauri::command]
fn try_resume_employee(app: AppHandle) -> bool {
    let Some(cfg) = agent::load_config() else { return false };
    let backend_url = if cfg.backend_url.is_empty() {
        agent::default_backend_url()
    } else {
        cfg.backend_url.clone()
    };
    if start_tray_and_tracking(&app, cfg, backend_url, agent::default_agent_name()).is_err() {
        return false;
    }
    app.state::<StaysInTray>().0.store(true, Ordering::Relaxed);
    let _ = app.autolaunch().enable();
    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }
    true
}

#[tauri::command]
fn try_resume_viewer(app: AppHandle) -> bool {
    let Some(backend_url) = agent::load_viewer_config() else { return false };
    if open_dashboard_window(&app, &backend_url).is_err() {
        return false;
    }
    if let Some(setup_window) = app.get_webview_window("setup") {
        let _ = setup_window.close();
    }
    true
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
            // opposed to the original silent auto-start-at-login launch. Show
            // the same "I am a(n)" chooser as any other launch, per explicit
            // request that it always appears — not a shortcut straight to the
            // dashboard, which would skip it.
            let _ = open_setup_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(StaysInTray(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            submit_setup,
            submit_viewer_setup,
            try_resume_employee,
            try_resume_viewer
        ])
        .setup(|app| {
            // Always ask "I am a(n) Employee / Admin or Super Admin" on every
            // launch, by explicit request — the chooser's buttons call
            // try_resume_employee/try_resume_viewer first, so picking the
            // same role as before resumes instantly without re-entering
            // anything; only a genuinely new setup shows a form.
            open_setup_window(app.handle())?;
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
