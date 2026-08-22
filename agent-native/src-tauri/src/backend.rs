use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(rename = "userId")]
    pub user_id: i64,
    #[serde(rename = "agentKey")]
    pub agent_key: String,
    // Not part of any server response (enroll/login return it as a top-level
    // field, not nested here) — filled in client-side so a silent cold-start
    // resume has a name to report to the browser extension's /status
    // endpoint. #[serde(default)] keeps configs saved before this existed loadable.
    #[serde(default)]
    pub name: String,
    #[serde(rename = "managerId")]
    pub manager_id: Option<i64>,
    #[serde(rename = "managerName")]
    pub manager_name: Option<String>,
    // Not part of the server's enroll response (the server doesn't know its own
    // externally-reachable address) — filled in client-side from whatever URL
    // was actually used to enroll, so restarts keep talking to the right
    // machine instead of falling back to a localhost default. #[serde(default)]
    // keeps old config files (saved before this field existed) loadable.
    #[serde(rename = "backendUrl", default)]
    pub backend_url: String,
}

#[derive(Serialize)]
struct EnrollRequest {
    name: String,
    password: String,
    #[serde(rename = "inviteToken", skip_serializing_if = "Option::is_none")]
    invite_token: Option<String>,
}

#[derive(Serialize)]
struct LoginRequest<'a> {
    name: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
struct RegisterAdminRequest<'a> {
    name: &'a str,
    password: &'a str,
    role: &'a str,
}

#[derive(Deserialize)]
pub struct LoginUser {
    pub id: i64,
    pub name: String,
    pub role: String,
    #[serde(rename = "managerId")]
    pub manager_id: Option<i64>,
    #[serde(rename = "managerName")]
    pub manager_name: Option<String>,
    #[serde(rename = "agentKey")]
    pub agent_key: String,
}

#[derive(Deserialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: LoginUser,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ActivityEvent {
    #[serde(rename = "clientEventId")]
    pub client_event_id: String,
    #[serde(rename = "appName")]
    pub app_name: String,
    #[serde(rename = "windowTitle")]
    pub window_title: String,
    pub domain: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "endedAt")]
    pub ended_at: String,
    #[serde(rename = "inputCount")]
    pub input_count: u32,
    #[serde(rename = "isIdle")]
    pub is_idle: bool,
}

pub struct BackendClient {
    http: reqwest::Client,
    base_url: String,
}

impl BackendClient {
    pub fn new(base_url: String) -> Self {
        Self { http: reqwest::Client::new(), base_url }
    }

    pub async fn enroll(&self, name: &str, password: &str, invite_token: Option<String>) -> Result<AgentConfig, String> {
        let res = self
            .http
            .post(format!("{}/api/enroll", self.base_url))
            .json(&EnrollRequest { name: name.to_string(), password: password.to_string(), invite_token })
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("enroll failed: {}", res.status()));
        }
        res.json::<AgentConfig>().await.map_err(|e| e.to_string())
    }

    // Name+password login — same account used for dashboard access. Returns
    // the same identity info /api/enroll would (plus a session token), so an
    // already-set-up employee can skip the invite-link step entirely.
    pub async fn login(&self, name: &str, password: &str) -> Result<LoginResponse, String> {
        let res = self
            .http
            .post(format!("{}/api/auth/login", self.base_url))
            .json(&LoginRequest { name, password })
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Self::parse_login_response(res, "login failed").await
    }

    // Open self-service manager/superadmin signup — no invite link required.
    pub async fn register_admin(&self, name: &str, password: &str, role: &str) -> Result<LoginResponse, String> {
        let res = self
            .http
            .post(format!("{}/api/auth/register-admin", self.base_url))
            .json(&RegisterAdminRequest { name, password, role })
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Self::parse_login_response(res, "account creation failed").await
    }

    async fn parse_login_response(res: reqwest::Response, fallback_error: &str) -> Result<LoginResponse, String> {
        if !res.status().is_success() {
            #[derive(Deserialize)]
            struct ErrBody { error: Option<String> }
            let body: Option<ErrBody> = res.json().await.ok();
            return Err(body.and_then(|b| b.error).unwrap_or_else(|| fallback_error.to_string()));
        }
        res.json::<LoginResponse>().await.map_err(|e| e.to_string())
    }

    pub async fn ingest_activity(&self, agent_key: &str, events: &[ActivityEvent]) -> Result<(), String> {
        #[derive(Serialize)]
        struct Body<'a> {
            events: &'a [ActivityEvent],
        }
        let res = self
            .http
            .post(format!("{}/api/ingest/activity", self.base_url))
            .header("x-agent-key", agent_key)
            .json(&Body { events })
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("ingest failed: {}", res.status()));
        }
        Ok(())
    }

    pub async fn ingest_screenshot(
        &self,
        agent_key: &str,
        app_name: &str,
        window_title: &str,
        image_base64: &str,
    ) -> Result<(), String> {
        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(rename = "capturedAt")]
            captured_at: String,
            #[serde(rename = "appName")]
            app_name: &'a str,
            #[serde(rename = "windowTitle")]
            window_title: &'a str,
            #[serde(rename = "imageBase64")]
            image_base64: &'a str,
            ext: &'a str,
        }
        let res = self
            .http
            .post(format!("{}/api/ingest/screenshot", self.base_url))
            .header("x-agent-key", agent_key)
            .json(&Body {
                captured_at: chrono::Utc::now().to_rfc3339(),
                app_name,
                window_title,
                image_base64,
                ext: "jpg",
            })
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("screenshot upload failed: {}", res.status()));
        }
        Ok(())
    }

    // Checked periodically so a manager's interval change (or turning screenshots
    // off entirely) takes effect without the employee restarting the agent.
    pub async fn agent_settings(&self, agent_key: &str) -> Result<AgentSettings, String> {
        let res = self
            .http
            .get(format!("{}/api/agent-settings", self.base_url))
            .header("x-agent-key", agent_key)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("settings fetch failed: {}", res.status()));
        }
        res.json::<AgentSettings>().await.map_err(|e| e.to_string())
    }
}

#[derive(Debug, Deserialize)]
pub struct AgentSettings {
    #[serde(rename = "screenshotIntervalMinutes")]
    pub screenshot_interval_minutes: u32,
}
