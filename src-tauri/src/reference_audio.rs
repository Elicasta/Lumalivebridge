use crate::models::Song;
use crate::service_builder::song_package_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSource {
    pub path: String,
    pub source_kind: String,
    pub external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpMarker {
    pub sample_time: f64,
    pub beat_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceAlignment {
    pub bpm: f64,
    pub numerator: i64,
    pub denominator: i64,
    pub first_downbeat_seconds: f64,
    #[serde(default)]
    pub markers: Vec<WarpMarker>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceState {
    pub source: Option<ReferenceSource>,
    pub alignment: Option<ReferenceAlignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceAnalysis {
    pub source_path: String,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u16,
    pub peaks: Vec<f32>,
    pub detected_bpm: Option<f64>,
    pub suggested_first_downbeat_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceStatus {
    pub song_id: String,
    pub package_path: String,
    pub source: Option<ReferenceSource>,
    pub source_exists: bool,
    pub alignment: Option<ReferenceAlignment>,
    pub analysis: Option<ReferenceAnalysis>,
    pub warnings: Vec<String>,
}

fn reference_dir(root: &Path, song: &Song) -> PathBuf {
    song_package_dir(root, song).join("Reference")
}

fn state_path(root: &Path, song: &Song) -> PathBuf {
    reference_dir(root, song).join("reference.json")
}

fn analysis_path(root: &Path, song: &Song) -> PathBuf {
    reference_dir(root, song).join("analysis.json")
}

fn ensure_reference_dir(root: &Path, song: &Song) -> Result<PathBuf, String> {
    let dir = reference_dir(root, song);
    fs::create_dir_all(dir.join("Original")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_state(root: &Path, song: &Song) -> Result<ReferenceState, String> {
    let path = state_path(root, song);
    if !path.exists() {
        return Ok(ReferenceState::default());
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn write_state(root: &Path, song: &Song, state: &ReferenceState) -> Result<(), String> {
    ensure_reference_dir(root, song)?;
    fs::write(
        state_path(root, song),
        serde_json::to_string_pretty(state).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn is_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase()
            .as_str(),
        "wav" | "wave" | "aif" | "aiff" | "flac" | "mp3" | "m4a" | "aac"
    )
}

pub fn source_path(root: &Path, song: &Song) -> Result<Option<PathBuf>, String> {
    let state = read_state(root, song)?;
    let Some(source) = state.source else {
        return Ok(None);
    };
    let path = if source.external {
        PathBuf::from(source.path)
    } else {
        song_package_dir(root, song).join(source.path)
    };
    Ok(Some(path))
}

fn invalidate_analysis(root: &Path, song: &Song) {
    let _ = fs::remove_file(analysis_path(root, song));
}

pub fn attach_external(
    root: &Path,
    song: &Song,
    path: &Path,
    source_kind: &str,
) -> Result<ReferenceStatus, String> {
    if !path.is_file() || !is_audio_file(path) {
        return Err("Choose a supported audio file (WAV, AIFF, FLAC, MP3, M4A, or AAC)".into());
    }
    ensure_reference_dir(root, song)?;
    let mut state = read_state(root, song)?;
    state.source = Some(ReferenceSource {
        path: path.to_string_lossy().to_string(),
        source_kind: source_kind.to_string(),
        external: true,
    });
    state.alignment = None;
    write_state(root, song, &state)?;
    invalidate_analysis(root, song);
    status(root, song)
}

pub fn import_file(root: &Path, song: &Song, source: &Path) -> Result<ReferenceStatus, String> {
    if !source.is_file() || !is_audio_file(source) {
        return Err("Choose a supported audio file (WAV, AIFF, FLAC, MP3, M4A, or AAC)".into());
    }
    let dir = ensure_reference_dir(root, song)?;
    let name = source
        .file_name()
        .ok_or_else(|| "Reference track is missing a file name".to_string())?;
    let destination = dir.join("Original").join(name);
    fs::copy(source, &destination).map_err(|e| e.to_string())?;

    let relative = destination
        .strip_prefix(song_package_dir(root, song))
        .unwrap_or(&destination)
        .to_string_lossy()
        .to_string();

    let mut state = read_state(root, song)?;
    state.source = Some(ReferenceSource {
        path: relative,
        source_kind: "imported".into(),
        external: false,
    });
    state.alignment = None;
    write_state(root, song, &state)?;
    invalidate_analysis(root, song);
    status(root, song)
}

pub fn save_alignment(
    root: &Path,
    song: &Song,
    mut alignment: ReferenceAlignment,
) -> Result<ReferenceStatus, String> {
    if !alignment.bpm.is_finite() || alignment.bpm < 20.0 || alignment.bpm > 999.0 {
        return Err("Alignment BPM must be between 20 and 999".into());
    }
    if alignment.numerator < 1 || alignment.numerator > 32 {
        return Err("Meter numerator must be 1-32".into());
    }
    if alignment.denominator < 1 || alignment.denominator > 32 {
        return Err("Meter denominator must be 1-32".into());
    }
    if !alignment.first_downbeat_seconds.is_finite() || alignment.first_downbeat_seconds < 0.0 {
        return Err("First downbeat must be a non-negative time".into());
    }

    alignment.markers.retain(|marker| {
        marker.sample_time.is_finite()
            && marker.beat_time.is_finite()
            && marker.sample_time >= 0.0
    });
    alignment
        .markers
        .sort_by(|a, b| a.sample_time.total_cmp(&b.sample_time));

    let mut state = read_state(root, song)?;
    if state.source.is_none() {
        return Err("Attach or import a reference track first".into());
    }
    state.alignment = Some(alignment);
    write_state(root, song, &state)?;
    status(root, song)
}

fn read_analysis(root: &Path, song: &Song) -> Option<ReferenceAnalysis> {
    let path = analysis_path(root, song);
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn status(root: &Path, song: &Song) -> Result<ReferenceStatus, String> {
    ensure_reference_dir(root, song)?;
    let state = read_state(root, song)?;
    let resolved = source_path(root, song)?;
    let source_exists = resolved.as_ref().map(|path| path.is_file()).unwrap_or(false);
    let mut warnings = Vec::new();
    if state.source.is_none() {
        warnings.push("No rehearsal/reference track attached".into());
    } else if !source_exists {
        warnings.push("The linked reference audio file is missing".into());
    }
    if state.source.is_some() && state.alignment.is_none() {
        warnings.push("Reference track has not been aligned to the musical grid yet".into());
    }

    Ok(ReferenceStatus {
        song_id: song.id.clone(),
        package_path: song_package_dir(root, song).to_string_lossy().to_string(),
        source: state.source,
        source_exists,
        alignment: state.alignment,
        analysis: read_analysis(root, song),
        warnings,
    })
}

#[cfg(target_os = "macos")]
fn prepare_analysis_wav(source: &Path, target: &Path) -> Result<PathBuf, String> {
    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "wav" || ext == "wave" {
        return Ok(source.to_path_buf());
    }

    let _ = fs::remove_file(target);
    let output = std::process::Command::new("afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@22050", "-c", "1"])
        .arg(source)
        .arg(target)
        .output()
        .map_err(|e| format!("Could not launch macOS audio converter: {e}"))?;
    if !output.status.success() || !target.exists() {
        return Err(format!(
            "macOS could not decode this audio file for waveform analysis: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(target.to_path_buf())
}

#[cfg(not(target_os = "macos"))]
fn prepare_analysis_wav(source: &Path, _target: &Path) -> Result<PathBuf, String> {
    let ext = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "wav" || ext == "wave" {
        Ok(source.to_path_buf())
    } else {
        Err("Reference analysis currently needs WAV on non-macOS systems".into())
    }
}

fn read_wav_mono(path: &Path) -> Result<(Vec<f32>, u32, u16), String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    let channels = spec.channels.max(1);
    let mut interleaved = Vec::<f32>::new();

    match spec.sample_format {
        hound::SampleFormat::Float => {
            for sample in reader.samples::<f32>() {
                interleaved.push(sample.map_err(|e| e.to_string())?.clamp(-1.0, 1.0));
            }
        }
        hound::SampleFormat::Int => {
            if spec.bits_per_sample <= 16 {
                let scale = i16::MAX as f32;
                for sample in reader.samples::<i16>() {
                    interleaved.push(sample.map_err(|e| e.to_string())? as f32 / scale);
                }
            } else {
                let scale = ((1_i64 << (spec.bits_per_sample.saturating_sub(1) as u32)) - 1) as f32;
                for sample in reader.samples::<i32>() {
                    interleaved.push(sample.map_err(|e| e.to_string())? as f32 / scale.max(1.0));
                }
            }
        }
    }

    let channel_count = channels as usize;
    let mut mono = Vec::with_capacity(interleaved.len() / channel_count.max(1));
    for frame in interleaved.chunks(channel_count) {
        let sum: f32 = frame.iter().copied().sum();
        mono.push(sum / frame.len().max(1) as f32);
    }
    Ok((mono, spec.sample_rate, channels))
}

fn waveform_peaks(samples: &[f32], buckets: usize) -> Vec<f32> {
    if samples.is_empty() || buckets == 0 {
        return Vec::new();
    }
    let bucket_size = ((samples.len() as f64 / buckets as f64).ceil() as usize).max(1);
    let mut out = Vec::with_capacity(buckets);
    for chunk in samples.chunks(bucket_size).take(buckets) {
        let peak = chunk
            .iter()
            .fold(0.0_f32, |acc, value| acc.max(value.abs()))
            .clamp(0.0, 1.0);
        out.push(peak);
    }
    out
}

fn onset_envelope(samples: &[f32], sample_rate: u32) -> (Vec<f64>, f64) {
    if samples.len() < 4096 || sample_rate == 0 {
        return (Vec::new(), 0.0);
    }
    let hop = ((sample_rate as f64 / 86.0).round() as usize).clamp(256, 2048);
    let mut energy = Vec::new();
    let mut index = 0usize;
    while index + hop <= samples.len() {
        let chunk = &samples[index..index + hop];
        let value = chunk.iter().map(|sample| sample.abs() as f64).sum::<f64>() / hop as f64;
        energy.push(value);
        index += hop;
    }
    let mut onset = Vec::with_capacity(energy.len());
    let mut previous = energy.first().copied().unwrap_or(0.0);
    for value in energy {
        onset.push((value - previous).max(0.0));
        previous = value;
    }
    (onset, sample_rate as f64 / hop as f64)
}

fn estimate_tempo(samples: &[f32], sample_rate: u32) -> Option<f64> {
    let (onset, frames_per_second) = onset_envelope(samples, sample_rate);
    if onset.len() < 32 || frames_per_second <= 0.0 {
        return None;
    }

    let mean = onset.iter().sum::<f64>() / onset.len() as f64;
    let centered: Vec<f64> = onset.iter().map(|value| (value - mean).max(0.0)).collect();
    let min_bpm = 50.0;
    let max_bpm = 210.0;
    let min_lag = ((60.0 * frames_per_second / max_bpm).floor() as usize).max(1);
    let max_lag = ((60.0 * frames_per_second / min_bpm).ceil() as usize)
        .min(centered.len().saturating_sub(2));
    if min_lag >= max_lag {
        return None;
    }

    let mut best_lag = min_lag;
    let mut best_score = f64::MIN;
    for lag in min_lag..=max_lag {
        let mut score = 0.0;
        for i in lag..centered.len() {
            score += centered[i] * centered[i - lag];
        }
        if score > best_score {
            best_score = score;
            best_lag = lag;
        }
    }

    if !best_score.is_finite() || best_score <= 0.0 {
        return None;
    }
    let mut bpm = 60.0 * frames_per_second / best_lag as f64;
    while bpm < 65.0 {
        bpm *= 2.0;
    }
    while bpm > 180.0 {
        bpm /= 2.0;
    }
    Some((bpm * 10.0).round() / 10.0)
}

fn estimate_first_downbeat(samples: &[f32], sample_rate: u32) -> Option<f64> {
    let (onset, frames_per_second) = onset_envelope(samples, sample_rate);
    if onset.len() < 8 || frames_per_second <= 0.0 {
        return None;
    }
    let search_len = ((frames_per_second * 30.0) as usize).min(onset.len());
    let search = &onset[..search_len];
    let mean = search.iter().sum::<f64>() / search.len().max(1) as f64;
    let variance = search
        .iter()
        .map(|value| {
            let delta = value - mean;
            delta * delta
        })
        .sum::<f64>()
        / search.len().max(1) as f64;
    let threshold = mean + variance.sqrt() * 1.6;
    let skip = (frames_per_second * 0.15) as usize;

    search
        .iter()
        .enumerate()
        .skip(skip)
        .find(|(_, value)| **value >= threshold)
        .map(|(index, _)| index as f64 / frames_per_second)
}

pub fn analyze(root: &Path, song: &Song) -> Result<ReferenceAnalysis, String> {
    let source = source_path(root, song)?
        .ok_or_else(|| "Attach or import a reference track first".to_string())?;
    if !source.exists() {
        return Err("The linked reference audio file no longer exists".into());
    }

    let dir = ensure_reference_dir(root, song)?;
    let analysis_wav = dir.join(".analysis.wav");
    let prepared = prepare_analysis_wav(&source, &analysis_wav)?;
    let (samples, sample_rate, channels) = read_wav_mono(&prepared)?;
    let duration_seconds = samples.len() as f64 / sample_rate.max(1) as f64;
    let analysis = ReferenceAnalysis {
        source_path: source.to_string_lossy().to_string(),
        duration_seconds,
        sample_rate,
        channels,
        peaks: waveform_peaks(&samples, 1600),
        detected_bpm: estimate_tempo(&samples, sample_rate),
        suggested_first_downbeat_seconds: estimate_first_downbeat(&samples, sample_rate),
    };

    fs::write(
        analysis_path(root, song),
        serde_json::to_string(&analysis).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(analysis)
}

pub fn copy_external_reference_into(
    root: &Path,
    song: &Song,
    destination_dir: &Path,
) -> Result<Option<PathBuf>, String> {
    let state = read_state(root, song)?;
    let Some(source) = state.source else {
        return Ok(None);
    };
    if !source.external {
        return Ok(None);
    }
    let source_path = PathBuf::from(&source.path);
    if !source_path.exists() {
        return Err(format!("{} reference audio is missing", song.title));
    }
    fs::create_dir_all(destination_dir).map_err(|e| e.to_string())?;
    let file_name = source_path
        .file_name()
        .ok_or_else(|| "Reference audio file has no file name".to_string())?;
    let destination = destination_dir.join(file_name);
    fs::copy(&source_path, &destination).map_err(|e| e.to_string())?;
    Ok(Some(destination))
}
