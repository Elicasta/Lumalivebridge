use crate::arrangement::Arrangement;
use crate::models::{Setlist, Song};
use crate::reference_audio;
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
pub struct SongPackageStatus {
    pub song_id: String,
    pub package_path: String,
    pub source_als: Option<String>,
    pub project_attached: bool,
    pub stem_count: usize,
    pub cue_count: usize,
    pub warnings: Vec<String>,
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
    pub transpose_semitones: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCuePlacement {
    pub song_id: String,
    pub instance_id: String,
    pub kind: String,
    pub source_path: String,
    pub collected_path: String,
    pub beat: f64,
    pub section_id: Option<String>,
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
    pub cues: Vec<ServiceCuePlacement>,
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
    pub cues: Vec<ServiceCuePlacement>,
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

fn role_is_transposable(role: &str) -> bool {
    matches!(
        role.trim().to_lowercase().as_str(),
        "bass" | "keys" | "guitars" | "bgv" | "extra1" | "extra2" | "reference"
    )
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

fn collect_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn is_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "wav" | "aif" | "aiff" | "flac" | "mp3" | "m4a"
    )
}

fn scan_audio(package_dir: &Path) -> Result<Vec<StemAsset>, String> {
    let audio_dir = package_dir.join("Audio");
    let mut candidates = Vec::new();
    collect_files_recursive(&audio_dir, &mut candidates)?;

    let mut files = Vec::new();
    for path in candidates {
        if !is_audio_file(&path) {
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

fn scan_cues(package_dir: &Path) -> Result<Vec<CueAsset>, String> {
    let cues_dir = package_dir.join("Cues");
    if !cues_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&cues_dir).map_err(|e| e.to_string())? {
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
        if !["json", "mid", "midi"].contains(&extension.as_str()) {
            continue;
        }

        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("cue")
            .to_lowercase();
        let kind = if stem.contains("light") || stem.contains("dmx") {
            "lighting"
        } else if stem.contains("propresenter") || stem.contains("pro") {
            "propresenter"
        } else if stem.contains("mainstage") || stem.contains("main stage") {
            "mainstage"
        } else {
            "midi"
        };

        files.push(CueAsset {
            kind: kind.into(),
            file: path
                .strip_prefix(package_dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string(),
            section_id: None,
            beat_offset: 0.0,
        });
    }

    files.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.file.cmp(&b.file)));
    Ok(files)
}


fn detect_source_als(package_dir: &Path) -> Result<Option<String>, String> {
    let mut candidates = Vec::new();
    collect_files_recursive(package_dir, &mut candidates)?;
    candidates.retain(|path| {
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("als"))
            .unwrap_or(false)
            && !path
                .components()
                .any(|part| part.as_os_str().to_string_lossy().eq_ignore_ascii_case("Backup"))
    });
    candidates.sort_by_key(|path| {
        let preferred = path
            .components()
            .any(|part| part.as_os_str().to_string_lossy().eq_ignore_ascii_case("Project"));
        (!preferred, path.to_string_lossy().to_string())
    });
    Ok(candidates.first().map(|path| {
        path.strip_prefix(package_dir)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string()
    }))
}

pub fn ensure_song_package(root: &Path, song: &Song) -> Result<PathBuf, String> {
    ensure_layout(root)?;
    let package = song_package_dir(root, song);
    fs::create_dir_all(package.join("Project")).map_err(|e| e.to_string())?;
    fs::create_dir_all(package.join("Audio").join("Original")).map_err(|e| e.to_string())?;
    fs::create_dir_all(package.join("Cues")).map_err(|e| e.to_string())?;
    fs::create_dir_all(package.join("Exports")).map_err(|e| e.to_string())?;
    fs::create_dir_all(package.join("Reference").join("Original")).map_err(|e| e.to_string())?;

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
    manifest.source_als = detect_source_als(&package)?;
    manifest.stems = scan_audio(&package)?;
    manifest.cues = scan_cues(&package)?;

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
                "{}\n\nPut the song's Ableton Project folder inside Project/. Keep the normal Ableton Project Info/Backup folders intact.\nPut original stems in Audio/Original/. Luma scans recursively and auto-detects common names such as Click, Guide, Drums, Bass, Keys, Guitar, and BGV.\nPut song-specific lighting, ProPresenter, MainStage, or MIDI cue files in Cues/.\n\nThe song.json file is Luma Live's portable song manifest.\n",
                song.title
            ),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(package)
}

pub fn package_status(root: &Path, song: &Song) -> Result<SongPackageStatus, String> {
    let package = ensure_song_package(root, song)?;
    let manifest = load_manifest(&package, song)?;
    let mut warnings = Vec::new();
    if manifest.source_als.is_none() {
        warnings.push("No Ableton .als is attached yet".into());
    }
    if manifest.stems.is_empty() {
        warnings.push("No original stems detected yet".into());
    }

    Ok(SongPackageStatus {
        song_id: song.id.clone(),
        package_path: package.to_string_lossy().to_string(),
        source_als: manifest.source_als.clone(),
        project_attached: package.join("Project").read_dir().map(|mut it| it.next().is_some()).unwrap_or(false),
        stem_count: manifest.stems.len(),
        cue_count: manifest.cues.len(),
        warnings,
    })
}

