use crate::arrangement::Arrangement;
use crate::models::{Setlist, Song};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StemAsset {
    pub role: String,
    pub file: String,
    pub track: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CueAsset {
    pub kind: String,
    pub file: String,
    pub section_id: Option<String>,
    pub beat_offset: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SongPackageManifest {
    pub schema_version: i64,
    pub song_id: String,
    pub title: String,
    pub version: i64,
    pub source_als: Option<String>,
    #[serde(default)]
    pub stems: Vec<StemAsset>,
    #[serde(default)]
    pub cues: Vec<CueAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceAudioPlacement {
    pub song_id: String,
    pub instance_id: String,
    pub role: String,
    pub track: String,
    pub source_path: String,
    pub collected_path: String,
    pub start_beat: f64,
    pub clip_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceBuildManifest {
    pub schema_version: i64,
    pub service_id: String,
    pub title: String,
    pub build_id: String,
    pub arrangement: Arrangement,
    pub audio: Vec<ServiceAudioPlacement>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceBuildResult {
    pub root: String,
    pub service_folder: String,
    pub manifest_path: String,
    pub template_als: Option<String>,
    pub audio: Vec<ServiceAudioPlacement>,
    pub warnings: Vec<String>,
}

pub fn default_root() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Music").join("Luma Live");
    }
    std::env::temp_dir().join("Luma Live")
}

pub fn ensure_layout(root: &Path) -> Result<(), String> {
    for relative in [
        "Library/Songs",
        "Library/_Incoming",
        "Services",
        "Templates/Busk",
        "Backups",
        "Cache",
    ] {
        fs::create_dir_all(root.join(relative)).map_err(|e| e.to_string())?;
    }

    let tracks = root.join("Templates").join("TRACKS.txt");
    if !tracks.exists() {
        fs::write(
            tracks,
            "01 CLICK\n02 GUIDE\n03 LOOPS / PERC\n04 DRUMS\n05 BASS\n06 KEYS\n07 GUITARS\n08 BGV\n09 EXTRA 1\n10 EXTRA 2\n11 LIGHTING\n12 MIDI / CUES\n",
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn safe_component(value: &str) -> String {
    let mut out = String::new();
    let mut spacer = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
            spacer = false;
        } else if ch.is_whitespace() || ch == '/' || ch == '\\' {
            if !spacer && !out.is_empty() {
                out.push(' ');
                spacer = true;
            }
        }
    }
    let trimmed = out.trim().to_string();
    if trimmed.is_empty() {
        "Untitled".into()
    } else {
        trimmed.chars().take(96).collect()
    }
}

pub fn song_package_dir(root: &Path, song: &Song) -> PathBuf {
    root.join("Library").join("Songs").join(&song.id)
}

fn default_track(role: &str) -> &'static str {
    match role.trim().to_lowercase().as_str() {
        "click" => "CLICK",
        "guide" => "GUIDE",
        "loop" | "loops" | "perc" | "percussion" => "LOOPS / PERC",
        "drum" | "drums" => "DRUMS",
        "bass" => "BASS",
        "key" | "keys" | "piano" => "KEYS",
        "guitar" | "guitars" | "gtr" => "GUITARS",
        "bgv" | "bgvs" | "vocal" | "vocals" => "BGV",
        "extra1" | "extra 1" => "EXTRA 1",
        "extra2" | "extra 2" => "EXTRA 2",
        _ => "EXTRA 1",
    }
}

fn role_from_filename(path: &Path) -> String {
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    for (needle, role) in [
        ("click", "click"),
        ("guide", "guide"),
        ("loop", "loops"),
        ("perc", "loops"),
        ("drum", "drums"),
        ("bass", "bass"),
        ("key", "keys"),
        ("piano", "keys"),
        ("guitar", "guitars"),
        ("gtr", "guitars"),
        ("bgv", "bgv"),
        ("vocal", "bgv"),
    ] {
        if name.contains(needle) {
            return role.into();
        }
    }
    "extra1".into()
}

fn scan_audio(package_dir: &Path) -> Result<Vec<StemAsset>, String> {
    let audio_dir = package_dir.join("Audio");
    if !audio_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&audio_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["wav", "aif", "aiff", "flac", "mp3", "m4a"].contains(&extension.as_str()) {
            continue;
        }
        let role = role_from_filename(&path);
        let file = path
            .strip_prefix(package_dir)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        files.push(StemAsset {
            track: default_track(&role).into(),
            role,
            file,
        });
    }

    files.sort_by(|a, b| a.track.cmp(&b.track).then(a.file.cmp(&b.file)));
    Ok(files)
}

pub fn ensure_song_package(root: &Path, song: &Song) -> Result<PathBuf, String> {
    ensure_layout(root)?;
    let package = song_package_dir(root, song);
    fs::create_dir_all(package.join("Audio")).map_err(|e| e.to_string())?;
    fs::create_dir_all(package.join("Cues")).map_err(|e| e.to_string())?;
    fs::create_dir_all(package.join("Exports")).map_err(|e| e.to_string())?;

    let manifest_path = package.join("song.json");
    let mut manifest = if manifest_path.exists() {
        serde_json::from_str::<SongPackageManifest>(
            &fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?,
        )
        .unwrap_or(SongPackageManifest {
            schema_version: 1,
            song_id: song.id.clone(),
            title: song.title.clone(),
            version: 1,
            source_als: None,
            stems: Vec::new(),
            cues: Vec::new(),
        })
    } else {
        SongPackageManifest {
            schema_version: 1,
            song_id: song.id.clone(),
            title: song.title.clone(),
            version: 1,
            source_als: None,
            stems: Vec::new(),
            cues: Vec::new(),
        }
    };

    manifest.song_id = song.id.clone();
    manifest.title = song.title.clone();
    if manifest.stems.is_empty() {
        manifest.stems = scan_audio(&package)?;
    }

    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let info_path = package.join("README.txt");
    if !info_path.exists() {
        fs::write(
            info_path,
            format!(
                "{}\n\nPut the song's authoring Ableton Set in this folder.\nPut stems in Audio/. Luma auto-detects common names such as Click, Guide, Drums, Bass, Keys, Guitar, and BGV.\nPut song-specific lighting, ProPresenter, MainStage, or MIDI cue files in Cues/.\n\nThe song.json file is Luma Live's portable song manifest.\n",
                song.title
            ),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(package)
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_tree(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn load_manifest(package: &Path, song: &Song) -> Result<SongPackageManifest, String> {
    let path = package.join("song.json");
    let mut manifest = if path.exists() {
        serde_json::from_str::<SongPackageManifest>(
            &fs::read_to_string(&path).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("{} has an invalid song.json: {}", song.title, e))?
    } else {
        SongPackageManifest {
            schema_version: 1,
            song_id: song.id.clone(),
            title: song.title.clone(),
            version: 1,
            source_als: None,
            stems: Vec::new(),
            cues: Vec::new(),
        }
    };
    if manifest.stems.is_empty() {
        manifest.stems = scan_audio(package)?;
    }
    Ok(manifest)
}

pub fn build_service_folder(
    root: &Path,
    setlist: &Setlist,
    songs: &[Song],
    arrangement: Arrangement,
) -> Result<ServiceBuildResult, String> {
    ensure_layout(root)?;

    let build_id = format!("build-{}", now_ms());
    let service_root = root.join("Services").join(safe_component(&setlist.title));
    let build_root = service_root.join(&build_id);
    let songs_root = build_root.join("Songs");
    fs::create_dir_all(&songs_root).map_err(|e| e.to_string())?;

    let song_map: std::collections::HashMap<&str, &Song> =
        songs.iter().map(|song| (song.id.as_str(), song)).collect();
    let placement_map: std::collections::HashMap<&str, &crate::arrangement::ArrangementSong> =
        arrangement
            .songs
            .iter()
            .map(|song| (song.instance_id.as_str(), song))
            .collect();

    let mut audio = Vec::new();
    let mut warnings = Vec::new();

    for (index, item) in setlist.items.iter().enumerate() {
        let song = song_map
            .get(item.song_id.as_str())
            .copied()
            .ok_or_else(|| format!("Song {} is missing from the library", item.song_id))?;
        let placement = placement_map
            .get(item.id.as_str())
            .copied()
            .ok_or_else(|| format!("Arrangement placement {} is missing", item.id))?;

        let package = ensure_song_package(root, song)?;
        let manifest = load_manifest(&package, song)?;
        let collected = songs_root.join(format!("{:02} - {}", index + 1, safe_component(&song.title)));
        copy_tree(&package, &collected)?;

        if manifest.stems.is_empty() {
            warnings.push(format!(
                "{} has no detected stems yet. Drop its audio files into {}/Audio.",
                song.title,
                package.to_string_lossy()
            ));
        }

        for stem in manifest.stems {
            let source = package.join(&stem.file);
            let destination = collected.join(&stem.file);
            if !source.exists() {
                warnings.push(format!("{} is missing stem {}", song.title, stem.file));
                continue;
            }
            audio.push(ServiceAudioPlacement {
                song_id: song.id.clone(),
                instance_id: item.id.clone(),
                role: stem.role.clone(),
                track: if stem.track.trim().is_empty() {
                    default_track(&stem.role).into()
                } else {
                    stem.track.clone()
                },
                source_path: source.to_string_lossy().to_string(),
                collected_path: destination.to_string_lossy().to_string(),
                start_beat: placement.start_beat,
                clip_name: format!("LL|{}|{}", song.title, stem.role.to_uppercase()),
            });
        }
    }

    let template = root.join("Templates").join("Church Standard.als");
    let template_als = if template.exists() {
        let service_als = build_root.join(format!("{}.als", safe_component(&setlist.title)));
        fs::copy(&template, &service_als).map_err(|e| e.to_string())?;
        Some(service_als.to_string_lossy().to_string())
    } else {
        warnings.push(
            "No Templates/Church Standard.als exists yet. The service package was built, but no ALS template was copied."
                .into(),
        );
        None
    };

    let service_manifest = ServiceBuildManifest {
        schema_version: 1,
        service_id: setlist.id.clone(),
        title: setlist.title.clone(),
        build_id: build_id.clone(),
        arrangement,
        audio: audio.clone(),
        warnings: warnings.clone(),
    };
    let manifest_path = build_root.join("service.json");
    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&service_manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(ServiceBuildResult {
        root: root.to_string_lossy().to_string(),
        service_folder: build_root.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        template_als,
        audio,
        warnings,
    })
}
