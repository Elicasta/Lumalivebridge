use crate::models::{Meter, Setlist, Song, TransitionSpec};
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
pub struct ArrangementTransition {
    pub from_instance_id: String,
    pub to_instance_id: Option<String>,
    pub mode: String,
    pub bars: i64,
    pub trigger_beat: f64,
    pub next_start_beat: Option<f64>,
    pub vamp_section_id: Option<String>,
    pub vamp_start_beat: Option<f64>,
    pub vamp_end_beat: Option<f64>,
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
    pub transitions: Vec<ArrangementTransition>,
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

fn beats_per_bar(meter: &Meter) -> f64 {
    meter.numerator.max(1) as f64 * (4.0 / meter.denominator.max(1) as f64)
}

pub fn build_arrangement(setlist: &Setlist, songs: &[Song]) -> Result<Arrangement, String> {
    let map: HashMap<&str, &Song> = songs.iter().map(|song| (song.id.as_str(), song)).collect();
    let mut cursor = 0.0f64;
    let mut placed_songs = Vec::new();
    let mut markers = Vec::new();
    let mut transitions = Vec::new();

    for (item_index, item) in setlist.items.iter().enumerate() {
        let song = map
            .get(item.song_id.as_str())
            .copied()
            .ok_or_else(|| format!("Missing song \"{}\"", item.song_id))?;

        let song_beats_per_bar = beats_per_bar(&song.meter);
        let length_beats = song.length_bars as f64 * song_beats_per_bar;
        let song_start = cursor;
        let end_beat = song_start + length_beats;
        let mut sections = Vec::new();

        markers.push(ArrangementMarker {
            time: song_start,
            name: format!("LL|SONG|{}|{}", song.id, song.title),
            kind: "song".into(),
            song_id: song.id.clone(),
            section_id: None,
        });

        for section in &song.sections {
            let start_beat =
                song_start + ((section.start_bar - 1).max(0) as f64 * song_beats_per_bar);
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

        placed_songs.push(ArrangementSong {
            instance_id: item.id.clone(),
            song_id: song.id.clone(),
            title: song.title.clone(),
            artist: song.artist.clone(),
            bpm: song.bpm,
            key: song.key.clone(),
            meter: song.meter.clone(),
            start_beat: song_start,
            end_beat,
            sections: sections.clone(),
        });

        if let Some(next_item) = setlist.items.get(item_index + 1) {
            let next_song = map
                .get(next_item.song_id.as_str())
                .copied()
                .ok_or_else(|| format!("Missing song \"{}\"", next_item.song_id))?;

            let mode = item.transition.mode.as_str();
            let bars = item.transition.bars.max(0);
            let mut next_start = end_beat;
            let mut vamp_start = None;
            let mut vamp_end = None;

            match mode {
                "inherit" => {
                    next_start =
                        end_beat + setlist.gap_bars.max(0) as f64 * song_beats_per_bar;
                }
                "gap" => {
                    next_start = end_beat + bars as f64 * song_beats_per_bar;
                }
                "segue" | "hold" => {
                    next_start = end_beat;
                }
                "vamp" => {
                    let requested = item
                        .transition
                        .vamp_section_id
                        .as_deref()
                        .ok_or_else(|| format!("{} needs a vamp section", song.title))?;
                    let section_index = sections
                        .iter()
                        .position(|section| section.id == requested)
                        .ok_or_else(|| {
                            format!("Vamp section {} is missing from {}", requested, song.title)
                        })?;
                    vamp_start = Some(sections[section_index].start_beat);
                    vamp_end = Some(
                        sections
                            .get(section_index + 1)
                            .map(|section| section.start_beat)
                            .unwrap_or(end_beat),
                    );
                    if vamp_end.unwrap() <= vamp_start.unwrap() {
                        return Err(format!("Vamp section {} has no playable length", requested));
                    }
                    next_start = end_beat;
                }
                "mashup" => {
                    if (song.bpm - next_song.bpm).abs() > 0.01
                        || song.meter.numerator != next_song.meter.numerator
                        || song.meter.denominator != next_song.meter.denominator
                    {
                        return Err(format!(
                            "Mashup overlap from {} to {} requires matching BPM and meter. Warp or pre-render the transition first.",
                            song.title, next_song.title
                        ));
                    }

                    let overlap = bars as f64 * song_beats_per_bar;
                    if overlap >= length_beats {
                        return Err(format!("Mashup overlap is longer than {}", song.title));
                    }
                    next_start = end_beat - overlap;
                }
                other => return Err(format!("Unsupported transition mode: {other}")),
            }

            markers.push(ArrangementMarker {
                time: end_beat,
                name: format!(
                    "LL|TRANSITION|{}|{}|{}",
                    item.id, next_item.id, item.transition.mode
                ),
                kind: "transition".into(),
                song_id: song.id.clone(),
                section_id: None,
            });

            transitions.push(ArrangementTransition {
                from_instance_id: item.id.clone(),
                to_instance_id: Some(next_item.id.clone()),
                mode: item.transition.mode.clone(),
                bars,
                trigger_beat: end_beat,
                next_start_beat: Some(next_start),
                vamp_section_id: item.transition.vamp_section_id.clone(),
                vamp_start_beat: vamp_start,
                vamp_end_beat: vamp_end,
            });

            cursor = next_start;
        } else {
            cursor = end_beat;
            transitions.push(ArrangementTransition {
                from_instance_id: item.id.clone(),
                to_instance_id: None,
                mode: "end".into(),
                bars: 0,
                trigger_beat: end_beat,
                next_start_beat: None,
                vamp_section_id: None,
                vamp_start_beat: None,
                vamp_end_beat: None,
            });
        }
    }

    let arrangement_end = placed_songs
        .iter()
        .map(|song| song.end_beat)
        .fold(cursor, f64::max);

    Ok(Arrangement {
        schema_version: 2,
        setlist_id: setlist.id.clone(),
        title: setlist.title.clone(),
        start_beat: 0.0,
        end_beat: arrangement_end,
        songs: placed_songs,
        markers,
        transitions,
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

    let unit_beats = 4.0 / song.meter.denominator.max(1) as f64;
    let song_beats_per_bar = beats_per_bar(&song.meter);
    let local_beat = (beat - song.start_beat).max(0.0);
    let current_bar = (local_beat / song_beats_per_bar).floor() as i64 + 1;
    let beat_in_bar = ((local_beat % song_beats_per_bar) / unit_beats).floor() as i64 + 1;
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
        previous_song: (song_index > 0).then(|| adjacent(song_index - 1)),
        next_song: (song_index + 1 < arrangement.songs.len()).then(|| adjacent(song_index + 1)),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Section, SetlistItem};

    fn song(id: &str, title: &str, meter: Meter, length_bars: i64) -> Song {
        Song {
            id: id.into(),
            title: title.into(),
            artist: String::new(),
            bpm: 72.0,
            key: String::new(),
            meter,
            length_bars,
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
        }
    }

    fn item(id: &str, song_id: &str, transition: TransitionSpec) -> SetlistItem {
        SetlistItem {
            id: id.into(),
            song_id: song_id.into(),
            transition,
        }
    }

    #[test]
    fn six_eight_uses_three_quarter_note_beats_per_bar() {
        let songs = vec![song(
            "six-eight",
            "Six Eight",
            Meter {
                numerator: 6,
                denominator: 8,
            },
            8,
        )];
        let setlist = Setlist {
            id: "service".into(),
            title: "Service".into(),
            gap_bars: 0,
            items: vec![item("instance-a", "six-eight", TransitionSpec::default())],
            updated_at: 0,
        };

        let arrangement = build_arrangement(&setlist, &songs).unwrap();
        assert_eq!(arrangement.songs[0].end_beat, 24.0);
        assert_eq!(arrangement.songs[0].sections[1].start_beat, 12.0);

        let context = locate_position(&arrangement, 5.0).unwrap();
        assert_eq!(context.current_bar, 2);
        assert_eq!(context.beat_in_bar, 5);
    }

    #[test]
    fn repeated_song_instances_have_distinct_jump_targets() {
        let songs = vec![song(
            "same-song",
            "Same Song",
            Meter {
                numerator: 4,
                denominator: 4,
            },
            8,
        )];
        let setlist = Setlist {
            id: "service".into(),
            title: "Service".into(),
            gap_bars: 1,
            items: vec![
                item("first", "same-song", TransitionSpec::default()),
                item("second", "same-song", TransitionSpec::default()),
            ],
            updated_at: 0,
        };

        let arrangement = build_arrangement(&setlist, &songs).unwrap();
        let (first, _) =
            jump_target(&arrangement, Some("same-song"), Some("first"), Some("chorus")).unwrap();
        let (second, _) =
            jump_target(&arrangement, Some("same-song"), Some("second"), Some("chorus")).unwrap();
        assert_ne!(first, second);
        assert_eq!(first, 16.0);
        assert_eq!(second, 52.0);
    }

    #[test]
    fn segue_places_next_song_on_the_same_downbeat() {
        let songs = vec![
            song(
                "a",
                "A",
                Meter {
                    numerator: 4,
                    denominator: 4,
                },
                8,
            ),
            song(
                "b",
                "B",
                Meter {
                    numerator: 4,
                    denominator: 4,
                },
                8,
            ),
        ];
        let setlist = Setlist {
            id: "service".into(),
            title: "Service".into(),
            gap_bars: 4,
            items: vec![
                item(
                    "a1",
                    "a",
                    TransitionSpec {
                        mode: "segue".into(),
                        bars: 0,
                        vamp_section_id: None,
                    },
                ),
                item("b1", "b", TransitionSpec::default()),
            ],
            updated_at: 0,
        };

        let arrangement = build_arrangement(&setlist, &songs).unwrap();
        assert_eq!(
            arrangement.songs[0].end_beat,
            arrangement.songs[1].start_beat
        );
        assert_eq!(arrangement.transitions[0].mode, "segue");
    }

    #[test]
    fn mashup_overlap_requires_matching_tempo_and_meter() {
        let mut first = song(
            "a",
            "A",
            Meter {
                numerator: 4,
                denominator: 4,
            },
            8,
        );
        first.bpm = 72.0;
        let mut second = song(
            "b",
            "B",
            Meter {
                numerator: 4,
                denominator: 4,
            },
            8,
        );
        second.bpm = 80.0;

        let setlist = Setlist {
            id: "service".into(),
            title: "Service".into(),
            gap_bars: 0,
            items: vec![
                item(
                    "a1",
                    "a",
                    TransitionSpec {
                        mode: "mashup".into(),
                        bars: 2,
                        vamp_section_id: None,
                    },
                ),
                item("b1", "b", TransitionSpec::default()),
            ],
            updated_at: 0,
        };

        assert!(build_arrangement(&setlist, &[first, second]).is_err());
    }

    #[test]
    fn vamp_transition_exposes_loop_region() {
        let songs = vec![
            song(
                "a",
                "A",
                Meter {
                    numerator: 4,
                    denominator: 4,
                },
                8,
            ),
            song(
                "b",
                "B",
                Meter {
                    numerator: 4,
                    denominator: 4,
                },
                8,
            ),
        ];
        let setlist = Setlist {
            id: "service".into(),
            title: "Service".into(),
            gap_bars: 0,
            items: vec![
                item(
                    "a1",
                    "a",
                    TransitionSpec {
                        mode: "vamp".into(),
                        bars: 0,
                        vamp_section_id: Some("chorus".into()),
                    },
                ),
                item("b1", "b", TransitionSpec::default()),
            ],
            updated_at: 0,
        };

        let arrangement = build_arrangement(&setlist, &songs).unwrap();
        assert_eq!(arrangement.transitions[0].vamp_start_beat, Some(16.0));
        assert_eq!(arrangement.transitions[0].vamp_end_beat, Some(32.0));
    }
}
