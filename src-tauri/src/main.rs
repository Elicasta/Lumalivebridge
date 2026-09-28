mod arrangement;
mod bridge;
mod command;
mod db;
mod lan;
mod migration;
mod models;
mod state;

use crate::arrangement::{build_arrangement, jump_target, locate_position, Arrangement};
use crate::db::Database;
use crate::models::{LibraryPayload, RuntimeInfo, Setlist, SetlistInput, Song, SongInput};
use crate::state::AppState;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};
use tauri::{Manager, State};
use uuid::Uuid;

fn load_or_create_token(app_dir: &Path) -> String {
    let path = app_dir.join("remote-token");

    if let Ok(value) = fs::read_to_string(&path) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let token = Uuid::new_v4().simple().to_string();
    if fs::write(&path, format!("{}\n", token)).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = fs::metadata(&path) {
                let mut permissions = metadata.permissions();
                permissions.set_mode(0o600);
                let _ = fs::set_permissions(&path, permissions);
            }
        }
    }

    token
}

fn diagnostic_log_path() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return std::path::PathBuf::from(home)
            .join("Library")
            .join("Logs")
            .join("Luma Live")
            .join("startup.log");
    }
    std::env::temp_dir().join("luma-live-startup.log")
}

fn append_diagnostic(message: &str) {
    let path = diagnostic_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    use std::io::Write;
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", message);
    }
}

fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        append_diagnostic(&format!("panic: {info}"));
        default_hook(info);
    }));
}

#[tauri::command]
fn get_library(state: State<'_, AppState>) -> Result<LibraryPayload, String> {
    state.db.library()
}

#[tauri::command]
fn save_song(state: State<'_, AppState>, song: SongInput) -> Result<Song, String> {
    state.db.save_song(song)
}

#[tauri::command]
fn delete_song(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_song(&id)
}

#[tauri::command]
fn save_setlist(state: State<'_, AppState>, setlist: SetlistInput) -> Result<Setlist, String> {
    state.db.save_setlist(setlist)
}

#[tauri::command]
fn delete_setlist(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_setlist(&id)
}

#[tauri::command]
fn get_runtime_info(state: State<'_, AppState>) -> Result<RuntimeInfo, String> {
    state
        .runtime
        .read()
        .map(|runtime| runtime.clone())
        .map_err(|_| "Runtime state lock failed".to_string())
}

fn active_arrangement(state: &AppState) -> Result<Option<Arrangement>, String> {
    let Some(id) = state.db.get_active_setlist_id()? else {
        return Ok(None);
    };
    let Some(setlist) = state.db.get_setlist(&id)? else {
        return Ok(None);
    };
    let songs = state.db.list_songs()?;
    build_arrangement(&setlist, &songs).map(Some)
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
    let current_song_time = live.get("currentSongTime").and_then(Value::as_f64);
    let live_context = match (&arrangement, current_song_time) {
        (Some(arrangement), Some(beat)) => locate_position(arrangement, beat),
        _ => None,
    };

    if let Some(object) = live.as_object_mut() {
        object.insert("bridgeConnected".into(), json!(bridge_connected));
        object.insert("activeSetlistId".into(), json!(state.db.get_active_setlist_id()?));
        object.insert(
            "liveContext".into(),
            serde_json::to_value(live_context).map_err(|e| e.to_string())?,
        );
    }

    Ok(live)
}

#[tauri::command]
async fn get_live_state(state: State<'_, AppState>) -> Result<Value, String> {
    let state = state.inner().clone();
    enriched_live_state(&state).await
}

#[tauri::command]
async fn direct_live_command(state: State<'_, AppState>, command: Value) -> Result<Value, String> {
    let state = state.inner().clone();
    bridge::command(command).await?;
    enriched_live_state(&state).await
}

#[tauri::command]
async fn sync_live_setlist(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let state = state.inner().clone();
    let setlist = state
        .db
        .get_setlist(&id)?
        .ok_or_else(|| "Setlist not found".to_string())?;
    let songs = state.db.list_songs()?;
    let arrangement = build_arrangement(&setlist, &songs)?;
    let points: Vec<Value> = arrangement
        .markers
        .iter()
        .map(|point| json!({ "time": point.time, "name": point.name }))
        .collect();

    bridge::send("sync_cue_points", json!({ "replace": true, "points": points })).await?;
    state.db.set_active_setlist_id(Some(&setlist.id))?;

    Ok(json!({
        "arrangement": arrangement,
        "state": enriched_live_state(&state).await?
    }))
}

