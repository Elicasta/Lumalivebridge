use crate::arrangement::{build_arrangement, jump_target, locate_position, Arrangement};
use crate::bridge;
use crate::command;
use crate::models::{RuntimeInfo, Setlist, SetlistInput, Song, SongInput};
use crate::pairing::PairingFailure;
use crate::state::AppState;
use axum::{
    extract::{Path, State as AxumState},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use if_addrs::get_if_addrs;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

const REMOTE_INDEX: &str = include_str!("../../remote/index.html");
const REMOTE_APP: &str = include_str!("../../remote/app.js");
const REMOTE_CSS: &str = include_str!("../../remote/styles.css");
const REMOTE_MANIFEST: &str = include_str!("../../remote/manifest.webmanifest");
const REMOTE_SW: &str = include_str!("../../remote/sw.js");

type ApiError = (StatusCode, Json<Value>);

fn api_error(status: StatusCode, message: impl ToString) -> ApiError {
    (status, Json(json!({ "ok": false, "error": message.to_string() })))
}

fn authorize(headers: &HeaderMap, state: &AppState) -> Result<(), ApiError> {
    let supplied = headers
        .get("x-luma-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    if supplied == state.remote_token.as_str() {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::UNAUTHORIZED,
            "Invalid or missing Luma Live remote token",
        ))
    }
}

fn text_asset(body: &'static str, content_type: &'static str) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        body,
    )
        .into_response()
}

async fn index() -> Html<&'static str> {
    Html(REMOTE_INDEX)
}

async fn app_js() -> Response {
    text_asset(REMOTE_APP, "application/javascript; charset=utf-8")
}

async fn styles_css() -> Response {
    text_asset(REMOTE_CSS, "text/css; charset=utf-8")
}

async fn manifest() -> Response {
    text_asset(REMOTE_MANIFEST, "application/manifest+json")
}

async fn service_worker() -> Response {
    text_asset(REMOTE_SW, "application/javascript; charset=utf-8")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    ok: bool,
    product: &'static str,
    version: &'static str,
    offline_ready: bool,
    bridge_port: u16,
}

async fn health() -> Json<Health> {
    Json(Health {
        ok: true,
        product: "luma-live",
        version: env!("CARGO_PKG_VERSION"),
        offline_ready: true,
        bridge_port: 17878,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    code: String,
    device_name: Option<String>,
}

async fn pair(
    AxumState(state): AxumState<AppState>,
    Json(input): Json<PairRequest>,
) -> Result<Json<Value>, ApiError> {
    match state.pairing.verify(&input.code) {
        Ok(()) => {
            let _device_name = input.device_name.as_deref().unwrap_or("iPad");
            Ok(Json(json!({
                "ok": true,
                "token": state.remote_token.as_str(),
                "paired": true
            })))
        }
        Err(PairingFailure::Invalid) => Err(api_error(
            StatusCode::UNAUTHORIZED,
            "That six-digit pairing code is not valid",
        )),
        Err(PairingFailure::Locked(seconds)) => Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "ok": false,
                "error": "Too many incorrect codes. Try again shortly.",
                "retryAfterSeconds": seconds
            })),
        )),
        Err(PairingFailure::Internal(message)) => Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            message,
        )),
    }
}

fn active_arrangement(state: &AppState) -> Result<Option<Arrangement>, String> {
    let Some(active_id) = state.db.get_active_setlist_id()? else {
        return Ok(None);
    };
    let Some(setlist) = state.db.get_setlist(&active_id)? else {
        return Ok(None);
    };
    let songs = state.db.list_songs()?;
    build_arrangement(&setlist, &songs).map(Some)
}

fn library_value(state: &AppState, bridge_connected: bool) -> Result<Value, String> {
    let library = state.db.library()?;
    let active_setlist_id = state.db.get_active_setlist_id()?;
    let arrangement = active_arrangement(state)?;
    Ok(json!({
        "ok": true,
        "songs": library.songs,
        "setlists": library.setlists,
        "activeSetlistId": active_setlist_id,
        "arrangement": arrangement,
        "bridgeConnected": bridge_connected
    }))
}

