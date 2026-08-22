use crate::backend::{ActivityEvent, AgentConfig, BackendClient};
use crate::context::get_context;
use crate::local_server::{self, SharedDomain};
use crate::screenshot::capture_primary_as_base64_jpeg;
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const POLL_INTERVAL_SECS: u64 = 10;
const FLUSH_INTERVAL_SECS: u64 = 30;
const DEFAULT_SCREENSHOT_INTERVAL_MIN: u32 = 5;
const SETTINGS_RECHECK_SECS: u64 = 60;
const IDLE_THRESHOLD_SECS: u32 = 120;
const LOCAL_PORT: u16 = 34909;
const BROWSER_APPS: [&str; 5] = ["chrome", "msedge", "firefox", "brave", "opera"];

fn config_dir() -> PathBuf {
    let dir = dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("DesklogAgent");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn config_path() -> PathBuf {
    config_dir().join("agent-config.json")
}

fn viewer_config_path() -> PathBuf {
    config_dir().join("viewer-config.json")
}

fn queue_path() -> PathBuf {
    config_dir().join("queue.json")
}

pub fn load_config() -> Option<AgentConfig> {
    let data = fs::read_to_string(config_path()).ok()?;
    let cfg: AgentConfig = serde_json::from_str(&data).ok()?;
    // A config saved before `backendUrl` existed deserializes with it empty
    // (#[serde(default)]) — treating that as "already set up" sends every
    // screen straight into a dead end (login posts to a base-less URL,
    // reqwest fails with an opaque "builder error"). Treat it as if nothing
    // were saved so the full chooser reappears and the user can re-enroll.
    if cfg.backend_url.trim().is_empty() {
        return None;
    }
    Some(cfg)
}

fn save_config(cfg: &AgentConfig) {
    if let Ok(data) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(config_path(), data);
    }
}

// Admin/super-admin path: no enrollment, no tracking — just remembers which
// server address to point the dashboard window at.
#[derive(serde::Serialize, serde::Deserialize)]
struct ViewerConfig {
    #[serde(rename = "backendUrl")]
    backend_url: String,
}

pub fn save_viewer_config(backend_url: &str) {
    let cfg = ViewerConfig { backend_url: backend_url.to_string() };
    if let Ok(data) = serde_json::to_string_pretty(&cfg) {
        let _ = fs::write(viewer_config_path(), data);
    }
}

fn load_queue() -> Vec<ActivityEvent> {
    fs::read_to_string(queue_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_queue(queue: &[ActivityEvent]) {
    if let Ok(data) = serde_json::to_string(queue) {
        let _ = fs::write(queue_path(), data);
    }
}

// Used by the first-run setup window (see main.rs's submit_setup command) and by
// the env-var flow for anyone still scripting enrollment directly.
pub async fn enroll_and_save(name: &str, password: &str, invite_token: Option<String>, backend_url: &str) -> Result<AgentConfig, String> {
    let client = BackendClient::new(backend_url.to_string());
    let mut cfg = client.enroll(name, password, invite_token).await?;
    cfg.name = name.to_string();
    cfg.backend_url = backend_url.to_string();
    save_config(&cfg);
    Ok(cfg)
}

pub struct LoginOutcome {
    pub token: String,
    // Only set for an employee account — that's the one role that also needs
    // a background tracking config, not just a dashboard session.
    pub agent_config: Option<AgentConfig>,
}

fn finish_login(resp: crate::backend::LoginResponse, backend_url: &str) -> LoginOutcome {
    let agent_config = if resp.user.role == "employee" {
        let cfg = AgentConfig {
            user_id: resp.user.id,
            agent_key: resp.user.agent_key,
            name: resp.user.name,
            manager_id: resp.user.manager_id,
            manager_name: resp.user.manager_name,
            backend_url: backend_url.to_string(),
        };
        save_config(&cfg);
        Some(cfg)
    } else {
        save_viewer_config(backend_url);
        None
    };
    LoginOutcome { token: resp.token, agent_config }
}

// One name+password login, used by every role: an employee's account also
// carries an agent_key, so this can start tracking directly — no separate
// invite-link enrollment needed for someone who already has a password set.
pub async fn login(name: &str, password: &str, backend_url: &str) -> Result<LoginOutcome, String> {
    let client = BackendClient::new(backend_url.to_string());
    let resp = client.login(name, password).await?;
    Ok(finish_login(resp, backend_url))
}

// Open self-service manager/superadmin signup — no invite link required, by
// explicit request. `role` must be "manager" or "superadmin"; the server
// rejects anything else (including "employee" — that role only comes from
// an invite-link enrollment or a manager-issued claim link).
pub async fn register_admin(name: &str, password: &str, role: &str, backend_url: &str) -> Result<LoginOutcome, String> {
    let client = BackendClient::new(backend_url.to_string());
    let resp = client.register_admin(name, password, role).await?;
    Ok(finish_login(resp, backend_url))
}

#[derive(Clone)]
struct Segment {
    app_name: String,
    window_title: String,
    domain: Option<String>,
    started_at: String,
    ended_at: String,
    input_count: u32,
    is_idle: bool,
}

/// Runs the tracking loops for an already-enrolled config. Called either at
/// startup (existing config loaded from disk) or right after the first-run
/// setup window successfully enrolls.
pub async fn start_tracking<F: Fn(String) + Send + Sync + 'static>(
    cfg: AgentConfig,
    backend_url: String,
    agent_name: String,
    status_cb: F,
) {
    let enrolled_label = match &cfg.manager_name {
        Some(name) => format!("Tracking — {name}'s team"),
        None => "Tracking — no manager assigned".to_string(),
    };
    status_cb(enrolled_label);

    let domain_state: SharedDomain = Arc::new(Mutex::new(None));
    let enrolled_name = Arc::new(Mutex::new(Some(agent_name)));

    // Local listener for the browser extension runs on its own OS thread —
    // tiny_http's blocking loop doesn't play well inside the async runtime.
    {
        let domain_state = domain_state.clone();
        let enrolled_name = enrolled_name.clone();
        std::thread::spawn(move || {
            local_server::run(LOCAL_PORT, domain_state, enrolled_name);
        });
    }

    let current_segment: Arc<Mutex<Option<Segment>>> = Arc::new(Mutex::new(None));
    let queue: Arc<Mutex<Vec<ActivityEvent>>> = Arc::new(Mutex::new(load_queue()));

    let poll_segment = current_segment.clone();
    let poll_queue = queue.clone();
    let poll_domain_state = domain_state.clone();
    tokio::spawn(async move {
        loop {
            poll_once(&poll_segment, &poll_queue, &poll_domain_state);
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
        }
    });

    let flush_segment = current_segment.clone();
    let flush_queue = queue.clone();
    let flush_cfg = cfg.clone();
    let flush_client = BackendClient::new(backend_url.clone());
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(FLUSH_INTERVAL_SECS)).await;
            close_segment(&flush_segment, &flush_queue);
            let events: Vec<ActivityEvent> = { flush_queue.lock().unwrap().clone() };
            if events.is_empty() {
                continue;
            }
            match flush_client.ingest_activity(&flush_cfg.agent_key, &events).await {
                Ok(_) => {
                    flush_queue.lock().unwrap().clear();
                    save_queue(&[]);
                }
                Err(e) => eprintln!("flush failed, will retry next cycle: {e}"),
            }
        }
    });

    let shot_cfg = cfg.clone();
    tokio::spawn(async move {
        let shot_client = BackendClient::new(backend_url);
        let mut interval_minutes = DEFAULT_SCREENSHOT_INTERVAL_MIN;
        loop {
            // Re-check the manager's configured interval every cycle — a change (or
            // turning screenshots off entirely) takes effect without an agent restart.
            if let Ok(settings) = shot_client.agent_settings(&shot_cfg.agent_key).await {
                interval_minutes = settings.screenshot_interval_minutes;
            }

            if interval_minutes == 0 {
                tokio::time::sleep(Duration::from_secs(SETTINGS_RECHECK_SECS)).await;
                continue;
            }

            tokio::time::sleep(Duration::from_secs(interval_minutes as u64 * 60)).await;
            let ctx = get_context();
            match capture_primary_as_base64_jpeg() {
                Ok(b64) => {
                    if let Err(e) = shot_client
                        .ingest_screenshot(&shot_cfg.agent_key, &ctx.process, &ctx.title, &b64)
                        .await
                    {
                        eprintln!("screenshot upload failed: {e}");
                    }
                }
                Err(e) => eprintln!("screenshot capture failed: {e}"),
            }
        }
    });

    // Keep this task alive; the spawned loops above run for the process lifetime.
    std::future::pending::<()>().await;
}

