"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SessionStore } = require("../device/session-store");

test("persists a reusable song and expands it back into Ableton commands", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luma-live-"));
  const file = path.join(dir, "library.json");

  try {
    const store = new SessionStore(file);
    const saved = store.apply({
      type: "create_song",
      args: {
        title: "Gratitude",
        bpm: 72,
        meter: { numerator: 6, denominator: 8 },
        key: null,
        sections: [
          { name: "Intro", repeat: 1 },
          { name: "Verse", repeat: 1 },
          { name: "Bridge", repeat: 2 },
          { name: "Outro", repeat: 1 }
        ]
      }
    });

    assert.equal(saved.created, true);
    assert.equal(store.snapshot().songs.length, 1);

    const reloaded = new SessionStore(file);
    const load = reloaded.apply({
      type: "load_song",
      args: { song: { name: "Gratitude" } }
    });

    assert.deepEqual(load.liveCommands, [
      { type: "set_tempo", args: { bpm: 72 } },
      { type: "set_meter", args: { numerator: 6, denominator: 8 } },
      { type: "create_scene", args: { name: "Intro", index: -1 } },
      { type: "create_scene", args: { name: "Verse", index: -1 } },
      { type: "create_scene", args: { name: "Bridge 1", index: -1 } },
      { type: "create_scene", args: { name: "Bridge 2", index: -1 } },
      { type: "create_scene", args: { name: "Outro", index: -1 } }
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saving the same song updates it instead of creating duplicates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luma-live-"));
  const file = path.join(dir, "library.json");

  try {
    const store = new SessionStore(file);
    const base = {
      type: "create_song",
      args: {
        title: "Gratitude",
        bpm: 68,
        meter: null,
        key: null,
        sections: [{ name: "Intro", repeat: 1 }]
      }
    };

    const first = store.apply(base);
    const second = store.apply({
      ...base,
      args: {
        ...base.args,
        bpm: 72,
        sections: [
          { name: "Intro", repeat: 1 },
          { name: "Chorus", repeat: 1 }
        ]
      }
    });

    const songs = store.snapshot().songs;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(songs.length, 1);
    assert.equal(songs[0].bpm, 72);
    assert.equal(songs[0].sections.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