pub fn adopt_project(root: &Path, song: &Song, source: &Path) -> Result<SongPackageStatus, String> {
    if !source.is_dir() {
        return Err("Choose the Ableton Project folder, not a file".into());
    }
    let package = ensure_song_package(root, song)?;
    let project_root = package.join("Project");
    fs::create_dir_all(&project_root).map_err(|e| e.to_string())?;

    let source_canonical = fs::canonicalize(source).map_err(|e| e.to_string())?;
    let project_canonical = fs::canonicalize(&project_root).map_err(|e| e.to_string())?;
    if source_canonical.starts_with(&project_canonical) {
        // The user already saved the Ableton Project inside the canonical Luma package.
        // Never delete/copy it onto itself.
        ensure_song_package(root, song)?;
        return package_status(root, song);
    }

    fs::remove_dir_all(&project_root).map_err(|e| e.to_string())?;
    fs::create_dir_all(&project_root).map_err(|e| e.to_string())?;
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Ableton Project");
    let destination = project_root.join(name);
    copy_tree(source, &destination)?;
    ensure_song_package(root, song)?;
    package_status(root, song)
}

pub fn import_stems(root: &Path, song: &Song, sources: &[PathBuf]) -> Result<SongPackageStatus, String> {
    let package = ensure_song_package(root, song)?;
    let destination = package.join("Audio").join("Original");
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;

    let mut imported = 0usize;
    for source in sources {
        if !source.is_file() || !is_audio_file(source) {
            continue;
        }
        let file_name = source
            .file_name()
            .ok_or_else(|| "Stem file is missing a file name".to_string())?;
        fs::copy(source, destination.join(file_name)).map_err(|e| e.to_string())?;
        imported += 1;
    }
    if imported == 0 {
        return Err("No supported audio files were selected".into());
    }

    ensure_song_package(root, song)?;
    package_status(root, song)
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
    if manifest.cues.is_empty() {
        manifest.cues = scan_cues(package)?;
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
    let mut cues = Vec::new();
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

        let reference_status = reference_audio::status(root, song)?;
        if manifest.stems.is_empty() && !reference_status.source_exists {
            warnings.push(format!(
                "{} has no detected stems or usable reference track yet.",
                song.title
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
                transpose_semitones: if role_is_transposable(&stem.role) {
                    item.transpose_semitones
                } else {
                    0
                },
            });
        }

        if manifest.stems.is_empty() && reference_status.source_exists {
            let source = reference_audio::source_path(root, song)?
                .ok_or_else(|| format!("{} reference audio is missing", song.title))?;
            let collected_reference_dir = collected.join("Reference").join("Original");
            let collected_path = if reference_status
                .source
                .as_ref()
                .map(|source| source.external)
                .unwrap_or(false)
            {
                reference_audio::copy_external_reference_into(root, song, &collected_reference_dir)?
                    .ok_or_else(|| format!("{} reference audio could not be collected", song.title))?
            } else {
                let relative = source
                    .strip_prefix(&package)
                    .map_err(|_| format!("{} reference audio is outside its package", song.title))?;
                collected.join(relative)
            };

            audio.push(ServiceAudioPlacement {
                song_id: song.id.clone(),
                instance_id: item.id.clone(),
                role: "reference".into(),
                track: "REFERENCE".into(),
                source_path: source.to_string_lossy().to_string(),
                collected_path: collected_path.to_string_lossy().to_string(),
                start_beat: placement.start_beat,
                clip_name: format!("LL|{}|REFERENCE", song.title),
                transpose_semitones: item.transpose_semitones,
            });
        }

        for cue in manifest.cues {
            let source = package.join(&cue.file);
            let destination = collected.join(&cue.file);
            if !source.exists() {
                warnings.push(format!("{} is missing cue file {}", song.title, cue.file));
                continue;
            }

            let base_beat = if let Some(section_id) = cue.section_id.as_deref() {
                placement
                    .sections
                    .iter()
                    .find(|section| section.id == section_id)
                    .map(|section| section.start_beat)
                    .ok_or_else(|| {
                        format!(
                            "{} cue {} references missing section {}",
                            song.title, cue.file, section_id
                        )
                    })?
            } else {
                placement.start_beat
            };

            cues.push(ServiceCuePlacement {
                song_id: song.id.clone(),
                instance_id: item.id.clone(),
                kind: cue.kind.clone(),
                source_path: source.to_string_lossy().to_string(),
                collected_path: destination.to_string_lossy().to_string(),
                beat: base_beat + cue.beat_offset.max(0.0),
                section_id: cue.section_id.clone(),
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
        cues: cues.clone(),
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
        cues,
        warnings,
    })
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::arrangement::build_arrangement;
    use crate::models::{
        Meter, Section, Setlist, SetlistItem, Song, TransitionSpec,
    };
    use uuid::Uuid;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("luma-live-service-builder-{}", Uuid::new_v4()))
    }

    #[test]
    fn builds_collected_song_audio_and_cues() {
        let root = temp_root();
        ensure_layout(&root).unwrap();

        let song = Song {
            id: "song-a".into(),
            title: "Song A".into(),
            artist: "Test".into(),
            bpm: 72.0,
            key: "C".into(),
            meter: Meter {
                numerator: 4,
                denominator: 4,
            },
            length_bars: 8,
            sections: vec![
                Section {
                    id: "intro".into(),
                    name: "Intro".into(),
                    start_bar: 1,
                },
                Section {
                    id: "chorus".into(),
                    name: "Chorus".into(),
                    start_bar: 5,
                },
            ],
            updated_at: 0,
        };

        let package = ensure_song_package(&root, &song).unwrap();
        fs::write(package.join("Audio").join("Click.wav"), b"fake-wave").unwrap();
        fs::write(
            package.join("Cues").join("lighting.json"),
            br#"{"schemaVersion":1,"events":[]}"#,
        )
        .unwrap();

        let setlist = Setlist {
            id: "service-a".into(),
            title: "Sunday AM".into(),
            gap_bars: 0,
            items: vec![SetlistItem {
                id: "instance-a".into(),
                song_id: song.id.clone(),
                transition: TransitionSpec::default(),
                transpose_semitones: 0,
            }],
            updated_at: 0,
        };

        let arrangement = build_arrangement(&setlist, &[song.clone()]).unwrap();
        let result =
            build_service_folder(&root, &setlist, &[song], arrangement).unwrap();

        assert_eq!(result.audio.len(), 1);
        assert_eq!(result.audio[0].track, "CLICK");
        assert_eq!(result.cues.len(), 1);
        assert_eq!(result.cues[0].kind, "lighting");
        assert!(Path::new(&result.audio[0].collected_path).exists());
        assert!(Path::new(&result.cues[0].collected_path).exists());
        assert!(Path::new(&result.manifest_path).exists());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn detects_nested_original_stems_and_project_als() {
        let root = temp_root();
        let song = Song {
            id: "nested-song".into(),
            title: "Nested Song".into(),
            artist: String::new(),
            bpm: 78.0,
            key: "F".into(),
            meter: Meter { numerator: 4, denominator: 4 },
            length_bars: 16,
            sections: vec![Section { id: "intro".into(), name: "Intro".into(), start_bar: 1 }],
            updated_at: 0,
        };

        let package = ensure_song_package(&root, &song).unwrap();
        let project = package.join("Project").join("Nested Song Project");
        std::fs::create_dir_all(project.join("Ableton Project Info")).unwrap();
        std::fs::write(project.join("Nested Song.als"), b"als").unwrap();
        let original = package.join("Audio").join("Original");
        std::fs::create_dir_all(&original).unwrap();
        std::fs::write(original.join("Drums.wav"), b"audio").unwrap();
        std::fs::write(original.join("Bass.wav"), b"audio").unwrap();

        let status = package_status(&root, &song).unwrap();
        assert!(status.project_attached);
        assert!(status.source_als.as_deref().unwrap().ends_with("Nested Song.als"));
        assert_eq!(status.stem_count, 2);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn transposable_stems_receive_service_key_shift() {
        let root = temp_root();
        ensure_layout(&root).unwrap();
        let song = Song {
            id: "shift-song".into(),
            title: "Shift Song".into(),
            artist: String::new(),
            bpm: 80.0,
            key: "E".into(),
            meter: Meter { numerator: 4, denominator: 4 },
            length_bars: 8,
            sections: vec![Section { id: "intro".into(), name: "Intro".into(), start_bar: 1 }],
            updated_at: 0,
        };
        let package = ensure_song_package(&root, &song).unwrap();
        let audio = package.join("Audio").join("Original");
        std::fs::write(audio.join("Bass.wav"), b"audio").unwrap();
        std::fs::write(audio.join("Click.wav"), b"audio").unwrap();

        let setlist = Setlist {
            id: "service".into(),
            title: "Sunday".into(),
            gap_bars: 0,
            items: vec![SetlistItem {
                id: "instance".into(),
                song_id: song.id.clone(),
                transition: TransitionSpec::default(),
                transpose_semitones: 2,
            }],
            updated_at: 0,
        };
        let arrangement = build_arrangement(&setlist, &[song.clone()]).unwrap();
        let result = build_service_folder(&root, &setlist, &[song], arrangement).unwrap();
        let bass = result.audio.iter().find(|item| item.role == "bass").unwrap();
        let click = result.audio.iter().find(|item| item.role == "click").unwrap();
        assert_eq!(bass.transpose_semitones, 2);
        assert_eq!(click.transpose_semitones, 0);

        let _ = std::fs::remove_dir_all(root);
    }

}
