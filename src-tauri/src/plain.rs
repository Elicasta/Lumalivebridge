use crate::arrangement::LiveContext;
use crate::models::{LibraryPayload, SectionInput, SongInput};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainStep {
    pub kind: String,
    pub summary: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainPlan {
    pub id: String,
    pub title: String,
    pub text: String,
    pub steps: Vec<PlainStep>,
    pub notes: Vec<String>,
}

fn step(kind: &str, summary: impl Into<String>, data: Value) -> PlainStep {
    PlainStep {
        kind: kind.into(),
        summary: summary.into(),
        data,
    }
}

fn exactish<'a, T, F>(items: &'a [T], needle: &str, name: F) -> Option<&'a T>
where
    F: Fn(&T) -> &str,
{
    let target = needle.trim().to_lowercase();
    items
        .iter()
        .find(|item| name(item).trim().to_lowercase() == target)
        .or_else(|| {
            items
                .iter()
                .find(|item| name(item).trim().to_lowercase().contains(&target))
        })
}

fn parse_section_specs(value: &str) -> Result<Vec<SectionInput>, String> {
    let mut sections = Vec::new();
    for raw in value.split(',') {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let Some((name, bar)) = raw.rsplit_once('@') else {
            return Err("For a new song, give section bars like Intro @ 1, Verse @ 9, Chorus @ 17".into());
        };
        let start_bar = bar
            .trim()
            .parse::<i64>()
            .map_err(|_| format!("Could not read the bar number in {raw}"))?;
        sections.push(SectionInput {
            id: None,
            name: name.trim().to_string(),
            start_bar,
        });
    }
    if sections.is_empty() {
        return Err("Add at least one section with a bar number".into());
    }
    Ok(sections)
}

