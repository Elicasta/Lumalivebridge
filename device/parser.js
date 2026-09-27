"use strict";

const crypto = require("crypto");
const { command } = require("./protocol");
const { validatePlan } = require("./validator");

const DEFAULT_CHURCH_TRACKS = [
  ["audio", "GUIDE"],
  ["audio", "CLICK"],
  ["audio", "PAD"],
  ["audio", "LOOPS"],
  ["audio", "DRUMS"],
  ["audio", "BASS"],
  ["audio", "KEYS"],
  ["audio", "GUITARS"],
  ["audio", "BGV"],
  ["audio", "TRACKS"],
  ["midi", "MAINSTAGE"],
  ["midi", "PROPRESENTER"],
  ["midi", "LUMARIG"]
];

function titleCase(input) {
  return String(input)
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function refFromText(value) {
  const text = String(value).trim();
  const match = text.match(/^(?:scene|track)?\s*#?(\d+)$/i);
  if (match) return { index: Math.max(0, Number(match[1]) - 1) };
  return { name: titleCase(text) };
}

function splitSections(value) {
  return String(value)
    .replace(/\.$/, "")
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => titleCase(part))
    .filter(Boolean)
    .slice(0, 40);
}

function newPlan(text, title, commands, confidence = 0.95, notes = []) {
  return validatePlan({
    id: "plan-" + crypto.randomUUID(),
    text,
    title,
    confidence,
    commands,
    notes
  });
}

function parseSongBuild(text) {
  const match = text.match(
    /create\s+(?:a\s+)?(?:worship\s+|praise\s+|church\s+)?song\s+(?:called|named)\s+(.+?)\s+at\s+(\d+(?:\.\d+)?)\s*bpm\s+with\s+(.+)/i
  );
  if (!match) return null;

  const song = titleCase(match[1]);
  const bpm = Number(match[2]);
  const sections = splitSections(match[3]);
  const commands = [command("set_tempo", { bpm })];

  sections.forEach((name) => commands.push(command("create_scene", { name, index: -1 })));

  return newPlan(
    text,
    "Build " + song,
    commands,
    0.99,
    [
      "Song metadata name is kept in the plan title in v0.1.",
      "Scenes are appended in the order requested."
    ]
  );
}

function parseChurchSession(text) {
  if (!/create\s+(?:a\s+)?(?:church\s+)?session/i.test(text)) return null;

  const bpmMatch = text.match(/(?:at|tempo|bpm(?:\s+to)?)\s*(\d+(?:\.\d+)?)\s*bpm?/i);
  const sceneMatch = text.match(/(?:make|create|add)\s+(.+?)\s+scenes?/i);

  const commands = [];
  if (bpmMatch) commands.push(command("set_tempo", { bpm: Number(bpmMatch[1]) }));

  DEFAULT_CHURCH_TRACKS.forEach(([kind, name]) => {
    commands.push(command("create_track", { kind, name, index: -1 }));
  });

  if (sceneMatch) {
    splitSections(sceneMatch[1]).forEach((name) => {
      commands.push(command("create_scene", { name, index: -1 }));
    });
  }

  return newPlan(
    text,
    "Build church session",
    commands,
    0.94,
    ["Creates the standard Luma church track layout."]
  );
}

function parseSimple(text) {
  const input = text.trim();
  let match;

  match = input.match(/^(?:set\s+)?(?:tempo|bpm)(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*(?:bpm)?$/i);
  if (match) return newPlan(text, "Set tempo", [command("set_tempo", { bpm: Number(match[1]) })]);

  match = input.match(/^(?:set\s+)?(?:meter|time\s+signature)(?:\s+to)?\s+(\d+)\s*\/\s*(\d+)$/i);
  if (match) {
    return newPlan(text, "Set meter", [
      command("set_meter", { numerator: Number(match[1]), denominator: Number(match[2]) })
    ]);
  }

  match = input.match(/^create\s+(midi|audio)\s+track(?:\s+(?:called|named))?\s+(.+)$/i);
  if (match) {
    return newPlan(text, "Create track", [
      command("create_track", { kind: match[1].toLowerCase(), name: titleCase(match[2]), index: -1 })
    ]);
  }

  match = input.match(/^create\s+track(?:\s+(?:called|named))?\s+(.+)$/i);
  if (match) {
    return newPlan(text, "Create audio track", [
      command("create_track", { kind: "audio", name: titleCase(match[1]), index: -1 })
    ], 0.85, ["Unspecified track type defaults to audio."]);
  }

  match = input.match(/^rename\s+track\s+(.+?)\s+to\s+(.+)$/i);
  if (match) {
    return newPlan(text, "Rename track", [
      command("rename_track", { track: refFromText(match[1]), name: titleCase(match[2]) })
    ]);
  }

  match = input.match(/^create\s+scene(?:\s+(?:called|named))?\s+(.+)$/i);
  if (match) {
    return newPlan(text, "Create scene", [
      command("create_scene", { name: titleCase(match[1]), index: -1 })
    ]);
  }

  match = input.match(/^rename\s+scene\s+(.+?)\s+to\s+(.+)$/i);
  if (match) {
    return newPlan(text, "Rename scene", [
      command("rename_scene", { scene: refFromText(match[1]), name: titleCase(match[2]) })
    ]);
  }

  match = input.match(/^(?:launch|fire|go\s+to|play)\s+(?:scene\s+)?(.+)$/i);
  if (match) {
    return newPlan(text, "Launch scene", [
      command("fire_scene", { scene: refFromText(match[1]) })
    ]);
  }

  if (/^(?:stop\s+all|stop\s+all\s+clips|panic)$/i.test(input)) {
    return newPlan(text, "Stop all clips", [command("stop_all_clips", {})]);
  }

  match = input.match(/^(mute|unmute)\s+(?:track\s+)?(.+)$/i);
  if (match) {
    return newPlan(text, titleCase(match[1]) + " track", [
      command("set_track_mute", {
        track: refFromText(match[2]),
        value: match[1].toLowerCase() === "mute"
      })
    ]);
  }

  match = input.match(/^(solo|unsolo)\s+(?:track\s+)?(.+)$/i);
  if (match) {
    return newPlan(text, titleCase(match[1]) + " track", [
      command("set_track_solo", {
        track: refFromText(match[2]),
        value: match[1].toLowerCase() === "solo"
      })
    ]);
  }

  match = input.match(/^set\s+(?:track\s+)?(.+?)\s+volume\s+to\s+(\d+(?:\.\d+)?)\s*%$/i);
  if (match) {
    return newPlan(text, "Set track volume", [
      command("set_track_volume", {
        track: refFromText(match[1]),
        value: Math.min(1, Number(match[2]) / 100)
      })
    ]);
  }

  return null;
}

function parseText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Type a command first");
  }
  if (text.length > 4000) throw new Error("Command is too long");

  const parsers = [parseSongBuild, parseChurchSession, parseSimple];
  for (const parser of parsers) {
    const plan = parser(text.trim());
    if (plan) return plan;
  }

  throw new Error(
    "I could not safely map that sentence to the current command allowlist. Try a more explicit command."
  );
}

module.exports = {
  parseText,
  splitSections,
  refFromText,
  DEFAULT_CHURCH_TRACKS
};
