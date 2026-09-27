mod db;
mod lan;
mod models;
mod state;

use crate::db::Database;
use crate::models::{LibraryPayload, RuntimeInfo, Setlist, SetlistInput, Song, SongInput};
use crate::state::AppState;
use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};
use tauri::{Manager, State};
use uuid::Uuid;

fn load_or_create_token(app_dir: &Path) -> Result<String, String> {
    let path = app_dir.join("remote-token");

    if let Ok(value) = fs::read_to_string(&path) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let token = Uuid::new_v4().simple().to_string();
    fs::write(&path, format!("{}\n", token)).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o600);
            let _ = fs::set_permissions(&path, permissions);
        }
    }

    Ok(token)
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Could not resolve Luma Live data directory: {e}"))?;
            fs::create_dir_all(&app_dir)
                .map_err(|e| format!("Could not create Luma Live data directory: {e}"))?;

            let db_path = app_dir.join("luma-live.db");
            let db = Arc::new(
                Database::open(&db_path).map_err(std::io::Error::other)?
            );
            let token = Arc::new(
                load_or_create_token(&app_dir).map_err(std::io::Error::other)?
            );
            let runtime = Arc::new(RwLock::new(RuntimeInfo {
                server_running: false,
                port: None,
                local_urls: Vec::new(),
                database_path: db_path.to_string_lossy().to_string(),
                offline_ready: true,
            }));

            let state = AppState {
                db,
                runtime,
                remote_token: token,
            };

            app.manage(state.clone());

            tauri::async_runtime::spawn(async move {
                if let Err(error) = lan::run_server(state).await {
                    eprintln!("Luma Live LAN server failed: {error}");
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
            get_runtime_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Luma Live");
}