pub fn plan(
    text: &str,
    library: &LibraryPayload,
    live_context: Option<&LiveContext>,
) -> Result<PlainPlan, String> {
    let input = text.trim();
    if input.is_empty() {
        return Err("Type a command first".into());
    }
    if input.len() > 4000 {
        return Err("Command is too long".into());
    }

    let mut steps = Vec::new();
    let mut notes = Vec::new();
    let lower = input.to_lowercase();

    let tempo = Regex::new(r"(?i)^set\s+(?:the\s+)?tempo\s+to\s+(\d+(?:\.\d+)?)\s*(?:bpm)?$").unwrap();
    if let Some(caps) = tempo.captures(input) {
        let bpm = caps[1].parse::<f64>().map_err(|_| "Invalid BPM".to_string())?;
        steps.push(step(
            "ableton",
            format!("Set Ableton tempo to {bpm} BPM"),
            json!({"command":{"type":"set_tempo","args":{"bpm":bpm}}}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Set tempo".into(), text: input.into(), steps, notes });
    }

    if matches!(lower.as_str(), "play" | "start" | "start playback" | "play arrangement") {
        steps.push(step("ableton", "Start Arrangement playback", json!({"command":{"type":"start_playback","args":{}}})));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Start playback".into(), text: input.into(), steps, notes });
    }

    if matches!(lower.as_str(), "stop" | "stop playback" | "stop arrangement") {
        steps.push(step("ableton", "Stop Arrangement playback", json!({"command":{"type":"stop_playback","args":{}}})));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Stop playback".into(), text: input.into(), steps, notes });
    }

    let click = Regex::new(r"(?i)^(?:turn\s+)?(?:the\s+)?(?:click|metronome)\s+(on|off)$").unwrap();
    if let Some(caps) = click.captures(input) {
        let enabled = caps[1].eq_ignore_ascii_case("on");
        steps.push(step(
            "ableton",
            if enabled { "Turn the click on" } else { "Turn the click off" },
            json!({"command":{"type":"set_metronome","args":{"enabled":enabled}}}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Click".into(), text: input.into(), steps, notes });
    }

    let volume = Regex::new(r"(?i)^set\s+(?:track\s+)?(.+?)\s+volume\s+to\s+(\d+(?:\.\d+)?)\s*%$").unwrap();
    if let Some(caps) = volume.captures(input) {
        let percent = caps[2].parse::<f64>().map_err(|_| "Invalid volume".to_string())?.clamp(0.0, 100.0);
        let track = caps[1].trim();
        steps.push(step(
            "ableton",
            format!("Set {track} volume to {percent}%"),
            json!({"command":{"type":"set_track_volume","args":{"track":{"name":track},"value":percent / 100.0}}}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Track volume".into(), text: input.into(), steps, notes });
    }

    let mute = Regex::new(r"(?i)^(mute|unmute|solo|unsolo)\s+(?:track\s+)?(.+)$").unwrap();
    if let Some(caps) = mute.captures(input) {
        let verb = caps[1].to_lowercase();
        let track = caps[2].trim();
        let (kind, value) = if verb == "mute" || verb == "unmute" {
            ("set_track_mute", verb == "mute")
        } else {
            ("set_track_solo", verb == "solo")
        };
        steps.push(step(
            "ableton",
            format!("{} {track}", caps[1].to_uppercase()),
            json!({"command":{"type":kind,"args":{"track":{"name":track},"value":value}}}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Track control".into(), text: input.into(), steps, notes });
    }

    let load = Regex::new(r"(?i)^(?:load|sync|open)\s+(?:setlist|service)?\s*(.+)$").unwrap();
    if let Some(caps) = load.captures(input) {
        let name = caps[1].trim();
        let setlist = exactish(&library.setlists, name, |item| item.title.as_str())
            .ok_or_else(|| format!("I could not find a setlist named {name}"))?;
        steps.push(step(
            "load_setlist",
            format!("Load {} into Ableton", setlist.title),
            json!({"setlistId":setlist.id}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Load service".into(), text: input.into(), steps, notes });
    }

    let add = Regex::new(r"(?i)^add\s+(.+?)\s+to\s+(.+?)(?:\s+after\s+(.+))?$").unwrap();
    if let Some(caps) = add.captures(input) {
        let song_name = caps[1].trim();
        let setlist_name = caps[2].trim();
        let song = exactish(&library.songs, song_name, |item| item.title.as_str())
            .ok_or_else(|| format!("I could not find a song named {song_name}"))?;
        let setlist = exactish(&library.setlists, setlist_name, |item| item.title.as_str())
            .ok_or_else(|| format!("I could not find a setlist named {setlist_name}"))?;
        let after_song_id = caps.get(3).and_then(|value| {
            exactish(&library.songs, value.as_str().trim(), |item| item.title.as_str())
                .map(|item| item.id.clone())
        });
        steps.push(step(
            "add_song_to_setlist",
            format!("Add {} to {}", song.title, setlist.title),
            json!({"songId":song.id,"setlistId":setlist.id,"afterSongId":after_song_id}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Edit setlist".into(), text: input.into(), steps, notes });
    }

    let create = Regex::new(r"(?i)^create\s+song\s+(.+?)\s+at\s+(\d+(?:\.\d+)?)\s*bpm(?:\s+in\s+([A-Ga-g][#b]?))?\s+with\s+(.+)$").unwrap();
    if let Some(caps) = create.captures(input) {
        let title = caps[1].trim();
        let bpm = caps[2].parse::<f64>().map_err(|_| "Invalid BPM".to_string())?;
        let key = caps.get(3).map(|value| value.as_str().to_string()).unwrap_or_default();
        let sections = parse_section_specs(caps[4].trim())?;
        let last_bar = sections.iter().map(|section| section.start_bar).max().unwrap_or(1);
        let song = SongInput {
            id: None,
            title: title.to_string(),
            artist: None,
            bpm,
            key: Some(key),
            meter: Default::default(),
            length_bars: last_bar + 8,
            sections,
        };
        steps.push(step(
            "create_song",
            format!("Create {title} at {bpm} BPM"),
            serde_json::to_value(song).map_err(|e| e.to_string())?,
        ));
        notes.push("The new song uses 4/4 unless you edit the meter afterward.".into());
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Create song".into(), text: input.into(), steps, notes });
    }

    let move_section = Regex::new(r"(?i)^(?:make|set|move)\s+(.+?)\s+(?:start\s+)?(?:at|to)\s+bar\s+(\d+)(?:\s+in\s+(.+))?$").unwrap();
    if let Some(caps) = move_section.captures(input) {
        let section_name = caps[1].trim();
        let start_bar = caps[2].parse::<i64>().map_err(|_| "Invalid bar".to_string())?;
        let song = if let Some(song_name) = caps.get(3) {
            exactish(&library.songs, song_name.as_str().trim(), |item| item.title.as_str())
        } else if let Some(ctx) = live_context {
            library.songs.iter().find(|song| song.id == ctx.song_id)
        } else {
            None
        }.ok_or_else(|| "Tell me which song the section belongs to, or load the song first.".to_string())?;
        let section = exactish(&song.sections, section_name, |item| item.name.as_str())
            .ok_or_else(|| format!("I could not find section {section_name} in {}", song.title))?;
        steps.push(step(
            "move_section",
            format!("Move {} / {} to bar {}", song.title, section.name, start_bar),
            json!({"songId":song.id,"sectionId":section.id,"startBar":start_bar}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Move section".into(), text: input.into(), steps, notes });
    }

    let jump = Regex::new(r"(?i)^(?:go|jump|take\s+me)\s+(?:to\s+)?(.+?)(?:\s+in\s+(.+))?$").unwrap();
    if let Some(caps) = jump.captures(input) {
        let section_name = caps[1].trim();
        let (song, instance_id) = if let Some(song_name) = caps.get(2) {
            (
                exactish(&library.songs, song_name.as_str().trim(), |item| item.title.as_str()),
                None,
            )
        } else if let Some(ctx) = live_context {
            (
                library.songs.iter().find(|song| song.id == ctx.song_id),
                Some(ctx.instance_id.clone()),
            )
        } else {
            (None, None)
        };
        let song = song.ok_or_else(|| "Load a service or name the song, for example: go to Chorus in Gratitude.".to_string())?;
        let section = exactish(&song.sections, section_name, |item| item.name.as_str())
            .ok_or_else(|| format!("I could not find section {section_name} in {}", song.title))?;
        steps.push(step(
            "jump_section",
            format!("Jump to {} / {}", song.title, section.name),
            json!({"songId":song.id,"instanceId":instance_id,"sectionId":section.id}),
        ));
        return Ok(PlainPlan { id: Uuid::new_v4().to_string(), title: "Jump section".into(), text: input.into(), steps, notes });
    }

    Err("I could not safely map that sentence yet. Try an explicit command such as “set tempo to 72”, “add Gratitude to Sunday AM”, “go to Chorus”, or “set Bridge to bar 65 in Gratitude”.".into())
}
