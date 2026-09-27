"use strict";

const COMMAND_TYPES = Object.freeze([
  "get_state",
  "create_track",
  "rename_track",
  "create_scene",
  "rename_scene",
  "set_tempo",
  "set_meter",
  "fire_scene",
  "stop_all_clips",
  "create_midi_clip",
  "duplicate_clip",
  "set_clip_loop",
  "set_track_volume",
  "set_track_mute",
  "set_track_solo",
  "create_song",
  "load_song"
]);

const INTERNAL_COMMAND_TYPES = Object.freeze(["get_state"]);
const LOCAL_COMMAND_TYPES = Object.freeze(["create_song", "load_song"]);

const USER_COMMAND_TYPES = Object.freeze(
  COMMAND_TYPES.filter((type) => !INTERNAL_COMMAND_TYPES.includes(type))
);

const PLACEHOLDER_ADAPTERS = Object.freeze([
  "mainstage",
  "lumarig",
  "propresenter",
  "planningcenter",
  "chatgpt-relay"
]);

function command(type, args = {}) {
  return { type, args };
}

function isLocalCommand(type) {
  return LOCAL_COMMAND_TYPES.includes(type);
}

module.exports = {
  COMMAND_TYPES,
  USER_COMMAND_TYPES,
  INTERNAL_COMMAND_TYPES,
  LOCAL_COMMAND_TYPES,
  PLACEHOLDER_ADAPTERS,
  isLocalCommand,
  command
};
