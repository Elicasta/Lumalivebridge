use crate::models::{Meter, Setlist, Song};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrangementSection {
    pub id: String,
    pub name: String,
    pub local_start_bar: i64,
    pub start_beat: f64,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrangementMarker {
    pub time: f64,
    pub name: String,
    pub kind: String,
    pub song_id: String,
    pub section_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdjacentSong {
    pub instance_id: String,
    pub song_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
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
    let mut cursor = 0.0f64;
    let mut placed_songs = Vec::new();
    let mut markers = Vec::new();

    for item in &setlist.items {
        let song = map
            .get(item.song_id.as_str())
            .copied()
            .ok_or_else(|| format!("Missing song \"{}\"", item.song_id))?;

        let denominator = song.meter.denominator.max(1) as f64;
        let beats_per_bar = song.meter.numerator.max(1) as f64 * (4.0 / denominator);
        let length_beats = song.length_bars as f64 * beats_per_bar;
        let mut sections = Vec::new();

        markers.push(ArrangementMarker {
            time: cursor,
            name: format!("LL|SONG|{}|{}", song.id, song.title),
            kind: "song".into(),
            song_id: song.id.clone(),
            section_id: None,
        });

        for section in &song.sections {
            let start_beat = cursor + ((section.start_bar - 1).max(0) as f64 * beats_per_bar);
            sections.push(ArrangementSection {
                id: section.id.clone(),
                name: section.name.clone(),
                local_start_bar: section.start_bar,
                start_beat,
            });
            markers.push(ArrangementMarker {
                time: start_beat,
                name: format!(
                    "LL|SECTION|{}|{}|{}",
                    song.id, section.id, section.name
                ),
                kind: "section".into(),
                song_id: song.id.clone(),
                section_id: Some(section.id.clone()),
            });
        }

        let end_beat = cursor + length_beats;
        placed_songs.push(ArrangementSong {
            instance_id: item.id.clone(),
            song_id: song.id.clone(),
            title: song.title.clone(),
            artist: song.artist.clone(),
            bpm: song.bpm,
            key: song.key.clone(),
            meter: song.meter.clone(),
            start_beat: cursor,
            end_beat,
            sections,
        });

        cursor = end_beat + (setlist.gap_bars.max(0) as f64 * beats_per_bar);
    }

    Ok(Arrangement {
        schema_version: 1,
        setlist_id: setlist.id.clone(),
        title: setlist.title.clone(),
        start_beat: 0.0,
        end_beat: cursor,
        songs: placed_songs,
        markers,
    })
}

pub fn locate_position(arrangement: &Arrangement, beat: f64) -> Option<LiveContext> {
    if !beat.is_finite() {
        return None;
    }

    let song_index = arrangement.songs.iter().enumerate().find_map(|(index, song)| {
        let next_start = arrangement.songs.get(index + 1).map(|next| next.start_beat);
        if beat >= song.start_beat && next_start.map(|next| beat < next).unwrap_or(true) {
            Some(index)
        } else {
            None
        }
    })?;

    let song = &arrangement.songs[song_index];
    let mut current_section: Option<&ArrangementSection> = None;
    let mut next_section: Option<&ArrangementSection> = None;

    for section in &song.sections {
        if beat >= section.start_beat {
            current_section = Some(section);
        } else {
            next_section = Some(section);
            break;
        }
    }

    let denominator = song.meter.denominator.max(1) as f64;
    let unit_beats = 4.0 / denominator;
    let beats_per_bar = song.meter.numerator.max(1) as f64 * unit_beats;
    let local_beat = (beat - song.start_beat).max(0.0);
    let current_bar = (local_beat / beats_per_bar).floor() as i64 + 1;
    let beat_in_bar = ((local_beat % beats_per_bar) / unit_beats).floor() as i64 + 1;
    let duration = (song.end_beat - song.start_beat).max(1.0);
    let progress = ((beat - song.start_beat) / duration).clamp(0.0, 1.0);

    let adjacent = |index: usize| -> AdjacentSong {
        let item = &arrangement.songs[index];
        AdjacentSong {
            instance_id: item.instance_id.clone(),
            song_id: item.song_id.clone(),
            title: item.title.clone(),
        }
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
        previous_song: if song_index > 0 {
            Some(adjacent(song_index - 1))
        } else {
            None
        },
        next_song: if song_index + 1 < arrangement.songs.len() {
            Some(adjacent(song_index + 1))
        } else {
            None
        },
        section_id: current_section.map(|section| section.id.clone()),
        section_name: current_section.map(|section| section.name.clone()),
        next_section_id: next_section.map(|section| section.id.clone()),
        next_section_name: next_section.map(|section| section.name.clone()),
    })
}

pub fn jump_target<'a>(
    arrangement: &'a Arrangement,
    song_id: Option<&str>,
    instance_id: Option<&str>,
    section_id: Option<&str>,
) -> Result<(f64, &'a ArrangementSong), String> {
    let song = arrangement
        .songs
        .iter()
        .find(|song| {
            if let Some(instance_id) = instance_id {
                return song.instance_id == instance_id;
            }
            song_id.map(|id| song.song_id == id).unwrap_or(false)
        })
        .ok_or_else(|| "Song is not in the active setlist".to_string())?;

    if let Some(section_id) = section_id {
        let section = song
            .sections
            .iter()
            .find(|section| section.id == section_id)
            .ok_or_else(|| "Section is not in that song".to_string())?;
        Ok((section.start_beat, song))
    } else {
        Ok((song.start_beat, song))
    }
}
