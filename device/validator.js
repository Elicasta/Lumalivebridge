"use strict";

const { COMMAND_TYPES } = require("./protocol");

const ALLOWED = new Set(COMMAND_TYPES);
const NAME_MAX = 160;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanName(value, field) {
  if (typeof value !== "string") {
    throw new Error(field + " must be a string");
  }
  const name = value.trim();
  if (!name) throw new Error(field + " cannot be empty");
  if (name.length > NAME_MAX) throw new Error(field + " is too long");
  return name;
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(field + " must be a number");
  return number;
}

function integer(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(field + " must be an integer");
  return number;
}

function bool(value, field) {
  if (value === true || value === false) return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  throw new Error(field + " must be a boolean");
}

function target(value, field) {
  if (!isObject(value)) throw new Error(field + " must be an object");
  if (value.name != null) return { name: cleanName(value.name, field + ".name") };
  if (value.index != null) {
    const index = integer(value.index, field + ".index");
    if (index < 0) throw new Error(field + ".index must be >= 0");
    return { index };
  }
  throw new Error(field + " must contain name or index");
}

function optionalIndex(value, field) {
  if (value == null) return -1;
  const index = integer(value, field);
  if (index < -1) throw new Error(field + " must be -1 or >= 0");
  return index;
}

function validateCommand(input, options = {}) {
  if (!isObject(input)) throw new Error("command must be an object");
  if (!ALLOWED.has(input.type)) throw new Error("unsupported command type: " + input.type);
  if (input.type === "get_state" && !options.allowInternal) {
    throw new Error("get_state is internal-only");
  }

  const args = isObject(input.args) ? input.args : {};
  let normalized;

  switch (input.type) {
    case "get_state":
    case "get_arrangement_overview":
      normalized = {};
      break;

    case "create_track": {
      const kind = args.kind === "midi" ? "midi" : args.kind === "audio" ? "audio" : null;
      if (!kind) throw new Error("create_track.kind must be midi or audio");
      normalized = {
        kind,
        name: cleanName(args.name, "create_track.name"),
        index: optionalIndex(args.index, "create_track.index")
      };
      break;
    }

    case "rename_track":
      normalized = {
        track: target(args.track, "rename_track.track"),
        name: cleanName(args.name, "rename_track.name")
      };
      break;

    case "create_scene":
      normalized = {
        name: cleanName(args.name, "create_scene.name"),
        index: optionalIndex(args.index, "create_scene.index")
      };
      break;

    case "rename_scene":
      normalized = {
        scene: target(args.scene, "rename_scene.scene"),
        name: cleanName(args.name, "rename_scene.name")
      };
      break;

    case "set_tempo": {
      const bpm = finiteNumber(args.bpm, "set_tempo.bpm");
      if (bpm < 20 || bpm > 999) throw new Error("tempo must be between 20 and 999 BPM");
      normalized = { bpm };
      break;
    }

    case "set_meter": {
      const numerator = integer(args.numerator, "set_meter.numerator");
      const denominator = integer(args.denominator, "set_meter.denominator");
      if (numerator < 1 || numerator > 32) throw new Error("meter numerator must be 1..32");
      if (![1, 2, 4, 8, 16].includes(denominator)) {
        throw new Error("meter denominator must be 1, 2, 4, 8, or 16");
      }
      normalized = { numerator, denominator };
      break;
    }

    case "start_playback":
    case "stop_playback":
      normalized = {};
      break;

    case "set_metronome":
      normalized = { enabled: bool(args.enabled, "set_metronome.enabled") };
      break;

    case "fire_scene":
      normalized = { scene: target(args.scene, "fire_scene.scene") };
      break;

    case "stop_all_clips":
    case "refresh_session":
    case "get_session_overview":
    case "prev_scene":
    case "next_scene":
    case "tap_tempo":
    case "capture_midi":
    case "undo":
    case "redo":
    case "clear_selected_clip":
    case "duplicate_selected_clip":
    case "double_selected_clip":
      normalized = {};
      break;

    case "fire_clip": {
      const trackIndex = integer(args.trackIndex, "fire_clip.trackIndex");
      const sceneIndex = integer(args.sceneIndex, "fire_clip.sceneIndex");
      if (trackIndex < 0 || sceneIndex < 0) throw new Error("fire_clip indices must be >= 0");
      normalized = { trackIndex, sceneIndex };
      break;
    }

    case "stop_track": {
      const trackIndex = integer(args.trackIndex, "stop_track.trackIndex");
      if (trackIndex < 0) throw new Error("stop_track.trackIndex must be >= 0");
      normalized = { trackIndex };
      break;
    }

    case "session_record": {
      const bars = args.bars == null ? 0 : finiteNumber(args.bars, "session_record.bars");
      if (bars < 0 || bars > 512) throw new Error("session_record.bars must be 0..512");
      normalized = { bars };
      break;
    }

    case "set_swing": {
      const value = finiteNumber(args.value, "set_swing.value");
      if (value < 0 || value > 1) throw new Error("set_swing.value must be 0..1");
      normalized = { value };
      break;
    }

    case "create_midi_clip": {
      const lengthBeats = finiteNumber(args.lengthBeats, "create_midi_clip.lengthBeats");
      if (lengthBeats <= 0 || lengthBeats > 65536) {
        throw new Error("clip length must be > 0 and <= 65536 beats");
      }
      normalized = {
        track: target(args.track, "create_midi_clip.track"),
        scene: target(args.scene, "create_midi_clip.scene"),
        lengthBeats,
        name: args.name == null ? null : cleanName(args.name, "create_midi_clip.name")
      };
      break;
    }

    case "duplicate_clip":
      normalized = {
        track: target(args.track, "duplicate_clip.track"),
        sourceScene: target(args.sourceScene, "duplicate_clip.sourceScene")
      };
      break;

    case "set_clip_loop": {
      const enabled = bool(args.enabled, "set_clip_loop.enabled");
      normalized = {
        track: target(args.track, "set_clip_loop.track"),
        scene: target(args.scene, "set_clip_loop.scene"),
        enabled
      };
      if (args.start != null) normalized.start = finiteNumber(args.start, "set_clip_loop.start");
      if (args.end != null) normalized.end = finiteNumber(args.end, "set_clip_loop.end");
      if (normalized.start != null && normalized.end != null && normalized.end <= normalized.start) {
        throw new Error("set_clip_loop.end must be greater than start");
      }
      break;
    }

    case "set_track_volume": {
      const value = finiteNumber(args.value, "set_track_volume.value");
      if (value < 0 || value > 1) throw new Error("track volume must be normalized 0..1");
      normalized = {
        track: target(args.track, "set_track_volume.track"),
        value
      };
      break;
    }

    case "set_track_mute":
      normalized = {
        track: target(args.track, "set_track_mute.track"),
        value: bool(args.value, "set_track_mute.value")
      };
      break;

    case "set_track_solo":
      normalized = {
        track: target(args.track, "set_track_solo.track"),
        value: bool(args.value, "set_track_solo.value")
      };
      break;

    case "sync_cue_points": {
      if (!Array.isArray(args.points)) throw new Error("sync_cue_points.points must be an array");
      if (args.points.length > 250) throw new Error("sync_cue_points.points is too large");
      normalized = {
        replace: args.replace == null ? true : bool(args.replace, "sync_cue_points.replace"),
        points: args.points.map((point, index) => {
          if (!isObject(point)) throw new Error("cue point " + index + " must be an object");
          const time = finiteNumber(point.time, "cue point time");
          if (time < 0 || time > 10000000) throw new Error("cue point time is out of range");
          const name = cleanName(point.name, "cue point name");
          if (!name.startsWith("LL|")) throw new Error("Luma cue point names must begin with LL|");
          return { time, name };
        })
      };
      break;
    }

    case "jump_to_time": {
      const time = finiteNumber(args.time, "jump_to_time.time");
      if (time < 0 || time > 10000000) throw new Error("jump time is out of range");
      normalized = { time };
      break;
    }

    case "queue_jump_to_time": {
      const time = finiteNumber(args.time, "queue_jump_to_time.time");
      const origin = finiteNumber(args.origin, "queue_jump_to_time.origin");
      const beatsPerBar = finiteNumber(args.beatsPerBar, "queue_jump_to_time.beatsPerBar");
      if (time < 0 || origin < 0 || beatsPerBar <= 0 || beatsPerBar > 128) {
        throw new Error("quantized jump range is invalid");
      }
      normalized = { time, origin, beatsPerBar };
      break;
    }

    case "ensure_track": {
      const kind = args.kind === "midi" ? "midi" : args.kind === "audio" ? "audio" : null;
      if (!kind) throw new Error("ensure_track.kind must be midi or audio");
      normalized = {
        kind,
        name: cleanName(args.name, "ensure_track.name")
      };
      break;
    }

    case "begin_bulk_update":
    case "end_bulk_update":
    case "clear_luma_arrangement":
      normalized = {};
      break;

    case "create_arrangement_audio_clip": {
      const position = finiteNumber(args.position, "create_arrangement_audio_clip.position");
      if (position < 0 || position > 1576800) throw new Error("Arrangement clip position is out of range");
      normalized = {
        track: target(args.track, "create_arrangement_audio_clip.track"),
        filePath: cleanName(args.filePath, "create_arrangement_audio_clip.filePath"),
        position,
        name: cleanName(args.name, "create_arrangement_audio_clip.name"),
        transposeSemitones: args.transposeSemitones == null
          ? 0
          : integer(args.transposeSemitones, "create_arrangement_audio_clip.transposeSemitones")
      };
      if (normalized.transposeSemitones < -12 || normalized.transposeSemitones > 12) {
        throw new Error("Arrangement clip transpose must be between -12 and +12 semitones");
      }
      break;
    }

    case "create_arrangement_midi_clip": {
      const position = finiteNumber(args.position, "create_arrangement_midi_clip.position");
      const lengthBeats = finiteNumber(args.lengthBeats, "create_arrangement_midi_clip.lengthBeats");
      if (position < 0 || position > 1576800) throw new Error("Arrangement MIDI clip position is out of range");
      if (lengthBeats <= 0 || lengthBeats > 65536) throw new Error("Arrangement MIDI clip length is out of range");
      normalized = {
        track: target(args.track, "create_arrangement_midi_clip.track"),
        position,
        lengthBeats,
        name: cleanName(args.name, "create_arrangement_midi_clip.name")
      };
      break;
    }

    case "configure_service_timeline": {
      if (!Array.isArray(args.songs)) throw new Error("configure_service_timeline.songs must be an array");
      if (!Array.isArray(args.transitions)) throw new Error("configure_service_timeline.transitions must be an array");
      if (args.songs.length > 100 || args.transitions.length > 100) throw new Error("service timeline is too large");
      normalized = {
        songs: args.songs.map((song, index) => {
          if (!isObject(song)) throw new Error("timeline song " + index + " must be an object");
          return {
            instanceId: cleanName(song.instanceId, "timeline song instanceId"),
            startBeat: finiteNumber(song.startBeat, "timeline song startBeat"),
            endBeat: finiteNumber(song.endBeat, "timeline song endBeat"),
            bpm: finiteNumber(song.bpm, "timeline song bpm"),
            numerator: integer(song.numerator, "timeline song numerator"),
            denominator: integer(song.denominator, "timeline song denominator")
          };
        }),
        transitions: args.transitions.map((transition, index) => {
          if (!isObject(transition)) throw new Error("timeline transition " + index + " must be an object");
          return {
            fromInstanceId: cleanName(transition.fromInstanceId, "timeline transition fromInstanceId"),
            toInstanceId: transition.toInstanceId == null ? null : cleanName(transition.toInstanceId, "timeline transition toInstanceId"),
            mode: cleanName(transition.mode, "timeline transition mode"),
            triggerBeat: finiteNumber(transition.triggerBeat, "timeline transition triggerBeat"),
            nextStartBeat: transition.nextStartBeat == null ? null : finiteNumber(transition.nextStartBeat, "timeline transition nextStartBeat"),
            vampStartBeat: transition.vampStartBeat == null ? null : finiteNumber(transition.vampStartBeat, "timeline transition vampStartBeat"),
            vampEndBeat: transition.vampEndBeat == null ? null : finiteNumber(transition.vampEndBeat, "timeline transition vampEndBeat")
          };
        })
      };
      break;
    }

    case "set_arrangement_loop": {
      const enabled = bool(args.enabled, "set_arrangement_loop.enabled");
      const start = finiteNumber(args.start == null ? 0 : args.start, "set_arrangement_loop.start");
      const length = finiteNumber(args.length == null ? 1 : args.length, "set_arrangement_loop.length");
      if (start < 0 || length <= 0) throw new Error("Arrangement loop range is invalid");
      normalized = { enabled, start, length };
      break;
    }

    default:
      throw new Error("unsupported command");
  }

  return { type: input.type, args: normalized };
}

function validatePlan(plan) {
  if (!isObject(plan)) throw new Error("plan must be an object");
  if (!Array.isArray(plan.commands) || plan.commands.length === 0) {
    throw new Error("plan.commands must contain at least one command");
  }
  if (plan.commands.length > 100) throw new Error("plan is too large");
  return {
    id: typeof plan.id === "string" ? plan.id : null,
    title: typeof plan.title === "string" ? plan.title.slice(0, 200) : "Command plan",
    text: typeof plan.text === "string" ? plan.text.slice(0, 4000) : "",
    confidence: Number.isFinite(Number(plan.confidence)) ? Number(plan.confidence) : 0,
    commands: plan.commands.map((item) => validateCommand(item)),
    notes: Array.isArray(plan.notes) ? plan.notes.map(String).slice(0, 20) : []
  };
}

module.exports = {
  validateCommand,
  validatePlan
};
