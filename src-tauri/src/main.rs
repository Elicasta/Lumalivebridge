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

fn main() {
    install_panic_logger();
    append_diagnostic("Luma Live starting");

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
        .run(tauri::generate_context!());

    if let Err(error) = result {
        append_diagnostic(&format!("tauri run error: {error}"));
        eprintln!("Luma Live runtime error: {error}");
    }
}
