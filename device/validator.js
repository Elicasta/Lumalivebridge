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

function libraryTarget(value, field) {
  if (!isObject(value)) throw new Error(field + " must be an object");
  if (value.id != null) return { id: cleanName(value.id, field + ".id") };
  if (value.name != null) return { name: cleanName(value.name, field + ".name") };
  throw new Error(field + " must contain id or name");
}

function optionalIndex(value, field) {
  if (value == null) return -1;
  const index = integer(value, field);
  if (index < -1) throw new Error(field + " must be -1 or >= 0");
  return index;
}

function tempo(value, field) {
  const bpm = finiteNumber(value, field);
  if (bpm < 20 || bpm > 999) throw new Error("tempo must be between 20 and 999 BPM");
  return bpm;
}

function meter(value, field) {
  if (!isObject(value)) throw new Error(field + " must be an object");
  const numerator = integer(value.numerator, field + ".numerator");
  const denominator = integer(value.denominator, field + ".denominator");
  if (numerator < 1 || numerator > 32) throw new Error("meter numerator must be 1..32");
  if (![1, 2, 4, 8, 16].includes(denominator)) {
    throw new Error("meter denominator must be 1, 2, 4, 8, or 16");
  }
  return { numerator, denominator };
}

function sections(value, field) {
  if (!Array.isArray(value)) throw new Error(field + " must be an array");
  if (value.length === 0) throw new Error(field + " must contain at least one section");
  if (value.length > 80) throw new Error(field + " is too large");

  return value.map((section, index) => {
    const item = isObject(section) ? section : { name: section };
    const repeat = item.repeat == null ? 1 : integer(item.repeat, field + "[" + index + "].repeat");
    if (repeat < 1 || repeat > 16) {
      throw new Error(field + "[" + index + "].repeat must be 1..16");
    }

    const normalized = {
      name: cleanName(item.name, field + "[" + index + "].name"),
      repeat
    };

    if (item.bars != null) {
      const bars = integer(item.bars, field + "[" + index + "].bars");
      if (bars < 1 || bars > 512) {
        throw new Error(field + "[" + index + "].bars must be 1..512");
      }
      normalized.bars = bars;
    }

    return normalized;
  });
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

    case "set_tempo":
      normalized = { bpm: tempo(args.bpm, "set_tempo.bpm") };
      break;

    case "set_meter":
      normalized = meter(args, "set_meter");
      break;

    case "fire_scene":
      normalized = { scene: target(args.scene, "fire_scene.scene") };
      break;

    case "stop_all_clips":
      normalized = {};
      break;

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

    case "create_song":
      normalized = {
        title: cleanName(args.title, "create_song.title"),
        bpm: args.bpm == null ? null : tempo(args.bpm, "create_song.bpm"),
        meter: args.meter == null ? null : meter(args.meter, "create_song.meter"),
        key: args.key == null ? null : cleanName(args.key, "create_song.key"),
        sections: sections(args.sections, "create_song.sections")
      };
      break;

    case "load_song":
      normalized = {
        song: libraryTarget(args.song, "load_song.song")
      };
      break;

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
