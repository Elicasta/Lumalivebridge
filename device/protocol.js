"use strict";

const COMMAND_TYPES = Object.freeze([
  "get_state",
  "create_track",
  "rename_track",
  "create_scene",
  "rename_scene",
  "set_tempo",
  "set_meter",
  "start_playback",
  "stop_playback",
  "set_metronome",
  "fire_scene",
  "stop_all_clips",
  "refresh_session",
  "create_midi_clip",
  "duplicate_clip",
  "set_clip_loop",
  "set_track_volume",
  "set_track_mute",
  "set_track_solo",
  "sync_cue_points",
  "jump_to_time",
  "queue_jump_to_time",
  "ensure_track",
  "begin_bulk_update",
  "end_bulk_update",
  "clear_luma_arrangement",
  "create_arrangement_audio_clip",
  "create_arrangement_midi_clip",
  "configure_service_timeline",
  "set_arrangement_loop"
]);

const USER_COMMAND_TYPES = Object.freeze(
  COMMAND_TYPES.filter((type) => type !== "get_state")
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

module.exports = {
  COMMAND_TYPES,
  USER_COMMAND_TYPES,
  PLACEHOLDER_ADAPTERS,
  command
};
