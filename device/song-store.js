"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function asInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMeter(input) {
  const source = input && typeof input === "object" ? input : {};
  const numerator = asInt(source.numerator, 4);
  const denominator = asInt(source.denominator, 4);
  if (numerator < 1 || numerator > 32) throw new Error("meter numerator must be 1..32");
  if (![1, 2, 4, 8, 16].includes(denominator)) throw new Error("meter denominator is invalid");
  return { numerator, denominator };
}

function normalizeSections(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("song needs at least one section");
  }
  const used = new Set();
  return input.map((raw, index) => {
    const name = String(raw && raw.name || "").trim();
    if (!name) throw new Error("section " + (index + 1) + " needs a name");
    const startBar = asInt(raw.startBar, NaN);
    if (!Number.isInteger(startBar) || startBar < 1) {
      throw new Error(name + " startBar must be an integer >= 1");
    }
    let id = slug(raw.id || name);
    if (used.has(id)) id += "-" + (index + 1);
    used.add(id);
    return { id, name: name.slice(0, 120), startBar };
  }).sort((a, b) => a.startBar - b.startBar);
}

function normalizeSong(input, fallbackId) {
  const title = String(input && input.title || "").trim();
  if (!title) throw new Error("song title is required");
  const bpm = asNumber(input.bpm, 120);
  if (bpm < 20 || bpm > 999) throw new Error("song BPM must be between 20 and 999");
  const lengthBars = asInt(input.lengthBars, NaN);
  if (!Number.isInteger(lengthBars) || lengthBars < 1 || lengthBars > 10000) {
    throw new Error("song lengthBars must be between 1 and 10000");
  }
  const sections = normalizeSections(input.sections);
  if (sections[sections.length - 1].startBar > lengthBars) {
    throw new Error("a section starts after the end of the song");
  }

  return {
    schemaVersion: 1,
    id: slug(input.id || fallbackId || title),
    title: title.slice(0, 160),
    artist: String(input.artist || "").trim().slice(0, 160),
    bpm,
    key: String(input.key || "").trim().slice(0, 32),
    meter: normalizeMeter(input.meter),
    lengthBars,
    sections,
    cues: Array.isArray(input.cues) ? input.cues.slice(0, 500) : [],
    updatedAt: new Date().toISOString()
  };
}

function normalizeSetlist(input, fallbackId) {
  const title = String(input && input.title || "").trim();
  if (!title) throw new Error("setlist title is required");
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length > 100) throw new Error("setlist is too large");

  const items = rawItems.map((item) => {
    const songId = slug(item && item.songId);
    if (!songId) throw new Error("setlist item is missing songId");
    return {
      id: String(item.id || crypto.randomUUID()),
      songId
    };
  });

  return {
    schemaVersion: 1,
    id: slug(input.id || fallbackId || title),
    title: title.slice(0, 160),
    gapBars: Math.max(0, Math.min(64, asInt(input.gapBars, 4))),
    items,
    updatedAt: new Date().toISOString()
  };
}

function safeRead(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function createStore(baseDir) {
  const songsDir = path.join(baseDir, "songs");
  const setlistsDir = path.join(baseDir, "setlists");
  const activeFile = path.join(baseDir, "active-setlist.json");
  fs.mkdirSync(songsDir, { recursive: true });
  fs.mkdirSync(setlistsDir, { recursive: true });

  function listJson(dir) {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => safeRead(path.join(dir, name), null))
      .filter(Boolean);
  }

  function getSong(id) {
    return safeRead(path.join(songsDir, slug(id) + ".json"), null);
  }

  function listSongs() {
    return listJson(songsDir).sort((a, b) => a.title.localeCompare(b.title));
  }

  function saveSong(input) {
    let id = slug(input.id || input.title);
    const existing = getSong(id);
    if (!input.id && existing && existing.title !== String(input.title || "").trim()) {
      id += "-" + crypto.randomUUID().slice(0, 8);
    }
    const song = normalizeSong(input, id);
    atomicWrite(path.join(songsDir, song.id + ".json"), song);
    return song;
  }

  function deleteSong(id) {
    const file = path.join(songsDir, slug(id) + ".json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  function getSetlist(id) {
    return safeRead(path.join(setlistsDir, slug(id) + ".json"), null);
  }

  function listSetlists() {
    return listJson(setlistsDir).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function saveSetlist(input) {
    const setlist = normalizeSetlist(input, input.id || input.title);
    for (const item of setlist.items) {
      if (!getSong(item.songId)) throw new Error('song "' + item.songId + '" is not in the library');
    }
    atomicWrite(path.join(setlistsDir, setlist.id + ".json"), setlist);
    return setlist;
  }

  function deleteSetlist(id) {
    const file = path.join(setlistsDir, slug(id) + ".json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const active = getActiveSetlistId();
    if (active === slug(id)) setActiveSetlistId(null);
  }

  function getActiveSetlistId() {
    const value = safeRead(activeFile, {});
    return value && value.id ? String(value.id) : null;
  }

  function setActiveSetlistId(id) {
    atomicWrite(activeFile, { id: id ? slug(id) : null, updatedAt: new Date().toISOString() });
  }

  return {
    listSongs,
    getSong,
    saveSong,
    deleteSong,
    listSetlists,
    getSetlist,
    saveSetlist,
    deleteSetlist,
    getActiveSetlistId,
    setActiveSetlistId
  };
}

module.exports = {
  slug,
  normalizeSong,
  normalizeSetlist,
  createStore
};
