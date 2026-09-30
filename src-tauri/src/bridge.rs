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

    let response = send("jump_to_time", json!({ "time": target })).await?;

    // Read-back happens inside the Max LiveAPI call before the command returns.
    // This is the strongest acknowledgement we can get from Live and avoids a
    // false failure while transport is running past the requested beat.
    let observed = response
        .get("result")
        .and_then(|value| value.get("observedTime"))
        .and_then(Value::as_f64);
    if observed
        .map(|value| (value - target).abs() <= 0.25)
        .unwrap_or(false)
    {
        return state().await;
    }

    let was_playing = response
        .get("result")
        .and_then(|value| value.get("isPlaying"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut last_position: Option<f64> = observed;
    // When transport is rolling, the playhead immediately advances after the
    // jump. Accept a small forward window on the first fresh state rather than
    // requiring it to remain within 0.05 beat of the target.
    for attempt in 0..20 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let current = state().await?;
        last_position = current.get("currentSongTime").and_then(Value::as_f64);
        let tolerance = if was_playing && attempt < 4 { 1.0 } else { 0.08 };
        let reached = last_position
            .map(|value| value >= target - 0.08 && value <= target + tolerance)
            .unwrap_or(false);
        if reached {
            return Ok(current);
        }
    }

    let health = health_info().await.ok();
    let version = health
        .as_ref()
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let reported = last_position
        .map(|value| format!("{value:.3}"))
        .unwrap_or_else(|| "no position".into());

    Err(format!(
        "Ableton did not reach beat {target:.3}. Adapter v{version} reported {reported} after verification. If the playhead did not move, reload the current Luma Live5 Max adapter; if it moved but this still appears, run Settings → Run Full Check."
    ))
}
