use crate::models::{LibraryPayload, RuntimeInfo, Setlist, SetlistInput, Song, SongInput};
use crate::state::AppState;
use axum::{
    extract::{Path, State as AxumState},
    http::{header, HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use if_addrs::get_if_addrs;
use serde::Serialize;
use serde_json::json;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

const REMOTE_INDEX: &str = include_str!("../../remote/index.html");
const REMOTE_APP: &str = include_str!("../../remote/app.js");
const REMOTE_CSS: &str = include_str!("../../remote/styles.css");
const REMOTE_MANIFEST: &str = include_str!("../../remote/manifest.webmanifest");
const REMOTE_SW: &str = include_str!("../../remote/sw.js");

type ApiError = (StatusCode, Json<serde_json::Value>);

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
) -> Result<Json<LibraryPayload>, ApiError> {
    authorize(&headers, &state)?;
    state
        .db
        .library()
        .map(Json)
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
) -> Result<Json<serde_json::Value>, ApiError> {
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
) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&headers, &state)?;
    state
        .db
        .delete_setlist(&id)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({ "ok": true })))
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
        .with_state(state);

    axum::serve(listener, app).await?;
    Ok(())
}
