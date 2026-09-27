"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseText, splitSections, refFromText } = require("../device/parser");

test("parses a worship song build", () => {
  const plan = parseText(
    "Create a song called Gratitude at 68 BPM with Intro, Verse, Chorus, Bridge, Build and Altar"
  );

  assert.equal(plan.title, "Build Gratitude");
  assert.equal(plan.commands[0].type, "set_tempo");
  assert.equal(plan.commands[0].args.bpm, 68);
  assert.deepEqual(
    plan.commands.slice(1).map((item) => item.args.name),
    ["Intro", "Verse", "Chorus", "Bridge", "Build", "Altar"]
  );
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

test("rejects unknown language instead of guessing", () => {
  assert.throws(() => parseText("make it feel huge and crazy"), /could not safely map/i);
});