fn poll_once(current_segment: &Arc<Mutex<Option<Segment>>>, queue: &Arc<Mutex<Vec<ActivityEvent>>>, domain_state: &SharedDomain) {
    let ctx = get_context();
    let now = Utc::now().to_rfc3339();
    let is_idle = ctx.idle_seconds >= IDLE_THRESHOLD_SECS;
    let is_browser = BROWSER_APPS.contains(&ctx.process.as_str());
    let domain = if is_browser { local_server::current_domain(domain_state) } else { None };

    let mut seg_guard = current_segment.lock().unwrap();
    let needs_new_segment = match seg_guard.as_ref() {
        None => true,
        Some(seg) => {
            seg.app_name != ctx.process || seg.window_title != ctx.title || seg.is_idle != is_idle || seg.domain != domain
        }
    };

    if needs_new_segment {
        if let Some(old) = seg_guard.take() {
            push_segment(queue, old);
        }
        *seg_guard = Some(Segment {
            app_name: if ctx.process.is_empty() { "(unknown)".to_string() } else { ctx.process },
            window_title: ctx.title,
            domain,
            started_at: now.clone(),
            ended_at: now,
            input_count: if is_idle { 0 } else { 1 },
            is_idle,
        });
    } else if let Some(seg) = seg_guard.as_mut() {
        seg.ended_at = now;
        if !is_idle {
            seg.input_count += 1;
        }
    }
}

fn close_segment(current_segment: &Arc<Mutex<Option<Segment>>>, queue: &Arc<Mutex<Vec<ActivityEvent>>>) {
    let mut seg_guard = current_segment.lock().unwrap();
    if let Some(seg) = seg_guard.take() {
        push_segment(queue, seg);
    }
}

fn push_segment(queue: &Arc<Mutex<Vec<ActivityEvent>>>, seg: Segment) {
    let client_event_id = format!("{}_{:x}", seg.started_at, rand_suffix());
    let event = ActivityEvent {
        client_event_id,
        app_name: seg.app_name,
        window_title: seg.window_title,
        domain: seg.domain,
        started_at: seg.started_at,
        ended_at: seg.ended_at,
        input_count: seg.input_count,
        is_idle: seg.is_idle,
    };
    let mut q = queue.lock().unwrap();
    q.push(event);
    save_queue(&q);
}

fn rand_suffix() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos();
    nanos ^ 0x9E3779B9
}