#[tauri::command]
async fn jump_live(
    state: State<'_, AppState>,
    song_id: Option<String>,
    instance_id: Option<String>,
    section_id: Option<String>,
) -> Result<Value, String> {
    let state = state.inner().clone();
    let arrangement = active_arrangement(&state)?
        .ok_or_else(|| "No active setlist".to_string())?;
    let (time, song) = jump_target(
        &arrangement,
        song_id.as_deref(),
        instance_id.as_deref(),
        section_id.as_deref(),
    )?;

    bridge::send("set_tempo", json!({ "bpm": song.bpm })).await?;
    bridge::send(
        "set_meter",
        json!({
            "numerator": song.meter.numerator,
            "denominator": song.meter.denominator
        }),
    )
    .await?;
    bridge::send("jump_to_time", json!({ "time": time })).await?;
    enriched_live_state(&state).await
}

#[tauri::command]
async fn run_plain_command(state: State<'_, AppState>, text: String) -> Result<Value, String> {
    let state = state.inner().clone();
    let result = command::execute(&state, &text).await?;
    Ok(json!({
        "result": result,
        "state": enriched_live_state(&state).await?,
        "library": state.db.library()?,
        "activeSetlistId": state.db.get_active_setlist_id()?,
        "arrangement": active_arrangement(&state)?
    }))
}

fn main() {
    install_panic_logger();
    append_diagnostic("Luma Live starting");

    let mut context = tauri::generate_context!();

    // macOS does not use per-window icons. Tauri's generated default window
    // icon can be rejected by Tao before the first window appears, so leave
    // the Dock icon to the macOS bundle and disable the runtime window icon.
    #[cfg(target_os = "macos")]
    context.set_default_window_icon(None);

    let result = tauri::Builder::default()
        .setup(|app| {
            let mut startup_warning = None;

            let preferred_dir = app.path().app_data_dir().ok();
            let app_dir = preferred_dir.unwrap_or_else(|| {
                startup_warning = Some("Could not resolve the normal application data folder. Using a temporary folder for this launch.".to_string());
                std::env::temp_dir().join("LumaLive")
            });

            if let Err(error) = fs::create_dir_all(&app_dir) {
                startup_warning = Some(format!(
                    "Could not create the local data folder ({error}). The library is running in memory for this launch."
                ));
            }

            let db_path = app_dir.join("luma-live.db");
            let db = match Database::open(&db_path) {
                Ok(db) => Arc::new(db),
                Err(error) => {
                    append_diagnostic(&format!("database fallback: {error}"));
                    startup_warning = Some(format!(
                        "The local database could not open ({error}). Luma Live opened with a temporary in-memory library instead of crashing."
                    ));
                    Arc::new(Database::open_in_memory().map_err(std::io::Error::other)?)
                }
            };

            match migration::migrate_if_empty(db.as_ref()) {
                Ok(Some(message)) => append_diagnostic(&message),
                Ok(None) => {}
                Err(error) => append_diagnostic(&format!("legacy migration skipped: {error}")),
            }

            let token = Arc::new(load_or_create_token(&app_dir));
            let runtime = Arc::new(RwLock::new(RuntimeInfo {
                server_running: false,
                port: None,
                local_urls: Vec::new(),
                database_path: db_path.to_string_lossy().to_string(),
                offline_ready: true,
                startup_warning,
            }));

            let state = AppState {
                db,
                runtime,
                remote_token: token,
            };

            app.manage(state.clone());

            tauri::async_runtime::spawn(async move {
                let server_state = state.clone();
                if let Err(error) = lan::run_server(state).await {
                    let message = format!(
                        "Luma Live could not start the remote on port 7878 ({error}). If the old Max bridge is still loaded, update/reload it so it uses the private 127.0.0.1:17878 adapter port."
                    );
                    append_diagnostic(&format!("LAN server failed: {message}"));
                    eprintln!("{message}");
                    if let Ok(mut runtime) = server_state.runtime.write() {
                        runtime.server_running = false;
                        runtime.port = None;
                        runtime.local_urls.clear();
                        runtime.startup_warning = Some(message);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            save_song,
            delete_song,
            save_setlist,
            delete_setlist,
            get_runtime_info,
            get_live_state,
            direct_live_command,
            sync_live_setlist,
            jump_live,
            run_plain_command
        ])
        .run(context);

    if let Err(error) = result {
        append_diagnostic(&format!("tauri run error: {error}"));
        eprintln!("Luma Live runtime error: {error}");
    }
}
