"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "device", "live-api.js"),
  "utf8"
);

function makeHarness(options = {}) {
  let nextClipId = 1;
  const state = {
    tempo: 120,
    numerator: 4,
    denominator: 4,
    isPlaying: !!options.isPlaying,
    metronome: false,
    currentSongTime: Number(options.currentSongTime || 0),
    loop: 0,
    loopStart: 0,
    loopLength: 0,
    tracks: (options.tracks || []).map((track) => ({
      name: track.name,
      type: track.type || "audio",
      frozen: !!track.frozen,
      clips: (track.clips || []).map((clip) => ({
        id: clip.id || nextClipId++,
        name: clip.name || "",
        start_time: Number(clip.start_time || 0),
        pitch_coarse: 0,
        warping: 0,
        warp_mode: 0
      }))
    }))
  };

  function trackFromPath(value) {
    const match = /^live_set tracks (\d+)$/.exec(value);
    return match ? state.tracks[Number(match[1])] : null;
  }

  function clipFromPath(value) {
    const match = /^live_set tracks (\d+) arrangement_clips (\d+)$/.exec(value);
    if (!match) return null;
    const track = state.tracks[Number(match[1])];
    return track ? track.clips[Number(match[2])] : null;
  }

  class MockLiveAPI {
    constructor(value) {
      this.path = value;
      const clip = clipFromPath(value);
      this.id = clip ? clip.id : 0;
    }

    get(property) {
      if (this.path === "live_set") {
        if (property === "tempo") return state.tempo;
        if (property === "signature_numerator") return state.numerator;
        if (property === "signature_denominator") return state.denominator;
        if (property === "is_playing") return state.isPlaying ? 1 : 0;
        if (property === "metronome") return state.metronome ? 1 : 0;
        if (property === "current_song_time") return state.currentSongTime;
        if (property === "loop") return state.loop;
        if (property === "loop_start") return state.loopStart;
        if (property === "loop_length") return state.loopLength;
      }

      const track = trackFromPath(this.path);
      if (track) {
        if (property === "name") return track.name;
        if (property === "is_frozen") return track.frozen ? 1 : 0;
        if (property === "has_audio_input") return track.type === "audio" ? 1 : 0;
        if (property === "has_midi_input") return track.type === "midi" ? 1 : 0;
        if (property === "mute" || property === "solo") return 0;
        if (property === "playing_slot_index") return -1;
      }

      const clip = clipFromPath(this.path);
      if (clip) {
        if (property === "name") return clip.name;
        if (property === "start_time") return clip.start_time;
        if (property === "pitch_coarse") return clip.pitch_coarse;
        if (property === "warping") return clip.warping;
        if (property === "warp_mode") return clip.warp_mode;
      }

      return 0;
    }

    getcount(child) {
      if (this.path === "live_set") {
        if (child === "tracks") return state.tracks.length;
        if (child === "scenes" || child === "cue_points") return 0;
      }

      const track = trackFromPath(this.path);
      if (track && child === "arrangement_clips") return track.clips.length;
      return 0;
    }

    set(property, value) {
      if (this.path === "live_set") {
        if (property === "tempo") state.tempo = Number(value);
        else if (property === "signature_numerator") state.numerator = Number(value);
        else if (property === "signature_denominator") state.denominator = Number(value);
        else if (property === "current_song_time") state.currentSongTime = Number(value);
        else if (property === "metronome") state.metronome = !!value;
        else if (property === "loop") state.loop = Number(value);
        else if (property === "loop_start") state.loopStart = Number(value);
        else if (property === "loop_length") state.loopLength = Number(value);
        return;
      }

      const track = trackFromPath(this.path);
      if (track && property === "name") {
        track.name = String(value);
        return;
      }

      const clip = clipFromPath(this.path);
      if (clip) {
        if (property === "name") clip.name = String(value);
        else if (property === "pitch_coarse") clip.pitch_coarse = Number(value);
        else if (property === "warping") clip.warping = Number(value);
        else if (property === "warp_mode") clip.warp_mode = Number(value);
      }
    }

    call(method, ...args) {
      if (this.path === "live_set") {
        if (method === "create_audio_track") {
          state.tracks.push({ name: "", type: "audio", frozen: false, clips: [] });
          return;
        }
        if (method === "create_midi_track") {
          state.tracks.push({ name: "", type: "midi", frozen: false, clips: [] });
          return;
        }
        if (method === "start_playing") {
          state.isPlaying = true;
          return;
        }
        if (method === "stop_playing") {
          state.isPlaying = false;
          return;
        }
        if (method === "stop_all_clips") return;
      }

      const track = trackFromPath(this.path);
      if (!track) return;

      if (method === "create_audio_clip") {
        track.clips.push({
          id: nextClipId++,
          name: "",
          start_time: Number(args[1]),
          pitch_coarse: 0,
          warping: 0,
          warp_mode: 0
        });
        return;
      }

      if (method === "create_midi_clip") {
        track.clips.push({
          id: nextClipId++,
          name: "",
          start_time: Number(args[0]),
          pitch_coarse: 0,
          warping: 0,
          warp_mode: 0
        });
        return;
      }

      if (method === "delete_clip") {
        const id = Number(String(args[0]).replace(/^id\s+/, ""));
        const index = track.clips.findIndex((clip) => clip.id === id);
        if (index >= 0) track.clips.splice(index, 1);
      }
    }
  }

  class MockTask {
    constructor(fn, context) {
      this.fn = fn;
      this.context = context;
      this.interval = 0;
      this.active = false;
    }
    repeat() {
      this.active = true;
    }
    cancel() {
      this.active = false;
    }
  }

  const context = {
    LiveAPI: MockLiveAPI,
    Task: MockTask,
    outlet() {},
    console,
    JSON,
    Math,
    Number,
    String,
    Array,
    Error,
    isFinite
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: "device/live-api.js" });
  return { context, state };
}

