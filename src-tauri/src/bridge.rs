use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

const BRIDGE_BASE: &str = "http://127.0.0.1:17878";

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_millis(2600))
        .build()
        .map_err(|e| e.to_string())
}

pub async fn health() -> bool {
    let Ok(client) = client() else {
        return false;
    };
    client
        .get(format!("{BRIDGE_BASE}/health"))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

pub async fn state() -> Result<Value, String> {
    let response = client()?
        .get(format!("{BRIDGE_BASE}/api/state"))
        .send()
        .await
        .map_err(|e| format!("Ableton bridge unavailable: {e}"))?;

    let status = response.status();
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Ableton bridge request failed")
            .to_string());
    }

    Ok(payload.get("state").cloned().unwrap_or(payload))
}

pub async fn command(command: Value) -> Result<Value, String> {
    let response = client()?
        .post(format!("{BRIDGE_BASE}/api/direct"))
        .json(&json!({ "command": command }))
        .send()
        .await
        .map_err(|e| format!("Ableton bridge unavailable: {e}"))?;

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

pub async fn send(command_type: &str, args: Value) -> Result<Value, String> {
    command(json!({ "type": command_type, "args": args })).await
}