fn local_offline_live_state(state: &AppState) -> Result<Value, String> {
    Ok(json!({
        "bridgeConnected": false,
        "activeSetlistId": state.db.get_active_setlist_id()?,
        "liveContext": Value::Null
    }))
}

async fn enriched_live_state(state: &AppState) -> Result<Value, String> {
    let raw = bridge::state().await;
    let bridge_connected = raw.is_ok();
    let mut live = match raw {
        Ok(value) if value.is_object() => value,
        Ok(_) => json!({}),
        Err(_) => json!({}),
    };

    let arrangement = active_arrangement(state)?;
    let current_song_time = live
        .get("currentSongTime")
        .and_then(Value::as_f64);
    let live_context = match (&arrangement, current_song_time) {
        (Some(arrangement), Some(beat)) => locate_position(arrangement, beat),
        _ => None,
    };

    if let Some(object) = live.as_object_mut() {
        object.insert("bridgeConnected".into(), json!(bridge_connected));
        object.insert(
            "activeSetlistId".into(),
            json!(state.db.get_active_setlist_id()?),
        );
        object.insert(
            "liveContext".into(),
            serde_json::to_value(live_context).map_err(|e| e.to_string())?,
        );
    }

    Ok(live)
}

async fn runtime(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
) -> Result<Json<RuntimeInfo>, ApiError> {
    authorize(&headers, &state)?;
    let info = state
        .runtime
        .read()
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "Runtime state lock failed"))?
        .clone();
    Ok(Json(info))
}

async fn library(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    let connected = bridge::health().await;
    library_value(&state, connected)
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn live_state(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    enriched_live_state(&state)
        .await
        .map(|state| Json(json!({ "ok": true, "state": state })))
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn save_song(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(input): Json<SongInput>,
) -> Result<Json<Song>, ApiError> {
    authorize(&headers, &state)?;
    state
        .db
        .save_song(input)
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn delete_song(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    state
        .db
        .delete_song(&id)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "ok": true })))
}

async fn save_setlist(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(input): Json<SetlistInput>,
) -> Result<Json<Setlist>, ApiError> {
    authorize(&headers, &state)?;
    state
        .db
        .save_setlist(input)
        .map(Json)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))
}

async fn delete_setlist(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    state
        .db
        .delete_setlist(&id)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectRequest {
    command: Value,
}

async fn direct(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(input): Json<DirectRequest>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    bridge::command(input.command)
        .await
        .map_err(|e| api_error(StatusCode::BAD_GATEWAY, e))?;
    let live = enriched_live_state(&state)
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "ok": true, "state": live })))
}

async fn sync_setlist(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;

    let setlist = state
        .db
        .get_setlist(&id)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Setlist not found"))?;
    let songs = state
        .db
        .list_songs()
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    let arrangement = build_arrangement(&setlist, &songs)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;

    let points: Vec<Value> = arrangement
        .markers
        .iter()
        .map(|point| json!({ "time": point.time, "name": point.name }))
        .collect();

    state
        .db
        .set_active_setlist_id(Some(&setlist.id))
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;

    let timeline = json!({
        "songs": arrangement.songs.iter().map(|song| json!({
            "instanceId": song.instance_id,
            "startBeat": song.start_beat,
            "endBeat": song.end_beat,
            "bpm": song.bpm,
            "numerator": song.meter.numerator,
            "denominator": song.meter.denominator
        })).collect::<Vec<_>>(),
        "transitions": arrangement.transitions
    });
    let sync_result = async {
        bridge::send(
            "sync_cue_points",
            json!({ "replace": true, "points": points }),
        )
        .await?;
        bridge::send("configure_service_timeline", timeline).await?;
        Ok::<(), String>(())
    }
    .await;
    let bridge_connected = sync_result.is_ok();
    let sync_error = sync_result.err();

    let live = if bridge_connected {
        enriched_live_state(&state)
            .await
            .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?
    } else {
        local_offline_live_state(&state)
            .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?
    };
    let library = library_value(&state, bridge_connected)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;

    Ok(Json(json!({
        "ok": true,
        "arrangement": arrangement,
        "state": live,
        "library": library,
        "bridgeConnected": bridge_connected,
        "syncError": sync_error
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JumpRequest {
    song_id: Option<String>,
    instance_id: Option<String>,
    section_id: Option<String>,
}

async fn jump(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(input): Json<JumpRequest>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    let arrangement = active_arrangement(&state)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "No active setlist"))?;

    let (time, song) = jump_target(
        &arrangement,
        input.song_id.as_deref(),
        input.instance_id.as_deref(),
        input.section_id.as_deref(),
    )
    .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;

    bridge::send("set_tempo", json!({ "bpm": song.bpm }))
        .await
        .map_err(|e| api_error(StatusCode::BAD_GATEWAY, e))?;
    bridge::send(
        "set_meter",
        json!({
            "numerator": song.meter.numerator,
            "denominator": song.meter.denominator
        }),
    )
    .await
    .map_err(|e| api_error(StatusCode::BAD_GATEWAY, e))?;
    bridge::jump_to_time(time)
        .await
        .map_err(|e| api_error(StatusCode::BAD_GATEWAY, e))?;

    let live = enriched_live_state(&state)
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "ok": true, "state": live })))
}

