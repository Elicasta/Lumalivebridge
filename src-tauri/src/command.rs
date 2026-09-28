use crate::arrangement::{build_arrangement, jump_target, locate_position, Arrangement};
use crate::bridge;
use crate::models::{Meter, SectionInput, SetlistInput, SetlistItemInput, SongInput};
use crate::state::AppState;
use regex::Regex;
use serde_json::{json, Value};

fn normalized(value: &str) -> String {
    value.trim().to_lowercase()
}

fn parse_section_specs(value: &str) -> Result<(Vec<SectionInput>, i64), String> {
    let splitter = Regex::new(r"(?i)\s*,\s*|\s+and\s+").unwrap();
    let repeat_re = Regex::new(r"(?i)\s+(?:x|×)\s*(\d+)\s*$").unwrap();
    let bars_re = Regex::new(r"(?i)\s+(\d+)\s+bars?\s*$").unwrap();

    let mut cursor = 1i64;
    let mut sections = Vec::new();

    for raw in splitter.split(value.trim().trim_end_matches('.')) {
        let mut working = raw.trim().to_string();
        if working.is_empty() {
            continue;
        }

        let mut repeat = 1i64;
        let mut bars = 8i64;

        // Accept either "Bridge x2 8 bars" or "Bridge 8 bars x2".
        // Peel recognized suffixes until only the section name remains.
        loop {
            if let Some(caps) = repeat_re.captures(&working) {
                repeat = caps[1].parse::<i64>().unwrap_or(1).clamp(1, 16);
                if let Some(full) = caps.get(0) {
                    working.truncate(full.start());
                    working = working.trim().to_string();
                    continue;
                }
            }

            if let Some(caps) = bars_re.captures(&working) {
                bars = caps[1].parse::<i64>().unwrap_or(8).clamp(1, 512);
                if let Some(full) = caps.get(0) {
                    working.truncate(full.start());
                    working = working.trim().to_string();
                    continue;
                }
            }

            break;
        }

        if working.is_empty() {
            return Err("Every section needs a name".into());
        }

        for index in 0..repeat {
            let name = if repeat > 1 {
                format!("{} {}", working, index + 1)
            } else {
                working.clone()
            };
            sections.push(SectionInput {
                id: None,
                name,
                start_bar: cursor,
            });
            cursor += bars;
        }
    }

    if sections.is_empty() {
        return Err("Add at least one section".into());
    }

    Ok((sections, (cursor - 1).max(1)))
}

fn active_arrangement(state: &AppState) -> Result<Option<Arrangement>, String> {
    let Some(id) = state.db.get_active_setlist_id()? else {
        return Ok(None);
    };
    let Some(setlist) = state.db.get_setlist(&id)? else {
        return Ok(None);
    };
    let songs = state.db.list_songs()?;
    build_arrangement(&setlist, &songs).map(Some)
}

async fn live_context(state: &AppState) -> Result<(Arrangement, crate::arrangement::LiveContext), String> {
    let arrangement = active_arrangement(state)?
        .ok_or_else(|| "No active setlist is synced".to_string())?;
    let live = bridge::state().await?;
    let beat = live
        .get("currentSongTime")
        .and_then(Value::as_f64)
        .ok_or_else(|| "Ableton did not report a song position".to_string())?;
    let context = locate_position(&arrangement, beat)
        .ok_or_else(|| "Ableton playhead is not inside an active song".to_string())?;
    Ok((arrangement, context))
}

async fn jump(state: &AppState, arrangement: &Arrangement, instance_id: &str, section_id: Option<&str>) -> Result<Value, String> {
    let (time, song) = jump_target(arrangement, None, Some(instance_id), section_id)?;
    bridge::send("set_tempo", json!({ "bpm": song.bpm })).await?;
    bridge::send(
        "set_meter",
        json!({
            "numerator": song.meter.numerator,
            "denominator": song.meter.denominator
        }),
    )
    .await?;
    bridge::send("jump_to_time", json!({ "time": time })).await?;
    Ok(json!({
        "summary": if let Some(section_id) = section_id {
            let section = song.sections.iter().find(|item| item.id == section_id);
            format!("Jumped to {} · {}", song.title, section.map(|item| item.name.as_str()).unwrap_or(section_id))
        } else {
            format!("Jumped to {}", song.title)
        }
    }))
}

