use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(rename = "userId")]
    pub user_id: i64,
    #[serde(rename = "agentKey")]
    pub agent_key: String,
    #[serde(rename = "managerId")]
    pub manager_id: Option<i64>,
    #[serde(rename = "managerName")]
    pub manager_name: Option<String>,
}

#[derive(Serialize)]
struct EnrollRequest {
    name: String,
    #[serde(rename = "inviteToken", skip_serializing_if = "Option::is_none")]
    invite_token: Option<String>,
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

    pub async fn enroll(&self, name: &str, invite_token: Option<String>) -> Result<AgentConfig, String> {
        let res = self
            .http
            .post(format!("{}/api/enroll", self.base_url))
            .json(&EnrollRequest { name: name.to_string(), invite_token })
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("enroll failed: {}", res.status()));
        }
        res.json::<AgentConfig>().await.map_err(|e| e.to_string())
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
