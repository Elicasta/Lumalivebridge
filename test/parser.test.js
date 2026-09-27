"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseText,
  parseSectionSpecs,
  splitSections,
  refFromText
} = require("../device/parser");

test("builds and saves a reusable song with meter", () => {
  const plan = parseText(
    "Create a song called Gratitude at 72 BPM in 6/8 with Intro, Verse, Chorus, Bridge x2 and Outro"
  );

  assert.equal(plan.title, "Build Gratitude");
  assert.equal(plan.commands[0].type, "set_tempo");
  assert.equal(plan.commands[0].args.bpm, 72);
  assert.deepEqual(plan.commands[1], {
    type: "set_meter",
    args: { numerator: 6, denominator: 8 }
  });

  assert.deepEqual(
    plan.commands
      .filter((item) => item.type === "create_scene")
      .map((item) => item.args.name),
    ["Intro", "Verse", "Chorus", "Bridge 1", "Bridge 2", "Outro"]
  );

  const save = plan.commands.at(-1);
  assert.equal(save.type, "create_song");
  assert.equal(save.args.title, "Gratitude");
  assert.equal(save.args.bpm, 72);
  assert.deepEqual(save.args.meter, { numerator: 6, denominator: 8 });
  assert.deepEqual(save.args.sections[3], {
    name: "Bridge",
    repeat: 2
  });
});

test("still parses a song build when meter is omitted", () => {
  const plan = parseText(
    "Create a song called Gratitude at 68 BPM with Intro, Verse, Chorus, Bridge, Build and Altar"
  );

  assert.equal(plan.commands[0].type, "set_tempo");
  assert.equal(plan.commands.some((item) => item.type === "set_meter"), false);
  assert.equal(plan.commands.at(-1).type, "create_song");
  assert.equal(plan.commands.at(-1).args.meter, null);
});

test("parses a reusable song load", () => {
  const plan = parseText("Load song Gratitude");
  assert.deepEqual(plan.commands, [
    {
      type: "load_song",
      args: { song: { name: "Gratitude" } }
    }
  ]);
});

test("parses a church session", () => {
  const plan = parseText("Create a church session at 72 BPM");
  assert.equal(plan.commands[0].type, "set_tempo");
  assert.ok(plan.commands.some((item) => item.type === "create_track" && item.args.name === "CLICK"));
  assert.ok(plan.commands.some((item) => item.type === "create_track" && item.args.name === "LUMARIG"));
});

test("parses direct scene launch", () => {
  const plan = parseText("launch scene Chorus");
  assert.deepEqual(plan.commands[0], {
    type: "fire_scene",
    args: { scene: { name: "Chorus" } }
  });
});

test("numeric references are one-based for humans", () => {
  assert.deepEqual(refFromText("scene 3"), { index: 2 });
});

test("splits section lists", () => {
  assert.deepEqual(splitSections("intro, verse, chorus and altar."), [
    "Intro",
    "Verse",
    "Chorus",
    "Altar"
  ]);
});

test("parses section repeat and bar metadata", () => {
  assert.deepEqual(parseSectionSpecs("intro 4 bars, bridge 8 bars x3"), [
    { name: "Intro", repeat: 1, bars: 4 },
    { name: "Bridge", repeat: 3, bars: 8 }
  ]);
});

test("rejects unknown language instead of guessing", () => {
  assert.throws(() => parseText("make it feel huge and crazy"), /could not safely map/i);
});