async fn sync_setlist(state: &AppState, setlist_id: &str) -> Result<Value, String> {
    let setlist = state
        .db
        .get_setlist(setlist_id)?
        .ok_or_else(|| "Setlist not found".to_string())?;
    let songs = state.db.list_songs()?;
    let arrangement = build_arrangement(&setlist, &songs)?;
    let points: Vec<Value> = arrangement
        .markers
        .iter()
        .map(|marker| json!({ "time": marker.time, "name": marker.name }))
        .collect();

    bridge::send(
        "sync_cue_points",
        json!({ "replace": true, "points": points }),
    )
    .await?;
    state.db.set_active_setlist_id(Some(&setlist.id))?;
    Ok(json!({
        "summary": format!("Loaded {} into Ableton", setlist.title),
        "activeSetlistId": setlist.id
    }))
}

pub async fn execute(state: &AppState, text: &str) -> Result<Value, String> {
    let raw = text.trim();
    if raw.is_empty() {
        return Err("Type a command first".into());
    }
    let lower = normalized(raw);

    let song_build_re = Regex::new(
        r"(?i)^create\s+(?:a\s+)?(?:worship\s+|praise\s+|church\s+)?song\s+(?:called|named)\s+(.+?)\s+at\s+(\d+(?:\.\d+)?)\s*bpm(?:\s+(?:in|at)\s+(\d+)\s*/\s*(\d+))?\s+with\s+(.+)$"
    ).unwrap();
    if let Some(caps) = song_build_re.captures(raw) {
        let title = caps[1].trim().to_string();
        let bpm: f64 = caps[2].parse().map_err(|_| "Invalid BPM".to_string())?;
        if !(20.0..=999.0).contains(&bpm) {
            return Err("Tempo must be between 20 and 999 BPM".into());
        }
        let meter = if caps.get(3).is_some() && caps.get(4).is_some() {
            Meter {
                numerator: caps[3].parse().map_err(|_| "Invalid meter".to_string())?,
                denominator: caps[4].parse().map_err(|_| "Invalid meter".to_string())?,
            }
        } else {
            Meter::default()
        };
        let (sections, length_bars) = parse_section_specs(&caps[5])?;
        let song = state.db.save_song(SongInput {
            id: None,
            title: title.clone(),
            artist: None,
            bpm,
            key: None,
            meter,
            length_bars,
            sections,
        })?;
        return Ok(json!({
            "summary": format!("Saved {} with {} sections to the Luma library", song.title, song.sections.len())
        }));
    }

    if lower.contains("create") && lower.contains("session") {
        let bpm_re = Regex::new(r"(?i)(?:at|tempo|bpm(?:\s+to)?)\s*(\d+(?:\.\d+)?)\s*bpm?").unwrap();
        if let Some(caps) = bpm_re.captures(raw) {
            let bpm: f64 = caps[1].parse().map_err(|_| "Invalid BPM".to_string())?;
            bridge::send("set_tempo", json!({ "bpm": bpm })).await?;
        }

        let tracks = [
            ("audio", "CLICK"),
            ("audio", "GUIDE"),
            ("audio", "LOOPS"),
            ("audio", "DRUMS"),
            ("audio", "BASS"),
            ("audio", "KEYS"),
            ("audio", "GUITARS"),
            ("audio", "BGV"),
            ("audio", "TRACKS"),
            ("midi", "MAINSTAGE"),
            ("midi", "PROPRESENTER"),
            ("midi", "LUMARIG"),
        ];
        for (kind, name) in tracks {
            bridge::send("create_track", json!({ "kind": kind, "name": name, "index": -1 })).await?;
        }
        return Ok(json!({ "summary": "Built the standard Luma church track layout in Ableton" }));
    }

    let meter_re = Regex::new(r"(?i)^(?:set\s+)?(?:meter|time\s+signature)(?:\s+to)?\s+(\d+)\s*/\s*(\d+)$").unwrap();
    if let Some(caps) = meter_re.captures(raw) {
        let numerator: i64 = caps[1].parse().map_err(|_| "Invalid meter".to_string())?;
        let denominator: i64 = caps[2].parse().map_err(|_| "Invalid meter".to_string())?;
        bridge::send("set_meter", json!({ "numerator": numerator, "denominator": denominator })).await?;
        return Ok(json!({ "summary": format!("Meter set to {}/{}", numerator, denominator) }));
    }

    let volume_re = Regex::new(r"(?i)^set\s+(?:track\s+)?(.+?)\s+volume\s+to\s+(\d+(?:\.\d+)?)\s*%$").unwrap();
    if let Some(caps) = volume_re.captures(raw) {
        let track = caps[1].trim();
        let percent: f64 = caps[2].parse().map_err(|_| "Invalid volume".to_string())?;
        let value = (percent / 100.0).clamp(0.0, 1.0);
        bridge::send("set_track_volume", json!({
            "track": { "name": track },
            "value": value
        })).await?;
        return Ok(json!({ "summary": format!("{} volume set to {}%", track, percent) }));
    }

    if matches!(lower.as_str(), "panic" | "stop all" | "stop all clips") {
        bridge::send("stop_all_clips", json!({})).await?;
        return Ok(json!({ "summary": "Stopped all Session View clips" }));
    }

    let tempo_re = Regex::new(r"(?i)^(?:set\s+)?tempo(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*(?:bpm)?$").unwrap();
    if let Some(caps) = tempo_re.captures(raw) {
        let bpm: f64 = caps[1].parse().map_err(|_| "Invalid BPM".to_string())?;
        if !(20.0..=999.0).contains(&bpm) {
            return Err("Tempo must be between 20 and 999 BPM".into());
        }
        bridge::send("set_tempo", json!({ "bpm": bpm })).await?;
        return Ok(json!({ "summary": format!("Tempo set to {} BPM", bpm) }));
    }

    if matches!(lower.as_str(), "play" | "start" | "start playback" | "play arrangement") {
        bridge::send("start_playback", json!({})).await?;
        return Ok(json!({ "summary": "Arrangement playback started" }));
    }

    if matches!(lower.as_str(), "stop" | "pause" | "stop playback" | "stop arrangement") {
        bridge::send("stop_playback", json!({})).await?;
        return Ok(json!({ "summary": "Arrangement playback stopped" }));
    }

    if matches!(lower.as_str(), "click on" | "metronome on" | "turn click on") {
        bridge::send("set_metronome", json!({ "enabled": true })).await?;
        return Ok(json!({ "summary": "Click turned on" }));
    }

    if matches!(lower.as_str(), "click off" | "metronome off" | "turn click off") {
        bridge::send("set_metronome", json!({ "enabled": false })).await?;
        return Ok(json!({ "summary": "Click turned off" }));
    }

    let track_re = Regex::new(r"(?i)^(mute|unmute|solo|unsolo)\s+(.+)$").unwrap();
    if let Some(caps) = track_re.captures(raw) {
        let action = normalized(&caps[1]);
        let track = caps[2].trim();
        let (command, value) = match action.as_str() {
            "mute" => ("set_track_mute", true),
            "unmute" => ("set_track_mute", false),
            "solo" => ("set_track_solo", true),
            "unsolo" => ("set_track_solo", false),
            _ => unreachable!(),
        };
        bridge::send(command, json!({ "track": { "name": track }, "value": value })).await?;
        return Ok(json!({ "summary": format!("{} {}", action, track) }));
    }

    if matches!(lower.as_str(), "next song" | "go to next song") {
        let (arrangement, context) = live_context(state).await?;
        let next = context.next_song.ok_or_else(|| "There is no next song".to_string())?;
        return jump(state, &arrangement, &next.instance_id, None).await;
    }

    if matches!(lower.as_str(), "previous song" | "go to previous song") {
        let (arrangement, context) = live_context(state).await?;
        let previous = context.previous_song.ok_or_else(|| "There is no previous song".to_string())?;
        return jump(state, &arrangement, &previous.instance_id, None).await;
    }

    if matches!(lower.as_str(), "next section" | "go to next section") {
        let (arrangement, context) = live_context(state).await?;
        let next_id = context.next_section_id.ok_or_else(|| "There is no next section".to_string())?;
        return jump(state, &arrangement, &context.instance_id, Some(&next_id)).await;
    }

    if matches!(lower.as_str(), "previous section" | "go to previous section") {
        let (arrangement, context) = live_context(state).await?;
        let song = arrangement
            .songs
            .iter()
            .find(|song| song.instance_id == context.instance_id)
            .ok_or_else(|| "Current song is unavailable".to_string())?;
        let index = context
            .section_id
            .as_ref()
            .and_then(|id| song.sections.iter().position(|section| &section.id == id))
            .unwrap_or(0);
        if index == 0 {
            return Err("There is no previous section".into());
        }
        return jump(
            state,
            &arrangement,
            &context.instance_id,
            Some(&song.sections[index - 1].id),
        )
        .await;
    }

    let jump_re = Regex::new(r"(?i)^(?:go|jump)(?:\s+to)?\s+(.+)$").unwrap();
    if let Some(caps) = jump_re.captures(raw) {
        let requested = normalized(&caps[1]);
        let (arrangement, context) = live_context(state).await?;
        let song = arrangement
            .songs
            .iter()
            .find(|song| song.instance_id == context.instance_id)
            .ok_or_else(|| "Current song is unavailable".to_string())?;

        if let Some(section) = song
            .sections
            .iter()
            .find(|section| normalized(&section.name) == requested)
            .or_else(|| song.sections.iter().find(|section| normalized(&section.name).contains(&requested)))
        {
            return jump(state, &arrangement, &context.instance_id, Some(&section.id)).await;
        }
    }

    let load_song_re = Regex::new(r"(?i)^(?:load|open|bring\s+in)\s+(?:the\s+)?song\s+(.+)$").unwrap();
    if let Some(caps) = load_song_re.captures(raw) {
        let requested = normalized(caps[1].trim().trim_end_matches('.'));
        let arrangement = active_arrangement(state)?
            .ok_or_else(|| "No active setlist is synced. Add the song to a setlist first.".to_string())?;
        let song = arrangement
            .songs
            .iter()
            .find(|song| normalized(&song.title) == requested)
            .ok_or_else(|| format!("{} is not in the active setlist", caps[1].trim()))?;
        return jump(state, &arrangement, &song.instance_id, None).await;
    }

    let load_re = Regex::new(r"(?i)^(?:load|sync)\s+(.+?)(?:\s+(?:setlist|service))?$").unwrap();
    if let Some(caps) = load_re.captures(raw) {
        let requested = normalized(&caps[1]);
        let setlist = state
            .db
            .list_setlists()?
            .into_iter()
            .find(|item| normalized(&item.title) == requested)
            .ok_or_else(|| format!("Setlist \"{}\" was not found", caps[1].trim()))?;
        return sync_setlist(state, &setlist.id).await;
    }

    let add_re = Regex::new(r"(?i)^add\s+(.+?)\s+to\s+(.+?)(?:\s+after\s+(.+))?$").unwrap();
    if let Some(caps) = add_re.captures(raw) {
        let song_name = normalized(&caps[1]);
        let setlist_name = normalized(&caps[2]);
        let after_name = caps.get(3).map(|value| normalized(value.as_str()));

        let song = state
            .db
            .list_songs()?
            .into_iter()
            .find(|item| normalized(&item.title) == song_name)
            .ok_or_else(|| format!("Song \"{}\" was not found", caps[1].trim()))?;

        let setlist = state
            .db
            .list_setlists()?
            .into_iter()
            .find(|item| normalized(&item.title) == setlist_name)
            .ok_or_else(|| format!("Setlist \"{}\" was not found", caps[2].trim()))?;

        let mut items: Vec<SetlistItemInput> = setlist
            .items
            .iter()
            .map(|item| SetlistItemInput {
                id: Some(item.id.clone()),
                song_id: item.song_id.clone(),
            })
            .collect();

        let new_item = SetlistItemInput {
            id: None,
            song_id: song.id.clone(),
        };

        if let Some(after_name) = after_name {
            let songs = state.db.list_songs()?;
            let after_song = songs
                .iter()
                .find(|item| normalized(&item.title) == after_name)
                .ok_or_else(|| format!("Song \"{}\" was not found", caps.get(3).unwrap().as_str().trim()))?;
            let position = items
                .iter()
                .rposition(|item| item.song_id == after_song.id)
                .map(|index| index + 1)
                .unwrap_or(items.len());
            items.insert(position, new_item);
        } else {
            items.push(new_item);
        }

        state.db.save_setlist(SetlistInput {
            id: Some(setlist.id.clone()),
            title: setlist.title.clone(),
            gap_bars: setlist.gap_bars,
            items,
        })?;

        return Ok(json!({
            "summary": format!("Added {} to {}", song.title, setlist.title)
        }));
    }

    let bar_re = Regex::new(r"(?i)^make\s+(.+?)\s+start\s+at\s+bar\s+(\d+)$").unwrap();
    if let Some(caps) = bar_re.captures(raw) {
        let requested_section = normalized(&caps[1]);
        let start_bar: i64 = caps[2].parse().map_err(|_| "Invalid bar".to_string())?;
        let (_arrangement, context) = live_context(state).await?;
        let song = state
            .db
            .get_song(&context.song_id)?
            .ok_or_else(|| "Current song is not in the library".to_string())?;

        let mut found = false;
        let sections: Vec<SectionInput> = song
            .sections
            .iter()
            .map(|section| {
                let mut bar = section.start_bar;
                if normalized(&section.name) == requested_section {
                    bar = start_bar;
                    found = true;
                }
                SectionInput {
                    id: Some(section.id.clone()),
                    name: section.name.clone(),
                    start_bar: bar,
                }
            })
            .collect();

        if !found {
            return Err(format!("Section \"{}\" was not found in {}", caps[1].trim(), song.title));
        }

        state.db.save_song(SongInput {
            id: Some(song.id.clone()),
            title: song.title.clone(),
            artist: Some(song.artist.clone()),
            bpm: song.bpm,
            key: Some(song.key.clone()),
            meter: song.meter.clone(),
            length_bars: song.length_bars,
            sections,
        })?;

        return Ok(json!({
            "summary": format!("{} now starts at bar {} in {}", caps[1].trim(), start_bar, song.title)
        }));
    }

    Err("I understood that as a Luma command, but it is not in the local command grammar yet.".into())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_repeat_and_bar_suffixes_in_either_order() {
        let (sections_a, length_a) =
            parse_section_specs("Intro 4 bars, Bridge x2 8 bars, Vamp 4 bars").unwrap();
        assert_eq!(sections_a.len(), 4);
        assert_eq!(sections_a[1].name, "Bridge 1");
        assert_eq!(sections_a[2].name, "Bridge 2");
        assert_eq!(sections_a[1].start_bar, 5);
        assert_eq!(sections_a[2].start_bar, 13);
        assert_eq!(length_a, 24);

        let (sections_b, length_b) =
            parse_section_specs("Intro 4 bars, Bridge 8 bars x2, Vamp 4 bars").unwrap();
        assert_eq!(sections_b.len(), 4);
        assert_eq!(sections_b[1].name, "Bridge 1");
        assert_eq!(sections_b[2].name, "Bridge 2");
        assert_eq!(length_b, 24);
    }
}
