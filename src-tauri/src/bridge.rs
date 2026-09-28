use reqwest::Client;
use serde_json::{json, Value};

#[derive(Clone)]
pub struct AbletonBridge {
    client: Client,
    base_url: String,
}

impl AbletonBridge {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            base_url: "http://127.0.0.1:17878".to_string(),
        }
    }

    pub async fn health(&self) -> bool {
        self.client
            .get(format!("{}/health", self.base_url))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
    }

    pub async fn state(&self) -> Result<Value, String> {
        let response = self
            .client
            .get(format!("{}/api/state", self.base_url))
            .send()
            .await
            .map_err(|_| "Ableton bridge is not connected".to_string())?;
        if !response.status().is_success() {
            return Err("Ableton bridge rejected the state request".into());
        }
        let payload: Value = response.json().await.map_err(|e| e.to_string())?;
        Ok(payload.get("state").cloned().unwrap_or(Value::Null))
    }

    pub async fn direct(&self, command: Value) -> Result<Value, String> {
        let response = self
            .client
            .post(format!("{}/api/direct", self.base_url))
            .json(&json!({ "command": command }))
            .send()
            .await
            .map_err(|_| "Ableton bridge is not connected".to_string())?;
        let status = response.status();
        let payload: Value = response.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Ableton command failed")
                .to_string());
        }
        Ok(payload)
    }
}
