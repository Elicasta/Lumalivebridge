use crate::models::{Meter, Setlist, Song};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrangementMarker {
    pub time: f64,
    pub name: String,
    pub kind: String,
    pub song_id: String,
    pub section_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrangementSection {
    pub id: String,
    pub name: String,
    pub local_start_bar: i64,
    pub start_beat: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrangementSong {
    pub instance_id: String,
    pub song_id: String,
    pub title: String,
    pub artist: String,
    pub bpm: f64,
    pub key: String,
    pub meter: Meter,
    pub start_beat: f64,
    pub end_beat: f64,
    pub sections: Vec<ArrangementSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Arrangement {
    pub schema_version: i64,
    pub setlist_id: String,
    pub title: String,
    pub start_beat: f64,
    pub end_beat: f64,
    pub songs: Vec<ArrangementSong>,
    pub markers: Vec<ArrangementMarker>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdjacentSong {
    pub instance_id: String,
    pub song_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveContext {
    pub instance_id: String,
    pub song_id: String,
    pub song_title: String,
    pub song_index: usize,
    pub bpm: f64,
    pub key: String,
    pub meter: Meter,
    pub current_bar: i64,
    pub beat_in_bar: i64,
    pub progress: f64,
    pub previous_song: Option<AdjacentSong>,
    pub next_song: Option<AdjacentSong>,
    pub section_id: Option<String>,
    pub section_name: Option<String>,
    pub next_section_id: Option<String>,
    pub next_section_name: Option<String>,
}

pub fn build_arrangement(setlist: &Setlist, songs: &[Song]) -> Result<Arrangement, String> {
    let map: HashMap<&str, &Song> = songs.iter().map(|song| (song.id.as_str(), song)).collect();
    let mut cursor = 0.0;
    let mut placed = Vec::new();
    let mut markers = Vec::new();

    for item in &setlist.items {
        let song = map
            .get(item.song_id.as_str())
            .ok_or_else(|| format!("Song {} is missing from the library", item.song_id))?;
        let denominator = song.meter.denominator.max(1) as f64;
        let beats_per_bar = song.meter.numerator.max(1) as f64 * 4.0 / denominator;
        let start_beat = cursor;
        let end_beat = start_beat + song.length_bars.max(1) as f64 * beats_per_bar;

        markers.push(ArrangementMarker {
            time: start_beat,
            name: format!("LL|SONG|{}|{}", song.id, song.title),
            kind: "song".into(),
            song_id: song.id.clone(),
            section_id: None,
        });

        let sections = song
            .sections
            .iter()
            .map(|section| {
                let absolute = start_beat + (section.start_bar.max(1) - 1) as f64 * beats_per_bar;
                markers.push(ArrangementMarker {
                    time: absolute,
                    name: format!(
                        "LL|SECTION|{}|{}|{}",
                        song.id, section.id, section.name
                    ),
                    kind: "section".into(),
                    song_id: song.id.clone(),
                    section_id: Some(section.id.clone()),
                });
                ArrangementSection {
                    id: section.id.clone(),
                    name: section.name.clone(),
                    local_start_bar: section.start_bar,
                    start_beat: absolute,
                }
            })
            .collect();

        placed.push(ArrangementSong {
            instance_id: item.id.clone(),
            song_id: song.id.clone(),
            title: song.title.clone(),
            artist: song.artist.clone(),
            bpm: song.bpm,
            key: song.key.clone(),
            meter: song.meter.clone(),
            start_beat,
            end_beat,
            sections,
        });

        cursor = end_beat + setlist.gap_bars.max(0) as f64 * beats_per_bar;
    }

    Ok(Arrangement {
        schema_version: 1,
        setlist_id: setlist.id.clone(),
        title: setlist.title.clone(),
        start_beat: 0.0,
        end_beat: cursor,
        songs: placed,
        markers,
    })
}

pub fn locate_position(arrangement: &Arrangement, beat: f64) -> Option<LiveContext> {
    if !beat.is_finite() {
        return None;
    }

    let song_index = arrangement
        .songs
        .iter()
        .enumerate()
        .find(|(index, song)| {
            let next_start = arrangement
                .songs
                .get(index + 1)
                .map(|next| next.start_beat)
                .unwrap_or(f64::INFINITY);
            beat >= song.start_beat && beat < next_start
        })
        .map(|(index, _)| index)?;

    let song = &arrangement.songs[song_index];
    let mut current = None;
    let mut next = None;

    for section in &song.sections {
        if beat >= section.start_beat {
            current = Some(section);
        } else {
            next = Some(section);
            break;
        }
    }

    let denominator = song.meter.denominator.max(1) as f64;
    let beats_per_bar = song.meter.numerator.max(1) as f64 * 4.0 / denominator;
    let local_beat = (beat - song.start_beat).max(0.0);
    let current_bar = (local_beat / beats_per_bar).floor() as i64 + 1;
    let denominator_units_per_quarter = denominator / 4.0;
    let beat_in_bar =
        ((local_beat % beats_per_bar) * denominator_units_per_quarter).floor() as i64 + 1;
    let duration = (song.end_beat - song.start_beat).max(1.0);
    let progress = ((beat - song.start_beat) / duration).clamp(0.0, 1.0);

    let adjacent = |candidate: Option<&ArrangementSong>| {
        candidate.map(|value| AdjacentSong {
            instance_id: value.instance_id.clone(),
            song_id: value.song_id.clone(),
            title: value.title.clone(),
        })
    };

    Some(LiveContext {
        instance_id: song.instance_id.clone(),
        song_id: song.song_id.clone(),
        song_title: song.title.clone(),
        song_index,
        bpm: song.bpm,
        key: song.key.clone(),
        meter: song.meter.clone(),
        current_bar,
        beat_in_bar,
        progress,
        previous_song: adjacent(song_index.checked_sub(1).and_then(|index| arrangement.songs.get(index))),
        next_song: adjacent(arrangement.songs.get(song_index + 1)),
        section_id: current.map(|section| section.id.clone()),
        section_name: current.map(|section| section.name.clone()),
        next_section_id: next.map(|section| section.id.clone()),
        next_section_name: next.map(|section| section.name.clone()),
    })
}

pub fn jump_target<'a>(
    arrangement: &'a Arrangement,
    song_id: Option<&str>,
    instance_id: Option<&str>,
    section_id: Option<&str>,
) -> Result<(f64, &'a ArrangementSong, Option<&'a ArrangementSection>), String> {
    let song = arrangement
        .songs
        .iter()
        .find(|song| {
            instance_id
                .map(|id| song.instance_id == id)
                .unwrap_or_else(|| song_id.map(|id| song.song_id == id).unwrap_or(false))
        })
        .ok_or_else(|| "Song is not in the active setlist".to_string())?;

    if let Some(section_id) = section_id {
        let section = song
            .sections
            .iter()
            .find(|section| section.id == section_id)
            .ok_or_else(|| "Section is not in that song".to_string())?;
        Ok((section.start_beat, song, Some(section)))
    } else {
        Ok((song.start_beat, song, None))
    }
}
