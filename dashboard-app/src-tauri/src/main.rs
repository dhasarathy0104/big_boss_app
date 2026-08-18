#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const BACKEND_URL: &str = "http://localhost:4000";
const BACKEND_SERVER_JS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../backend/src/server.js");

struct BackendProcess(Mutex<Option<Child>>);

fn backend_is_up() -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .ok()
        .and_then(|c| c.get(format!("{BACKEND_URL}/api/managers")).send().ok())
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn main() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            std::thread::spawn(move || {
                if !backend_is_up() {
                    println!("Starting backend: node {BACKEND_SERVER_JS}");
                    match Command::new("node").arg(BACKEND_SERVER_JS).spawn() {
                        Ok(child) => {
                            let state = handle.state::<BackendProcess>();
                            *state.0.lock().unwrap() = Some(child);
                        }
                        Err(e) => eprintln!("Failed to start backend (is Node.js installed and on PATH?): {e}"),
                    }

                    // Give it a moment to actually bind the port before polling.
                    for _ in 0..30 {
                        if backend_is_up() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(500));
                    }
                }

                if !backend_is_up() {
                    eprintln!("Backend did not become ready in time — opening window anyway.");
                }

                let url: tauri::Url = BACKEND_URL.parse().unwrap();
                let _ = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                    .title("Desklog Dashboard")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(900.0, 600.0)
                    .build();
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building desklog dashboard")
        .run(|app_handle, event| {
            // Only kill the backend if we're the ones who started it — if it was
            // already running (e.g. a dev server), leave it alone on exit.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<BackendProcess>();
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
