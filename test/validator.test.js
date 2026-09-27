"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCommand, validatePlan } = require("../device/validator");

test("accepts a safe tempo", () => {
  assert.deepEqual(validateCommand({
    type: "set_tempo",
    args: { bpm: 150 }
  }), {
    type: "set_tempo",
    args: { bpm: 150 }
  });
});

test("rejects dangerous/unknown command types", () => {
  assert.throws(() => validateCommand({
    type: "run_shell",
    args: { command: "rm -rf /" }
  }), /unsupported command type/i);
});

test("rejects internal state command from public direct API", () => {
  assert.throws(() => validateCommand({
    type: "get_state",
    args: {}
  }), /internal-only/i);
});

test("rejects absurd tempos", () => {
  assert.throws(() => validateCommand({
    type: "set_tempo",
    args: { bpm: 5000 }
  }), /between 20 and 999/i);
});

test("normalizes boolean track state", () => {
  assert.deepEqual(validateCommand({
    type: "set_track_mute",
    args: { track: { name: "Click" }, value: 1 }
  }), {
    type: "set_track_mute",
    args: { track: { name: "Click" }, value: true }
  });
});

test("validates reusable song metadata", () => {
  assert.deepEqual(validateCommand({
    type: "create_song",
    args: {
      title: "Gratitude",
      bpm: 72,
      meter: { numerator: 6, denominator: 8 },
      sections: [
        { name: "Intro" },
        { name: "Bridge", repeat: 2, bars: 8 }
      ]
    }
  }), {
    type: "create_song",
    args: {
      title: "Gratitude",
      bpm: 72,
      meter: { numerator: 6, denominator: 8 },
      key: null,
      sections: [
        { name: "Intro", repeat: 1 },
        { name: "Bridge", repeat: 2, bars: 8 }
      ]
    }
  });
});

test("validates song library targets", () => {
  assert.deepEqual(validateCommand({
    type: "load_song",
    args: { song: { name: "Gratitude" } }
  }), {
    type: "load_song",
    args: { song: { name: "Gratitude" } }
  });
});

test("validates plans and caps empty plans", () => {
  assert.throws(() => validatePlan({ commands: [] }), /at least one command/i);
});
