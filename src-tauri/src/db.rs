use crate::models::{
    LibraryPayload, Meter, Section, SectionInput, Setlist, SetlistInput, SetlistItem, Song, SongInput,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "item".to_string()
    } else {
        out.chars().take(80).collect()
    }
}

fn validate_meter(meter: &Meter) -> Result<(), String> {
    if meter.numerator < 1 || meter.numerator > 32 {
        return Err("Meter numerator must be 1–32".into());
    }
    if ![1, 2, 4, 8, 16].contains(&meter.denominator) {
        return Err("Meter denominator must be 1, 2, 4, 8, or 16".into());
    }
    Ok(())
}

fn normalize_sections(input: &[SectionInput], length_bars: i64) -> Result<Vec<Section>, String> {
    if input.is_empty() {
        return Err("A song needs at least one section".into());
    }

    let mut used = HashSet::new();
    let mut sections = Vec::with_capacity(input.len());

    for (index, raw) in input.iter().enumerate() {
        let name = raw.name.trim();
        if name.is_empty() {
            return Err(format!("Section {} needs a name", index + 1));
        }
        if raw.start_bar < 1 || raw.start_bar > length_bars {
            return Err(format!(
                "{} must start between bar 1 and bar {}",
                name, length_bars
            ));
        }

        let base = slugify(raw.id.as_deref().unwrap_or(name));
        let mut id = base.clone();
        let mut suffix = 2;
        while used.contains(&id) {
            id = format!("{}-{}", base, suffix);
            suffix += 1;
        }
        used.insert(id.clone());

        sections.push(Section {
            id,
            name: name.chars().take(120).collect(),
            start_bar: raw.start_bar,
        });
    }

    sections.sort_by_key(|section| section.start_bar);
    Ok(sections)
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| e.to_string())?;

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS songs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL DEFAULT '',
                bpm REAL NOT NULL,
                song_key TEXT NOT NULL DEFAULT '',
                meter_num INTEGER NOT NULL,
                meter_den INTEGER NOT NULL,
                length_bars INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sections (
                song_id TEXT NOT NULL,
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_bar INTEGER NOT NULL,
                sort_index INTEGER NOT NULL,
                PRIMARY KEY (song_id, id),
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS setlists (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                gap_bars INTEGER NOT NULL DEFAULT 4,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS setlist_items (
                id TEXT PRIMARY KEY,
                setlist_id TEXT NOT NULL,
                song_id TEXT NOT NULL,
                sort_index INTEGER NOT NULL,
                FOREIGN KEY (setlist_id) REFERENCES setlists(id) ON DELETE CASCADE,
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE RESTRICT
            );
            "#,
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn library(&self) -> Result<LibraryPayload, String> {
        Ok(LibraryPayload {
            songs: self.list_songs()?,
            setlists: self.list_setlists()?,
        })
    }

    pub fn list_songs(&self) -> Result<Vec<Song>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock failed".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, artist, bpm, song_key, meter_num, meter_den, length_bars, updated_at
                 FROM songs ORDER BY title COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Song {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    bpm: row.get(3)?,
                    key: row.get(4)?,
                    meter: Meter {
                        numerator: row.get(5)?,
                        denominator: row.get(6)?,
                    },
                    length_bars: row.get(7)?,
                    sections: Vec::new(),
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut songs: Vec<Song> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for song in &mut songs {
            let mut section_stmt = conn
                .prepare(
                    "SELECT id, name, start_bar FROM sections
                     WHERE song_id = ?1 ORDER BY sort_index, start_bar",
                )
                .map_err(|e| e.to_string())?;
            let section_rows = section_stmt
                .query_map(params![song.id], |row| {
                    Ok(Section {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        start_bar: row.get(2)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            song.sections = section_rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
        }

        Ok(songs)
    }

    pub fn save_song(&self, input: SongInput) -> Result<Song, String> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err("Song title is required".into());
        }
        if !(20.0..=999.0).contains(&input.bpm) {
            return Err("Song BPM must be between 20 and 999".into());
        }
        if input.length_bars < 1 || input.length_bars > 10_000 {
            return Err("Song length must be between 1 and 10,000 bars".into());
        }
        validate_meter(&input.meter)?;
        let sections = normalize_sections(&input.sections, input.length_bars)?;

        let id = input
            .id
            .as_deref()
            .map(slugify)
            .unwrap_or_else(|| slugify(title));
        let artist = input.artist.clone().unwrap_or_default().trim().to_string();
        let song_key = input.key.clone().unwrap_or_default().trim().to_string();
        let updated_at = now_ms();

        let mut conn = self.conn.lock().map_err(|_| "Database lock failed".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO songs
             (id, title, artist, bpm, song_key, meter_num, meter_den, length_bars, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               artist = excluded.artist,
               bpm = excluded.bpm,
               song_key = excluded.song_key,
               meter_num = excluded.meter_num,
               meter_den = excluded.meter_den,
               length_bars = excluded.length_bars,
               updated_at = excluded.updated_at",
            params![
                id,
                title,
                artist,
                input.bpm,
                song_key,
                input.meter.numerator,
                input.meter.denominator,
                input.length_bars,
                updated_at
            ],
        )
        .map_err(|e| e.to_string())?;

        tx.execute("DELETE FROM sections WHERE song_id = ?1", params![id])
            .map_err(|e| e.to_string())?;

        for (index, section) in sections.iter().enumerate() {
            tx.execute(
                "INSERT INTO sections (song_id, id, name, start_bar, sort_index)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, section.id, section.name, section.start_bar, index as i64],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;

        Ok(Song {
            id,
            title: title.to_string(),
            artist,
            bpm: input.bpm,
            key: song_key,
            meter: input.meter,
            length_bars: input.length_bars,
            sections,
            updated_at,
        })
    }

    pub fn delete_song(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock failed".to_string())?;
        let refs: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM setlist_items WHERE song_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if refs > 0 {
            return Err("Remove this song from saved setlists before deleting it".into());
        }

        conn.execute("DELETE FROM songs WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_setlists(&self) -> Result<Vec<Setlist>, String> {
        let conn = self.conn.lock().map_err(|_| "Database lock failed".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, title, gap_bars, updated_at
                 FROM setlists ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Setlist {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    gap_bars: row.get(2)?,
                    items: Vec::new(),
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut setlists: Vec<Setlist> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for setlist in &mut setlists {
            let mut item_stmt = conn
                .prepare(
                    "SELECT id, song_id FROM setlist_items
                     WHERE setlist_id = ?1 ORDER BY sort_index",
                )
                .map_err(|e| e.to_string())?;
            let item_rows = item_stmt
                .query_map(params![setlist.id], |row| {
                    Ok(SetlistItem {
                        id: row.get(0)?,
                        song_id: row.get(1)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            setlist.items = item_rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
        }

        Ok(setlists)
    }

    pub fn save_setlist(&self, input: SetlistInput) -> Result<Setlist, String> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err("Setlist title is required".into());
        }
        if input.gap_bars < 0 || input.gap_bars > 64 {
            return Err("Gap between songs must be 0–64 bars".into());
        }
        if input.items.len() > 100 {
            return Err("Setlist is too large".into());
        }

        let id = input
            .id
            .as_deref()
            .map(slugify)
            .unwrap_or_else(|| slugify(title));
        let updated_at = now_ms();

        let mut conn = self.conn.lock().map_err(|_| "Database lock failed".to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        for item in &input.items {
            let exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM songs WHERE id = ?1",
                    params![item.song_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if exists.is_none() {
                return Err(format!("Song {} is not in the library", item.song_id));
            }
        }

        tx.execute(
            "INSERT INTO setlists (id, title, gap_bars, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               gap_bars = excluded.gap_bars,
               updated_at = excluded.updated_at",
            params![id, title, input.gap_bars, updated_at],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM setlist_items WHERE setlist_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;

        let mut items = Vec::with_capacity(input.items.len());
        for (index, item) in input.items.iter().enumerate() {
            let item_id = item
                .id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            tx.execute(
                "INSERT INTO setlist_items (id, setlist_id, song_id, sort_index)
                 VALUES (?1, ?2, ?3, ?4)",
                params![item_id, id, item.song_id, index as i64],
            )
            .map_err(|e| e.to_string())?;
            items.push(SetlistItem {
                id: item_id,
                song_id: item.song_id.clone(),
            });
        }

        tx.commit().map_err(|e| e.to_string())?;

        Ok(Setlist {
            id,
            title: title.to_string(),
            gap_bars: input.gap_bars,
            items,
            updated_at,
        })
    }

    pub fn delete_setlist(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "Database lock failed".to_string())?;
        conn.execute("DELETE FROM setlists WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
