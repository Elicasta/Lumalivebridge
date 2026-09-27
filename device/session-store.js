"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCHEMA_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function emptyLibrary() {
  return {
    schemaVersion: SCHEMA_VERSION,
    songs: [],
    setlists: [],
    updatedAt: null
  };
}

class SessionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = emptyLibrary();
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.data = {
        ...emptyLibrary(),
        ...parsed,
        songs: Array.isArray(parsed.songs) ? parsed.songs : [],
        setlists: Array.isArray(parsed.setlists) ? parsed.setlists : []
      };
    } catch (_) {
      this.data = emptyLibrary();
    }
    return this.snapshot();
  }

  persist() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    this.data.updatedAt = new Date().toISOString();
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  snapshot() {
    return clone(this.data);
  }

  findSong(ref) {
    const target = ref || {};
    let song = null;

    if (target.id) {
      song = this.data.songs.find((item) => item.id === target.id) || null;
    } else if (target.name) {
      const needle = normalizeText(target.name);
      song = this.data.songs.find((item) => normalizeText(item.title) === needle) || null;
    }

    if (!song) {
      const label = target.id || target.name || "unknown";
      throw new Error('Song "' + label + '" was not found in the Luma library');
    }

    return clone(song);
  }

  upsertSong(args) {
    const now = new Date().toISOString();
    const existingIndex = this.data.songs.findIndex(
      (item) => normalizeText(item.title) === normalizeText(args.title)
    );
    const previous = existingIndex >= 0 ? this.data.songs[existingIndex] : null;

    const song = {
      id: previous ? previous.id : "song-" + crypto.randomUUID(),
      title: args.title,
      bpm: args.bpm == null ? null : args.bpm,
      meter: args.meter || null,
      key: args.key || null,
      tracks: previous && Array.isArray(previous.tracks) ? previous.tracks : [],
      sections: (args.sections || []).map((section, index) => ({
        id:
          previous &&
          previous.sections &&
          previous.sections[index] &&
          previous.sections[index].id
            ? previous.sections[index].id
            : "section-" + crypto.randomUUID(),
        name: section.name,
        repeat: section.repeat || 1,
        bars: section.bars == null ? null : section.bars
      })),
      arrangements: previous && Array.isArray(previous.arrangements) ? previous.arrangements : [],
      createdAt: previous ? previous.createdAt : now,
      updatedAt: now
    };

    if (existingIndex >= 0) this.data.songs[existingIndex] = song;
    else this.data.songs.push(song);

    this.data.songs.sort((a, b) => a.title.localeCompare(b.title));
    this.persist();

    return {
      mutation: "song_saved",
      created: existingIndex < 0,
      song: clone(song)
    };
  }

  buildSongCommands(song) {
    const commands = [];

    if (song.bpm != null) {
      commands.push({ type: "set_tempo", args: { bpm: song.bpm } });
    }

    if (song.meter) {
      commands.push({
        type: "set_meter",
        args: {
          numerator: song.meter.numerator,
          denominator: song.meter.denominator
        }
      });
    }

    for (const section of song.sections || []) {
      const repeat = Math.max(1, Number(section.repeat) || 1);
      for (let index = 0; index < repeat; index += 1) {
        const name = repeat > 1 ? section.name + " " + (index + 1) : section.name;
        commands.push({
          type: "create_scene",
          args: { name, index: -1 }
        });
      }
    }

    return commands;
  }

  apply(command) {
    switch (command.type) {
      case "create_song":
        return this.upsertSong(command.args);

      case "load_song": {
        const song = this.findSong(command.args.song);
        return {
          mutation: null,
          song,
          liveCommands: this.buildSongCommands(song)
        };
      }

      default:
        throw new Error("unsupported local command type: " + command.type);
    }
  }
}

module.exports = {
  SessionStore,
  emptyLibrary
};
