use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meter {
    pub numerator: i64,
    pub denominator: i64,
}

impl Default for Meter {
    fn default() -> Self {
        Self {
            numerator: 4,
            denominator: 4,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionInput {
    pub id: Option<String>,
    pub name: String,
    pub start_bar: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub start_bar: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongInput {
    pub id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub bpm: f64,
    pub key: Option<String>,
    pub meter: Meter,
    pub length_bars: i64,
    pub sections: Vec<SectionInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub bpm: f64,
    pub key: String,
    pub meter: Meter,
    pub length_bars: i64,
    pub sections: Vec<Section>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetlistItemInput {
    pub id: Option<String>,
    pub song_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetlistItem {
    pub id: String,
    pub song_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetlistInput {
    pub id: Option<String>,
    pub title: String,
    pub gap_bars: i64,
    pub items: Vec<SetlistItemInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setlist {
    pub id: String,
    pub title: String,
    pub gap_bars: i64,
    pub items: Vec<SetlistItem>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPayload {
    pub songs: Vec<Song>,
    pub setlists: Vec<Setlist>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub server_running: bool,
    pub port: Option<u16>,
    pub local_urls: Vec<String>,
    pub database_path: String,
    pub offline_ready: bool,
    pub startup_warning: Option<String>,
}
