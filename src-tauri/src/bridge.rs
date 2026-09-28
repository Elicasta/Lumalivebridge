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

pub async fn health_info() -> Result<Value, String> {
    let response = client()?
        .get(format!("{BRIDGE_BASE}/health"))
        .send()
        .await
        .map_err(|e| format!("Ableton bridge unavailable: {e}"))?;
    let status = response.status();
    let payload: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Ableton bridge health check failed")
            .to_string());
    }
    Ok(payload)
}

pub async fn health() -> bool {
    health_info().await.is_ok()
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


pub async fn jump_to_time(target: f64) -> Result<Value, String> {
    if !target.is_finite() || target < 0.0 {
        return Err("Invalid Ableton song position".into());
    }

    send("jump_to_time", json!({ "time": target })).await?;

    for _ in 0..8 {
        tokio::time::sleep(Duration::from_millis(35)).await;
        let current = state().await?;
        let reached = current
            .get("currentSongTime")
            .and_then(Value::as_f64)
            .map(|value| (value - target).abs() <= 0.03)
            .unwrap_or(false);
        if reached {
            return Ok(current);
        }
    }

    Err(format!("Ableton did not reach the requested section position ({target:.3})"))
}
