"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildArrangement, locatePosition, findJumpTarget } = require("../device/arrangement");

const songs = {
  gratitude: {
    id: "gratitude",
    title: "Gratitude",
    artist: "",
    bpm: 68,
    key: "B",
    meter: { numerator: 4, denominator: 4 },
    lengthBars: 32,
    sections: [
      { id: "intro", name: "Intro", startBar: 1 },
      { id: "verse-1", name: "Verse 1", startBar: 9 },
      { id: "chorus", name: "Chorus", startBar: 17 }
    ]
  },
  "hineh-ma-tov": {
    id: "hineh-ma-tov",
    title: "Hineh Ma Tov",
    artist: "",
    bpm: 120,
    key: "Dm",
    meter: { numerator: 4, denominator: 4 },
    lengthBars: 16,
    sections: [
      { id: "intro", name: "Intro", startBar: 1 },
      { id: "chorus", name: "Chorus", startBar: 9 }
    ]
  }
};

test("builds namespaced song and section markers", () => {
  const arrangement = buildArrangement({
    id: "sunday",
    title: "Sunday",
    gapBars: 4,
    items: [
      { id: "a", songId: "gratitude" },
      { id: "b", songId: "hineh-ma-tov" }
    ]
  }, songs);

  assert.equal(arrangement.songs.length, 2);
  assert.equal(arrangement.songs[0].startBeat, 0);
  assert.equal(arrangement.songs[1].startBeat, 144);
  assert.ok(arrangement.markers.some((m) => m.name === "LL|SECTION|gratitude|chorus|Chorus"));
});

test("locates current song and section from the Ableton playhead", () => {
  const arrangement = buildArrangement({
    id: "sunday",
    title: "Sunday",
    gapBars: 4,
    items: [{ id: "a", songId: "gratitude" }]
  }, songs);

  const current = locatePosition(arrangement, 70);
  assert.equal(current.songTitle, "Gratitude");
  assert.equal(current.sectionName, "Chorus");
});

test("finds an exact remote jump target within the active song namespace", () => {
  const arrangement = buildArrangement({
    id: "sunday",
    title: "Sunday",
    gapBars: 4,
    items: [
      { id: "a", songId: "gratitude" },
      { id: "b", songId: "hineh-ma-tov" }
    ]
  }, songs);

  const target = findJumpTarget(arrangement, "hineh-ma-tov", "chorus");
  assert.equal(target.time, 176);
  assert.equal(target.song.bpm, 120);
});
