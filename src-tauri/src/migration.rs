use crate::db::Database;
use crate::models::{Meter, SectionInput, SetlistInput, SetlistItemInput, SongInput};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn legacy_root() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("LumaLiveBridge")
    })
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn import_folder_library(db: &Database, root: &Path) -> Result<usize, String> {
    let songs_dir = root.join("library").join("songs");
    let setlists_dir = root.join("library").join("setlists");
    if !songs_dir.is_dir() && !setlists_dir.is_dir() {
        return Ok(0);
    }

    let mut imported = 0usize;

    if songs_dir.is_dir() {
        for entry in fs::read_dir(&songs_dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let value = read_json(&path)?;
            let input: SongInput = serde_json::from_value(value).map_err(|e| e.to_string())?;
            db.save_song(input)?;
            imported += 1;
        }
    }

    if setlists_dir.is_dir() {
        for entry in fs::read_dir(&setlists_dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let value = read_json(&path)?;
            let input: SetlistInput = serde_json::from_value(value).map_err(|e| e.to_string())?;
            db.save_setlist(input)?;
            imported += 1;
        }
    }

    let active_file = root.join("library").join("active-setlist.json");
    if active_file.is_file() {
        if let Ok(value) = read_json(&active_file) {
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                if db.get_setlist(id)?.is_some() {
                    db.set_active_setlist_id(Some(id))?;
                }
            }
        }
    }

    Ok(imported)
}

fn import_single_file_library(db: &Database, root: &Path) -> Result<usize, String> {
    let path = root.join("library.json");
    if !path.is_file() {
        return Ok(0);
    }

    let value = read_json(&path)?;
    let mut imported = 0usize;

    if let Some(songs) = value.get("songs").and_then(Value::as_array) {
        for raw in songs {
            let Some(title) = raw.get("title").and_then(Value::as_str) else {
                continue;
            };
            let meter = raw
                .get("meter")
                .and_then(Value::as_object)
                .map(|meter| Meter {
                    numerator: meter.get("numerator").and_then(Value::as_i64).unwrap_or(4),
                    denominator: meter.get("denominator").and_then(Value::as_i64).unwrap_or(4),
                })
                .unwrap_or_default();

            let mut cursor = 1i64;
            let mut sections = Vec::new();
            if let Some(raw_sections) = raw.get("sections").and_then(Value::as_array) {
                for section in raw_sections {
                    let name = section
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Section")
                        .to_string();
                    let repeat = section.get("repeat").and_then(Value::as_i64).unwrap_or(1).max(1);
                    let bars = section.get("bars").and_then(Value::as_i64).unwrap_or(8).max(1);
                    for index in 0..repeat {
                        let label = if repeat > 1 {
                            format!("{} {}", name, index + 1)
                        } else {
                            name.clone()
                        };
                        sections.push(SectionInput {
                            id: None,
                            name: label,
                            start_bar: cursor,
                        });
                        cursor += bars;
                    }
                }
            }
            if sections.is_empty() {
                sections.push(SectionInput {
                    id: None,
                    name: "Intro".into(),
                    start_bar: 1,
                });
                cursor = 9;
            }

            let bpm = raw.get("bpm").and_then(Value::as_f64).unwrap_or(120.0);
            let input = SongInput {
                id: raw.get("id").and_then(Value::as_str).map(ToString::to_string),
                title: title.to_string(),
                artist: None,
                bpm,
                key: raw.get("key").and_then(Value::as_str).map(ToString::to_string),
                meter,
                length_bars: (cursor - 1).max(1),
                sections,
            };
            db.save_song(input)?;
            imported += 1;
        }
    }

    if let Some(setlists) = value.get("setlists").and_then(Value::as_array) {
        for raw in setlists {
            let Some(title) = raw.get("title").and_then(Value::as_str) else {
                continue;
            };
            let items = raw
                .get("items")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let song_id = item
                                .get("songId")
                                .or_else(|| item.get("song_id"))
                                .and_then(Value::as_str)?;
                            Some(SetlistItemInput {
                                id: item.get("id").and_then(Value::as_str).map(ToString::to_string),
                                song_id: song_id.to_string(),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if items.iter().all(|item| db.get_song(&item.song_id).ok().flatten().is_some()) {
                db.save_setlist(SetlistInput {
                    id: raw.get("id").and_then(Value::as_str).map(ToString::to_string),
                    title: title.to_string(),
                    gap_bars: 4,
                    items,
                })?;
                imported += 1;
            }
        }
    }

    Ok(imported)
}

pub fn migrate_if_empty(db: &Database) -> Result<Option<String>, String> {
    if !db.list_songs()?.is_empty() || !db.list_setlists()?.is_empty() {
        return Ok(None);
    }

    let Some(root) = legacy_root() else {
        return Ok(None);
    };

    let mut imported = import_folder_library(db, &root)?;
    if imported == 0 {
        imported = import_single_file_library(db, &root)?;
    }

    if imported > 0 {
        Ok(Some(format!(
            "Imported {} legacy Luma Live library item{} into SQLite.",
            imported,
            if imported == 1 { "" } else { "s" }
        )))
    } else {
        Ok(None)
    }
}