test("service preflight rejects a same-name track with the wrong type", () => {
  const { context } = makeHarness({
    tracks: [{ name: "KEYS", type: "midi" }]
  });

  assert.throws(
    () => context.ensureTrack("audio", "KEYS"),
    /not an audio track/
  );
});

test("service preflight rejects frozen destination tracks", () => {
  const { context } = makeHarness({
    tracks: [{ name: "DRUMS", type: "audio", frozen: true }]
  });

  assert.throws(
    () => context.ensureTrack("audio", "DRUMS"),
    /frozen/
  );
});

test("Arrangement audio creation names the clip and cleanup preserves user clips", () => {
  const { context, state } = makeHarness({
    tracks: [{
      name: "DRUMS",
      type: "audio",
      clips: [{ name: "User Clip", start_time: 0 }]
    }]
  });

  context.execute({
    type: "create_arrangement_audio_clip",
    args: {
      track: { name: "DRUMS" },
      filePath: "/tmp/drums.wav",
      position: 8,
      name: "LL|Song A|DRUMS",
      transposeSemitones: 0
    }
  });

  assert.equal(state.tracks[0].clips.length, 2);
  assert.equal(state.tracks[0].clips[1].name, "LL|Song A|DRUMS");

  const result = context.execute({ type: "clear_luma_arrangement", args: {} });
  assert.equal(result.removed, 1);
  assert.deepEqual(state.tracks[0].clips.map((clip) => clip.name), ["User Clip"]);
});

test("next-bar section jump uses song-local 6/8 bar length", () => {
  const { context } = makeHarness({
    isPlaying: true,
    currentSongTime: 4.5
  });

  const queued = context.queueJumpToTime({
    time: 12,
    origin: 0,
    beatsPerBar: 3
  });

  assert.equal(queued.queued, true);
  assert.equal(queued.boundary, 6);
});

test("Hold transition stops playback and parks at the next song", () => {
  const { context, state } = makeHarness({
    isPlaying: true,
    currentSongTime: 32
  });

  context.configureServiceTimeline({
    songs: [
      { startBeat: 0, endBeat: 32, bpm: 72, numerator: 4, denominator: 4 },
      { startBeat: 36, endBeat: 68, bpm: 80, numerator: 4, denominator: 4 }
    ],
    transitions: [
      { mode: "hold", triggerBeat: 32, nextStartBeat: 36 }
    ]
  });

  assert.equal(state.isPlaying, false);
  assert.equal(state.currentSongTime, 36);
});
