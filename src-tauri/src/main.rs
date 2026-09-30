mod arrangement;
mod bridge;
mod command;
mod db;
mod lan;
mod migration;
mod models;
mod pairing;
mod reference_audio;
mod service_builder;
mod state;

use crate::arrangement::{build_arrangement, jump_target, locate_position, Arrangement};
use crate::db::Database;
use crate::models::{LibraryPayload, RuntimeInfo, Setlist, SetlistInput, Song, SongInput};
use crate::pairing::PairingGate;
use crate::state::AppState;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
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
    let saved = state.db.save_song(song)?;
    let root = service_builder::default_root();
    if let Err(error) = service_builder::ensure_song_package(&root, &saved) {
        append_diagnostic(&format!("song package scaffold skipped for {}: {}", saved.title, error));
    }
    Ok(saved)
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

#[tauri::command]
fn get_pairing_code(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(json!({ "code": state.pairing.current_code()? }))
}

#[tauri::command]
fn rotate_pairing_code(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(json!({ "code": state.pairing.rotate()? }))
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

    state.db.set_active_setlist_id(Some(&setlist.id))?;
    let timeline = json!({
        "songs": arrangement.songs.iter().map(|song| json!({
            "instanceId": &song.instance_id,
            "startBeat": song.start_beat,
            "endBeat": song.end_beat,
            "bpm": song.bpm,
            "numerator": song.meter.numerator,
            "denominator": song.meter.denominator
        })).collect::<Vec<_>>(),
        "transitions": &arrangement.transitions
    });
    let sync_result = async {
        bridge::send("sync_cue_points", json!({ "replace": true, "points": points })).await?;
        bridge::send("configure_service_timeline", timeline).await?;
        Ok::<(), String>(())
    }
    .await;
    let bridge_connected = sync_result.is_ok();
    let sync_error = sync_result.err();

    let live_state = if bridge_connected {
        enriched_live_state(&state).await?
    } else {
        local_offline_live_state(&state)?
    };

    Ok(json!({
        "arrangement": arrangement,
        "state": live_state,
        "bridgeConnected": bridge_connected,
        "syncError": sync_error
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

    let queued = section_id.is_some();
    let mut boundary: Option<f64> = None;
    if queued {
        let beats_per_bar =
            song.meter.numerator.max(1) as f64 * (4.0 / song.meter.denominator.max(1) as f64);
        let response = bridge::send(
            "queue_jump_to_time",
            json!({
                "time": time,
                "origin": song.start_beat,
                "beatsPerBar": beats_per_bar
            }),
        )
        .await?;
        boundary = response
            .get("result")
            .and_then(|value| value.get("boundary"))
            .and_then(Value::as_f64);
    } else {
        bridge::jump_to_time(time).await?;
    }

    let mut live = enriched_live_state(&state).await?;
    if queued {
        if let Some(object) = live.as_object_mut() {
            object.insert(
                "queuedJump".into(),
                json!({
                    "sectionId": section_id,
                    "targetBeat": time,
                    "boundary": boundary
                }),
            );
        }
    }
    Ok(live)
}

#[tauri::command]
async fn preview_plain_command(state: State<'_, AppState>, text: String) -> Result<Value, String> {
    let state = state.inner().clone();
    command::preview(&state, &text).await
}

#[tauri::command]
async fn run_plain_command(state: State<'_, AppState>, text: String) -> Result<Value, String> {
    let state = state.inner().clone();
    let result = command::execute(&state, &text).await?;
    let known_offline = result.get("bridgeConnected").and_then(Value::as_bool) == Some(false);
    let live_state = if known_offline {
        local_offline_live_state(&state)?
    } else {
        enriched_live_state(&state).await?
    };
    Ok(json!({
        "result": result,
        "state": live_state,
        "library": state.db.library()?,
        "activeSetlistId": state.db.get_active_setlist_id()?,
        "arrangement": active_arrangement(&state)?
    }))
}

#[cfg(target_os = "macos")]
fn choose_macos_folder(prompt: &str) -> Result<Option<PathBuf>, String> {
    let script = format!(
        "POSIX path of (choose folder with prompt {:?})",
        prompt
    );
    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() { Ok(None) } else { Ok(Some(PathBuf::from(value))) }
}

#[cfg(not(target_os = "macos"))]
fn choose_macos_folder(_prompt: &str) -> Result<Option<PathBuf>, String> {
    Err("Folder chooser is currently available on macOS only".into())
}

#[cfg(target_os = "macos")]
fn choose_macos_files(prompt: &str) -> Result<Vec<PathBuf>, String> {
    let script = format!(
        r#"set chosenFiles to choose file with prompt {:?} with multiple selections allowed
set outputText to ""
repeat with chosenFile in chosenFiles
  set outputText to outputText & (POSIX path of chosenFile) & linefeed
end repeat
return outputText"#,
        prompt
    );
    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .collect())
}

#[cfg(not(target_os = "macos"))]
fn choose_macos_files(_prompt: &str) -> Result<Vec<PathBuf>, String> {
    Err("File chooser is currently available on macOS only".into())
}

fn song_by_id(state: &AppState, id: &str) -> Result<Song, String> {
    state
        .db
        .get_song(id)?
        .ok_or_else(|| "Song not found".to_string())
}

#[tauri::command]
fn get_song_package_statuses(state: State<'_, AppState>) -> Result<Value, String> {
    let root = service_builder::default_root();
    let mut statuses = Vec::new();
    for song in state.db.list_songs()? {
        statuses.push(service_builder::package_status(&root, &song)?);
    }
    serde_json::to_value(statuses).map_err(|e| e.to_string())
}

#[tauri::command]
fn rescan_song_package(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let root = service_builder::default_root();
    let song = song_by_id(state.inner(), &id)?;
    let status = service_builder::package_status(&root, &song)?;
    serde_json::to_value(status).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_song_package(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let root = service_builder::default_root();
    let song = song_by_id(state.inner(), &id)?;
    let package = service_builder::ensure_song_package(&root, &song)?;
    std::process::Command::new("open")
        .arg(&package)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(package.to_string_lossy().to_string())
}

#[tauri::command]
fn attach_song_project(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    let Some(source) = choose_macos_folder("Choose the Ableton Project folder for this song")? else {
        return Err("Project attachment cancelled".into());
    };
    let status = service_builder::adopt_project(&service_builder::default_root(), &song, &source)?;
    serde_json::to_value(status).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_reference_status(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    serde_json::to_value(reference_audio::status(
        &service_builder::default_root(),
        &song,
    )?)
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn import_reference_track(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    let files = choose_macos_files("Choose one rehearsal/reference audio file")?;
    let Some(source) = files.first() else {
        return Err("Reference track import cancelled".into());
    };
    serde_json::to_value(reference_audio::import_file(
        &service_builder::default_root(),
        &song,
        source,
    )?)
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn use_selected_ableton_reference(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    let live = bridge::send("get_detail_clip_info", json!({})).await?;
    let detail = live
        .get("detailClip")
        .or_else(|| live.get("selectedClip"))
        .ok_or_else(|| "Select an audio clip in Ableton first".to_string())?;
    let is_audio = detail
        .get("isAudioClip")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !is_audio {
        return Err("The selected Ableton clip is not an audio clip".into());
    }
    let file_path = detail
        .get("filePath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "This Max adapter is not reporting the selected clip file path yet. Install the current adapter and try again."
                .to_string()
        })?;

    serde_json::to_value(reference_audio::attach_external(
        &service_builder::default_root(),
        &song,
        std::path::Path::new(file_path),
        "ableton",
    )?)
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn analyze_reference_track(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    let root = service_builder::default_root();
    let analysis = tokio::task::spawn_blocking(move || {
        reference_audio::analyze(&root, &song)
    })
    .await
    .map_err(|e| e.to_string())??;
    serde_json::to_value(analysis).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_reference_alignment(
    state: State<'_, AppState>,
    id: String,
    alignment: reference_audio::ReferenceAlignment,
) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    serde_json::to_value(reference_audio::save_alignment(
        &service_builder::default_root(),
        &song,
        alignment,
    )?)
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn capture_detail_clip_position() -> Result<Value, String> {
    let response = bridge::send("get_detail_clip_info", json!({})).await?;
    Ok(response)
}

#[tauri::command]
async fn apply_reference_warp(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    let status = reference_audio::status(&service_builder::default_root(), &song)?;
    let alignment = status
        .alignment
        .ok_or_else(|| "Align the reference track first".to_string())?;
    let analysis = status
        .analysis
        .ok_or_else(|| "Analyze the reference track first".to_string())?;

    let mut markers = alignment.markers.clone();
    if !markers.iter().any(|marker| marker.beat_time.abs() <= 0.0001) {
        markers.push(reference_audio::WarpMarker {
            sample_time: alignment.first_downbeat_seconds,
            beat_time: 0.0,
        });
    }

    if markers.len() < 2 && analysis.duration_seconds > alignment.first_downbeat_seconds {
        markers.push(reference_audio::WarpMarker {
            sample_time: analysis.duration_seconds,
            beat_time: (analysis.duration_seconds - alignment.first_downbeat_seconds)
                * alignment.bpm
                / 60.0,
        });
    }

    markers.sort_by(|a, b| a.sample_time.total_cmp(&b.sample_time));
    let response = bridge::send(
        "apply_detail_clip_warp",
        json!({
            "bpm": alignment.bpm,
            "numerator": alignment.numerator,
            "denominator": alignment.denominator,
            "markers": markers,
            "warpMode": 6
        }),
    )
    .await?;
    Ok(response)
}

#[tauri::command]
fn import_song_stems(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let song = song_by_id(state.inner(), &id)?;
    let files = choose_macos_files("Choose the original stems for this song")?;
    if files.is_empty() {
        return Err("Stem import cancelled".into());
    }
    let status = service_builder::import_stems(&service_builder::default_root(), &song, &files)?;
    serde_json::to_value(status).map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_system_check(state: State<'_, AppState>) -> Result<Value, String> {
    let root = service_builder::default_root();
    service_builder::ensure_layout(&root)?;

    let probe = root.join(".luma-write-test");
    let writable = fs::write(&probe, b"ok").is_ok();
    let _ = fs::remove_file(&probe);
    let template = root.join("Templates").join("Church Standard.als");

    let mut packages = Vec::new();
    let mut references = Vec::new();
    for song in state.db.list_songs()? {
        packages.push(service_builder::package_status(&root, &song)?);
        references.push(reference_audio::status(&root, &song)?);
    }

    let bridge_health = bridge::health_info().await;
    let bridge_connected = bridge_health.is_ok();
    let bridge_error = bridge_health.as_ref().err().cloned();
    let adapter_version = bridge_health
        .as_ref()
        .ok()
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let capabilities = bridge_health
        .as_ref()
        .ok()
        .and_then(|value| value.get("capabilities"))
        .cloned()
        .unwrap_or_else(|| json!([]));

    Ok(json!({
        "libraryRoot": root.to_string_lossy().to_string(),
        "libraryWritable": writable,
        "templateExists": template.exists(),
        "bridgeConnected": bridge_connected,
        "bridgeError": bridge_error,
        "adapterVersion": adapter_version,
        "adapterCapabilities": capabilities,
        "songCount": packages.len(),
        "packages": packages,
        "references": references
    }))
}

#[tauri::command]
fn reveal_service_build(path: String) -> Result<(), String> {
    let root = service_builder::default_root().join("Services");
    let root_canonical = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    let target = fs::canonicalize(PathBuf::from(&path)).map_err(|e| e.to_string())?;
    if !target.starts_with(&root_canonical) {
        return Err("That folder is outside the Luma Live Services library".into());
    }
    std::process::Command::new("open")
        .arg(&target)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn reveal_library_root() -> Result<String, String> {
    let root = service_builder::default_root();
    service_builder::ensure_layout(&root)?;
    std::process::Command::new("open")
        .arg(&root)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
async fn build_service(
    state: State<'_, AppState>,
    id: String,
    build_ableton: bool,
) -> Result<Value, String> {
    let state = state.inner().clone();
    let setlist = state
        .db
        .get_setlist(&id)?
        .ok_or_else(|| "Setlist not found".to_string())?;
    let songs = state.db.list_songs()?;
    let arrangement = build_arrangement(&setlist, &songs)?;
    let root = service_builder::default_root();

    // A service build is a collected snapshot, so do not silently create a
    // "successful" service from song records that have no actual show files.
    let song_map: std::collections::HashMap<&str, &crate::models::Song> =
        songs.iter().map(|song| (song.id.as_str(), song)).collect();
    let mut package_blockers = Vec::new();
    let mut checked = std::collections::HashSet::new();
    for item in &setlist.items {
        if !checked.insert(item.song_id.clone()) {
            continue;
        }
        let song = song_map
            .get(item.song_id.as_str())
            .copied()
            .ok_or_else(|| format!("Song {} is missing from the library", item.song_id))?;
        let status = service_builder::package_status(&root, song)?;
        let reference = reference_audio::status(&root, song)?;
        let mut missing = Vec::new();
        if status.source_als.is_none() && !reference.source_exists {
            missing.push("Ableton Project/.als or reference track");
        }
        if status.stem_count == 0 && !reference.source_exists {
            missing.push("original stems or reference track");
        }
        if status.stem_count == 0 && reference.source_exists && reference.alignment.is_none() {
            missing.push("saved reference grid alignment");
        }
        if !missing.is_empty() {
            package_blockers.push(format!("{}: {}", song.title, missing.join(" + ")));
        }
    }
    if !package_blockers.is_empty() {
        return Err(format!(
            "Service build stopped. Finish these song packages first: {}",
            package_blockers.join(" · ")
        ));
    }

    let result = service_builder::build_service_folder(
        &root,
        &setlist,
        &songs,
        arrangement.clone(),
    )?;

    state.db.set_active_setlist_id(Some(&setlist.id))?;

    let mut ableton_built = false;
    let mut ableton_error: Option<String> = None;

    if build_ableton {
        let build_result: Result<(), String> = async {
            let health = bridge::health_info().await?;
            let capabilities = health
                .get("capabilities")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let has = |name: &str| capabilities.iter().any(|value| value.as_str() == Some(name));
            if !has("arrangement-audio") || !has("transpose") || !has("bulk-build") {
                let version = health
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                return Err(format!(
                    "Max adapter {} is outdated. Install Luma Live Max Adapter v0.6.1 or newer before building services.",
                    version
                ));
            }

            // Preflight every destination track before clearing the current Luma
            // Arrangement. A stale track with the right name but wrong type, or a
            // frozen track, must fail while the previous show is still intact.
            let mut ensured = std::collections::HashSet::new();
            for placement in &result.audio {
                if ensured.insert(placement.track.clone()) {
                    bridge::send(
                        "ensure_track",
                        json!({ "kind": "audio", "name": placement.track }),
                    )
                    .await?;
                }
            }
            bridge::send("ensure_track", json!({ "kind": "midi", "name": "LIGHTING" })).await?;
            bridge::send("ensure_track", json!({ "kind": "midi", "name": "MIDI / CUES" })).await?;

            bridge::send("begin_bulk_update", json!({})).await?;
            let write_result: Result<(), String> = async {
                bridge::send("clear_luma_arrangement", json!({})).await?;

                let points: Vec<Value> = arrangement
                    .markers
                    .iter()
                    .map(|point| json!({ "time": point.time, "name": point.name }))
                    .collect();
                bridge::send(
                    "sync_cue_points",
                    json!({ "replace": true, "points": points }),
                )
                .await?;

                let timeline = json!({
                    "songs": arrangement.songs.iter().map(|song| json!({
                        "instanceId": &song.instance_id,
                        "startBeat": song.start_beat,
                        "endBeat": song.end_beat,
                        "bpm": song.bpm,
                        "numerator": song.meter.numerator,
                        "denominator": song.meter.denominator
                    })).collect::<Vec<_>>(),
                    "transitions": &arrangement.transitions
                });
                bridge::send("configure_service_timeline", timeline).await?;

                for placement in &result.audio {
                    bridge::send(
                        "create_arrangement_audio_clip",
                        json!({
                            "track": { "name": placement.track },
                            "filePath": placement.collected_path,
                            "position": placement.start_beat,
                            "name": placement.clip_name,
                            "transposeSemitones": placement.transpose_semitones,
                            "referenceAlignment": placement.reference_alignment
                        }),
                    )
                    .await?;
                }

                for cue in &result.cues {
                    let track = if cue.kind.to_lowercase().contains("light") {
                        "LIGHTING"
                    } else {
                        "MIDI / CUES"
                    };
                    let file_name = std::path::Path::new(&cue.collected_path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("cue");
                    bridge::send(
                        "create_arrangement_midi_clip",
                        json!({
                            "track": { "name": track },
                            "position": cue.beat,
                            "lengthBeats": 0.25,
                            "name": format!("LL|CUE|{}|{}", cue.kind.to_uppercase(), file_name)
                        }),
                    )
                    .await?;
                }

                if let Some(first) = arrangement.songs.first() {
                    bridge::send("set_tempo", json!({ "bpm": first.bpm })).await?;
                    bridge::send(
                        "set_meter",
                        json!({
                            "numerator": first.meter.numerator,
                            "denominator": first.meter.denominator
                        }),
                    )
                    .await?;
                    bridge::jump_to_time(first.start_beat).await?;
                }

                Ok(())
            }
            .await;

            match write_result {
                Ok(()) => {
                    bridge::send("end_bulk_update", json!({})).await?;
                    Ok(())
                }
                Err(error) => {
                    // A failed build must never leave a half-programmed show behind.
                    // Remove only Luma-owned Arrangement clips/locators, stop any
                    // transition timeline/loop, and always leave bulk mode.
                    let mut cleanup_errors = Vec::new();

                    if let Err(cleanup) = bridge::send("clear_luma_arrangement", json!({})).await {
                        cleanup_errors.push(format!("clips: {cleanup}"));
                    }
                    if let Err(cleanup) = bridge::send(
                        "sync_cue_points",
                        json!({ "replace": true, "points": Vec::<Value>::new() }),
                    )
                    .await
                    {
                        cleanup_errors.push(format!("locators: {cleanup}"));
                    }
                    if let Err(cleanup) = bridge::send(
                        "configure_service_timeline",
                        json!({ "songs": Vec::<Value>::new(), "transitions": Vec::<Value>::new() }),
                    )
                    .await
                    {
                        cleanup_errors.push(format!("timeline: {cleanup}"));
                    }
                    if let Err(cleanup) = bridge::send("end_bulk_update", json!({})).await {
                        cleanup_errors.push(format!("bulk mode: {cleanup}"));
                    }

                    if cleanup_errors.is_empty() {
                        Err(format!(
                            "Ableton service build failed and partial Luma data was removed: {error}"
                        ))
                    } else {
                        Err(format!(
                            "Ableton service build failed: {error}. Cleanup also reported: {}",
                            cleanup_errors.join(" · ")
                        ))
                    }
                }
            }
        }
        .await;

        match build_result {
            Ok(()) => ableton_built = true,
            Err(error) => {
                ableton_error = Some(error);
            }
        }
    }

    Ok(json!({
        "ok": true,
        "service": result,
        "arrangement": arrangement,
        "abletonBuilt": ableton_built,
        "abletonError": ableton_error
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

            let library_root = service_builder::default_root();
            if let Err(error) = service_builder::ensure_layout(&library_root) {
                append_diagnostic(&format!("library folder scaffold failed: {error}"));
                startup_warning = Some(format!(
                    "Luma Live opened, but the media library folder could not be prepared ({error})."
                ));
            }

            let token = Arc::new(load_or_create_token(&app_dir));
            let runtime = Arc::new(RwLock::new(RuntimeInfo {
                server_running: false,
                port: None,
                local_urls: Vec::new(),
                database_path: db_path.to_string_lossy().to_string(),
                library_root: library_root.to_string_lossy().to_string(),
                offline_ready: true,
                startup_warning,
            }));

            let state = AppState {
                db,
                runtime,
                remote_token: token,
                pairing: Arc::new(PairingGate::new()),
            };

            app.manage(state.clone());

            tauri::async_runtime::spawn(async move {
                let server_state = state.clone();
                if let Err(error) = lan::run_server(state).await {
                    let message = format!(
                        "Luma Live could not start its LAN remote on any port from 7878 through 7897 ({error})."
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
            get_pairing_code,
            rotate_pairing_code,
            get_live_state,
            direct_live_command,
            sync_live_setlist,
            jump_live,
            preview_plain_command,
            run_plain_command,
            reveal_library_root,
            reveal_service_build,
            get_song_package_statuses,
            rescan_song_package,
            reveal_song_package,
            attach_song_project,
            import_song_stems,
            get_reference_status,
            import_reference_track,
            use_selected_ableton_reference,
            analyze_reference_track,
            save_reference_alignment,
            capture_detail_clip_position,
            apply_reference_warp,
            run_system_check,
            build_service
        ])
        .run(context);

    if let Err(error) = result {
        append_diagnostic(&format!("tauri run error: {error}"));
        eprintln!("Luma Live runtime error: {error}");
    }
}
