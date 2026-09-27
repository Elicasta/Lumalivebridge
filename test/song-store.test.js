"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore, normalizeSong } = require("../device/song-store");

test("normalizes reusable song metadata", () => {
  const song = normalizeSong({
    title: "Goodness of God",
    bpm: 63,
    key: "Ab",
    meter: { numerator: 4, denominator: 4 },
    lengthBars: 64,
    sections: [
      { name: "Intro", startBar: 1 },
      { name: "Verse 1", startBar: 9 },
      { name: "Chorus", startBar: 25 }
    ]
  });

  assert.equal(song.id, "goodness-of-god");
  assert.equal(song.sections[2].id, "chorus");
});

test("persists songs, setlists and active setlist locally", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luma-live-"));
  const store = createStore(dir);

  const song = store.saveSong({
    title: "Gratitude",
    bpm: 68,
    meter: { numerator: 4, denominator: 4 },
    lengthBars: 32,
    sections: [{ name: "Intro", startBar: 1 }]
  });

  const setlist = store.saveSetlist({
    title: "Sunday AM",
    gapBars: 4,
    items: [{ songId: song.id }]
  });

  store.setActiveSetlistId(setlist.id);

  assert.equal(store.listSongs().length, 1);
  assert.equal(store.getSetlist(setlist.id).items[0].songId, song.id);
  assert.equal(store.getActiveSetlistId(), setlist.id);

  fs.rmSync(dir, { recursive: true, force: true });
});