#[derive(Debug, Deserialize)]
struct PlainCommand {
    text: String,
}

async fn preview_plain_command(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(input): Json<PlainCommand>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    let preview = command::preview(&state, &input.text)
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "ok": true, "preview": preview })))
}

async fn plain_command(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(input): Json<PlainCommand>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    let result = command::execute(&state, &input.text)
        .await
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    let known_offline = result.get("bridgeConnected").and_then(Value::as_bool) == Some(false);
    let live = if known_offline {
        local_offline_live_state(&state)
            .unwrap_or_else(|_| json!({ "bridgeConnected": false }))
    } else {
        enriched_live_state(&state)
            .await
            .unwrap_or_else(|_| json!({ "bridgeConnected": false }))
    };
    let library = library_value(&state, if known_offline { false } else { bridge::health().await })
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({
        "ok": true,
        "result": result,
        "state": live,
        "library": library
    })))
}

fn lan_urls(port: u16, token: &str) -> Vec<String> {
    let mut urls = Vec::new();
    if let Ok(interfaces) = get_if_addrs() {
        for interface in interfaces {
            if interface.is_loopback() {
                continue;
            }
            if let IpAddr::V4(ip) = interface.ip() {
                if !ip.is_link_local() {
                    urls.push(format!("http://{}:{}/?token={}", ip, port, token));
                }
            }
        }
    }
    urls.sort();
    urls.dedup();
    urls
}

pub async fn run_server(state: AppState) -> anyhow::Result<()> {
    let mut bound = None;
    for port in 7878u16..=7897u16 {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
        if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
            bound = Some((port, listener));
            break;
        }
    }

    let (port, listener) = bound
        .ok_or_else(|| anyhow::anyhow!("No free Luma Live LAN port between 7878 and 7897"))?;

    {
        let mut runtime = state
            .runtime
            .write()
            .map_err(|_| anyhow::anyhow!("Runtime state lock failed"))?;
        runtime.server_running = true;
        runtime.port = Some(port);
        runtime.local_urls = lan_urls(port, &state.remote_token);
    }

    let app = Router::new()
        .route("/", get(index))
        .route("/app.js", get(app_js))
        .route("/styles.css", get(styles_css))
        .route("/manifest.webmanifest", get(manifest))
        .route("/sw.js", get(service_worker))
        .route("/health", get(health))
        .route("/api/pair", post(pair))
        .route("/api/runtime", get(runtime))
        .route("/api/library", get(library))
        .route("/api/state", get(live_state))
        .route("/api/direct", post(direct))
        .route("/api/command/preview", post(preview_plain_command))
        .route("/api/command", post(plain_command))
        .route("/api/jump", post(jump))
        .route("/api/songs", post(save_song))
        .route("/api/songs/:id", delete(delete_song))
        .route("/api/setlists", post(save_setlist))
        .route("/api/setlists/:id", delete(delete_setlist))
        .route("/api/setlists/:id/sync", post(sync_setlist))
        .with_state(state);

    axum::serve(listener, app).await?;
    Ok(())
}
