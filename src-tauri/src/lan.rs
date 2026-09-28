use crate::arrangement::{build_arrangement, jump_target, locate_position, Arrangement, LiveContext};
use crate::models::{
    LibraryPayload, SectionInput, Setlist, SetlistInput, SetlistItemInput, Song, SongInput,
};
use crate::plain::{plan as plan_plain_text, PlainPlan};
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
}

async fn health() -> Json<Health> {
    Json(Health {
        ok: true,
        product: "luma-live",
        version: env!("CARGO_PKG_VERSION"),
        offline_ready: true,
    })
}

fn library_or_error(state: &AppState) -> Result<LibraryPayload, ApiError> {
    state
        .db
        .library()
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

fn arrangement_from_library(library: &LibraryPayload) -> Result<Option<Arrangement>, String> {
    let Some(active_id) = library.active_setlist_id.as_deref() else {
        return Ok(None);
    };
    let Some(setlist) = library.setlists.iter().find(|setlist| setlist.id == active_id) else {
        return Ok(None);
    };
    build_arrangement(setlist, &library.songs).map(Some)
}

async fn current_context(state: &AppState, arrangement: Option<&Arrangement>) -> Option<LiveContext> {
    let arrangement = arrangement?;
    let live = state.bridge.state().await.ok()?;
    let beat = live.get("currentSongTime").and_then(Value::as_f64)?;
    locate_position(arrangement, beat)
}

pub(crate) async fn live_payload(state: &AppState) -> Result<Value, String> {
    let library = state.db.library()?;
    let arrangement = arrangement_from_library(&library)?;
    let bridge_state = state.bridge.state().await;
    let bridge_connected = bridge_state.is_ok();
    let live = bridge_state.unwrap_or(Value::Null);
    let context = live
        .get("currentSongTime")
        .and_then(Value::as_f64)
        .and_then(|beat| arrangement.as_ref().and_then(|arrangement| locate_position(arrangement, beat)));

    Ok(json!({
        "ok": true,
        "bridgeConnected": bridge_connected,
        "state": live,
        "liveContext": context,
        "arrangement": arrangement,
        "activeSetlistId": library.active_setlist_id
    }))
}

async fn runtime(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
) -> Result<Json<crate::models::RuntimeInfo>, ApiError> {
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
) -> Result<Json<LibraryPayload>, ApiError> {
    authorize(&headers, &state)?;
    library_or_error(&state).map(Json)
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
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
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
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
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
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
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
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
    Ok(Json(json!({ "ok": true })))
}

pub(crate) async fn load_setlist_impl(state: &AppState, id: &str) -> Result<Value, String> {
    let library = state.db.library()?;
    let setlist = library
        .setlists
        .iter()
        .find(|setlist| setlist.id == id)
        .ok_or_else(|| "Setlist not found".to_string())?
        .clone();
    let arrangement = build_arrangement(&setlist, &library.songs)?;

    state.db.set_active_setlist_id(Some(&setlist.id))?;

    let points: Vec<Value> = arrangement
        .markers
        .iter()
        .map(|marker| json!({"time": marker.time, "name": marker.name}))
        .collect();

    let sync_result = state
        .bridge
        .direct(json!({
            "type": "sync_cue_points",
            "args": { "replace": true, "points": points }
        }))
        .await;

    Ok(json!({
        "ok": true,
        "activeSetlistId": setlist.id,
        "arrangement": arrangement,
        "bridgeConnected": sync_result.is_ok(),
        "sync": sync_result.as_ref().ok(),
        "syncError": sync_result.err()
    }))
}

async fn load_setlist(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    load_setlist_impl(&state, &id)
        .await
        .map(Json)
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

async fn live(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    live_payload(&state)
        .await
        .map(Json)
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
}

#[derive(Deserialize)]
struct DirectBody {
    command: Value,
}

pub(crate) fn allowed_remote_command(command: &Value) -> bool {
    let Some(kind) = command.get("type").and_then(Value::as_str) else {
        return false;
    };
    matches!(
        kind,
        "start_playback"
            | "stop_playback"
            | "set_metronome"
            | "stop_all_clips"
            | "fire_scene"
            | "set_track_volume"
            | "set_track_mute"
            | "set_track_solo"
            | "set_tempo"
            | "set_meter"
    )
}

pub(crate) async fn direct_impl(state: &AppState, command: Value) -> Result<Value, String> {
    if !allowed_remote_command(&command) {
        return Err("Command is not allowed from the live controls".into());
    }
    state.bridge.direct(command).await?;
    live_payload(state).await
}

async fn live_direct(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<DirectBody>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    direct_impl(&state, body.command)
        .await
        .map(Json)
        .map_err(|error| api_error(StatusCode::SERVICE_UNAVAILABLE, error))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JumpBody {
    song_id: Option<String>,
    instance_id: Option<String>,
    section_id: Option<String>,
}

async fn jump_impl(state: &AppState, body: &JumpBody) -> Result<Value, String> {
    let library = state.db.library()?;
    let arrangement = arrangement_from_library(&library)?
        .ok_or_else(|| "No active setlist".to_string())?;

    let (time, song, _) = jump_target(
        &arrangement,
        body.song_id.as_deref(),
        body.instance_id.as_deref(),
        body.section_id.as_deref(),
    )?;
    let bpm = song.bpm;
    let meter = song.meter.clone();

    state
        .bridge
        .direct(json!({"type":"set_tempo","args":{"bpm":bpm}}))
        .await?;
    state
        .bridge
        .direct(json!({
            "type":"set_meter",
            "args":{"numerator":meter.numerator,"denominator":meter.denominator}
        }))
        .await?;
    state
        .bridge
        .direct(json!({"type":"jump_to_time","args":{"time":time}}))
        .await?;

    live_payload(state).await
}

pub(crate) async fn jump_by_ids(
    state: &AppState,
    song_id: Option<String>,
    instance_id: Option<String>,
    section_id: Option<String>,
) -> Result<Value, String> {
    jump_impl(state, &JumpBody { song_id, instance_id, section_id }).await
}

async fn live_jump(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<JumpBody>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    jump_impl(&state, &body)
        .await
        .map(Json)
        .map_err(|error| api_error(StatusCode::SERVICE_UNAVAILABLE, error))
}

#[derive(Deserialize)]
struct PlainTextBody {
    text: String,
}

pub(crate) async fn build_plain_plan(state: &AppState, text: &str) -> Result<PlainPlan, String> {
    let library = state.db.library()?;
    let arrangement = arrangement_from_library(&library)?;
    let context = current_context(state, arrangement.as_ref()).await;
    plan_plain_text(text, &library, context.as_ref())
}

async fn plain_plan(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<PlainTextBody>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    let plan = build_plain_plan(&state, &body.text)
        .await
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))?;
    Ok(Json(json!({ "ok": true, "plan": plan })))
}

fn song_input_from_song(song: &Song) -> SongInput {
    SongInput {
        id: Some(song.id.clone()),
        title: song.title.clone(),
        artist: Some(song.artist.clone()),
        bpm: song.bpm,
        key: Some(song.key.clone()),
        meter: song.meter.clone(),
        length_bars: song.length_bars,
        sections: song
            .sections
            .iter()
            .map(|section| SectionInput {
                id: Some(section.id.clone()),
                name: section.name.clone(),
                start_bar: section.start_bar,
            })
            .collect(),
    }
}

pub(crate) async fn apply_plain_plan(state: &AppState, plan: &PlainPlan) -> Result<Value, String> {
    let mut results = Vec::new();

    for step in &plan.steps {
        let result = match step.kind.as_str() {
            "ableton" => {
                let command = step
                    .data
                    .get("command")
                    .cloned()
                    .ok_or_else(|| "Plain-language Ableton step is missing a command".to_string())?;
                state.bridge.direct(command).await?
            }

            "load_setlist" => {
                let id = step
                    .data
                    .get("setlistId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Load-setlist step is missing setlistId".to_string())?;
                load_setlist_impl(state, id).await?
            }

            "jump_section" => {
                let song_id = step
                    .data
                    .get("songId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let instance_id = step
                    .data
                    .get("instanceId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let section_id = step
                    .data
                    .get("sectionId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let body = JumpBody {
                    song_id,
                    instance_id,
                    section_id,
                };
                jump_impl(state, &body).await?
            }

            "create_song" => {
                let input: SongInput =
                    serde_json::from_value(step.data.clone()).map_err(|error| error.to_string())?;
                let song = state.db.save_song(input)?;
                json!({"song":song})
            }

            "move_section" => {
                let song_id = step
                    .data
                    .get("songId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Move-section step is missing songId".to_string())?;
                let section_id = step
                    .data
                    .get("sectionId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Move-section step is missing sectionId".to_string())?;
                let start_bar = step
                    .data
                    .get("startBar")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| "Move-section step is missing startBar".to_string())?;

                let library = state.db.library()?;
                let song = library
                    .songs
                    .iter()
                    .find(|song| song.id == song_id)
                    .ok_or_else(|| "Song not found".to_string())?;
                let mut input = song_input_from_song(song);
                let section = input
                    .sections
                    .iter_mut()
                    .find(|section| section.id.as_deref() == Some(section_id))
                    .ok_or_else(|| "Section not found".to_string())?;
                section.start_bar = start_bar;
                let saved = state.db.save_song(input)?;
                json!({"song":saved})
            }

            "add_song_to_setlist" => {
                let song_id = step
                    .data
                    .get("songId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Setlist edit is missing songId".to_string())?;
                let setlist_id = step
                    .data
                    .get("setlistId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Setlist edit is missing setlistId".to_string())?;
                let after_song_id = step.data.get("afterSongId").and_then(Value::as_str);

                let library = state.db.library()?;
                if !library.songs.iter().any(|song| song.id == song_id) {
                    return Err("Song not found".into());
                }
                let setlist = library
                    .setlists
                    .iter()
                    .find(|setlist| setlist.id == setlist_id)
                    .ok_or_else(|| "Setlist not found".to_string())?;

                let mut items: Vec<SetlistItemInput> = setlist
                    .items
                    .iter()
                    .map(|item| SetlistItemInput {
                        id: Some(item.id.clone()),
                        song_id: item.song_id.clone(),
                    })
                    .collect();

                let new_item = SetlistItemInput {
                    id: None,
                    song_id: song_id.to_string(),
                };
                if let Some(after_id) = after_song_id {
                    if let Some(index) = items.iter().position(|item| item.song_id == after_id) {
                        items.insert(index + 1, new_item);
                    } else {
                        items.push(new_item);
                    }
                } else {
                    items.push(new_item);
                }

                let saved = state.db.save_setlist(SetlistInput {
                    id: Some(setlist.id.clone()),
                    title: setlist.title.clone(),
                    gap_bars: setlist.gap_bars,
                    items,
                })?;
                json!({"setlist":saved})
            }

            other => return Err(format!("Unsupported plain-language step: {other}")),
        };

        results.push(json!({
            "kind": step.kind,
            "summary": step.summary,
            "result": result
        }));
    }

    Ok(json!({
        "ok": true,
        "planId": plan.id,
        "results": results,
        "library": state.db.library()?,
        "live": live_payload(state).await?
    }))
}

#[derive(Deserialize)]
struct ApplyPlanBody {
    plan: PlainPlan,
}

async fn plain_apply(
    AxumState(state): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<ApplyPlanBody>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    apply_plain_plan(&state, &body.plan)
        .await
        .map(Json)
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error))
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

    for port in 7878u16..7898u16 {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                bound = Some((port, listener));
                break;
            }
            Err(_) => continue,
        }
    }

    let (port, listener) =
        bound.ok_or_else(|| anyhow::anyhow!("No free Luma Live LAN port between 7878 and 7897"))?;

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
        .route("/api/runtime", get(runtime))
        .route("/api/library", get(library))
        .route("/api/songs", post(save_song))
        .route("/api/songs/:id", delete(delete_song))
        .route("/api/setlists", post(save_setlist))
        .route("/api/setlists/:id", delete(delete_setlist))
        .route("/api/setlists/:id/load", post(load_setlist))
        .route("/api/live", get(live))
        .route("/api/live/direct", post(live_direct))
        .route("/api/live/jump", post(live_jump))
        .route("/api/plain/plan", post(plain_plan))
        .route("/api/plain/apply", post(plain_apply))
        .with_state(state);

    axum::serve(listener, app).await?;
    Ok(())
}
