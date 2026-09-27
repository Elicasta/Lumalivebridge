"use strict";

function barOffsetToBeats(bar, meter) {
  const numerator = Number(meter && meter.numerator || 4);
  return Math.max(0, Number(bar || 1) - 1) * numerator;
}

function buildArrangement(setlist, songsById, options = {}) {
  const gapBars = Number.isInteger(setlist.gapBars) ? setlist.gapBars : 4;
  const startBeat = Number(options.startBeat || 0);
  let cursor = Math.max(0, startBeat);
  const songs = [];
  const markers = [];

  for (let index = 0; index < setlist.items.length; index += 1) {
    const item = setlist.items[index];
    const song = songsById[item.songId];
    if (!song) throw new Error('Missing song "' + item.songId + '"');

    const beatsPerBar = Number(song.meter && song.meter.numerator || 4);
    const songLengthBeats = Number(song.lengthBars) * beatsPerBar;
    const placement = {
      instanceId: item.id,
      songId: song.id,
      title: song.title,
      artist: song.artist || "",
      bpm: Number(song.bpm),
      key: song.key || "",
      meter: song.meter,
      startBeat: cursor,
      endBeat: cursor + songLengthBeats,
      sections: []
    };

    markers.push({
      time: cursor,
      name: "LL|SONG|" + song.id + "|" + song.title,
      kind: "song",
      songId: song.id
    });

    for (const section of song.sections) {
      const absoluteBeat = cursor + barOffsetToBeats(section.startBar, song.meter);
      const placed = {
        id: section.id,
        name: section.name,
        localStartBar: section.startBar,
        startBeat: absoluteBeat
      };
      placement.sections.push(placed);
      markers.push({
        time: absoluteBeat,
        name: "LL|SECTION|" + song.id + "|" + section.id + "|" + section.name,
        kind: "section",
        songId: song.id,
        sectionId: section.id
      });
    }

    songs.push(placement);
    cursor = placement.endBeat + Math.max(0, gapBars) * beatsPerBar;
  }

  return {
    schemaVersion: 1,
    setlistId: setlist.id,
    title: setlist.title,
    startBeat,
    endBeat: cursor,
    songs,
    markers
  };
}

function locatePosition(arrangement, beat) {
  if (!arrangement || !Array.isArray(arrangement.songs)) return null;
  const time = Number(beat);
  if (!Number.isFinite(time)) return null;

  let song = null;
  for (let i = 0; i < arrangement.songs.length; i += 1) {
    const candidate = arrangement.songs[i];
    const next = arrangement.songs[i + 1];
    if (time >= candidate.startBeat && (!next || time < next.startBeat)) {
      song = candidate;
      break;
    }
  }
  if (!song) return null;

  let section = null;
  let nextSection = null;
  for (let i = 0; i < song.sections.length; i += 1) {
    if (time >= song.sections[i].startBeat) section = song.sections[i];
    if (time < song.sections[i].startBeat) {
      nextSection = song.sections[i];
      break;
    }
  }

  return {
    songId: song.songId,
    songTitle: song.title,
    songIndex: arrangement.songs.indexOf(song),
    bpm: song.bpm,
    key: song.key,
    meter: song.meter,
    sectionId: section ? section.id : null,
    sectionName: section ? section.name : null,
    nextSectionId: nextSection ? nextSection.id : null,
    nextSectionName: nextSection ? nextSection.name : null
  };
}

function findJumpTarget(arrangement, songId, sectionId) {
  if (!arrangement) throw new Error("No active arrangement");
  const song = arrangement.songs.find((item) => item.songId === songId);
  if (!song) throw new Error("Song is not in the active setlist");

  if (!sectionId) {
    return { time: song.startBeat, song };
  }

  const section = song.sections.find((item) => item.id === sectionId);
  if (!section) throw new Error("Section is not in that song");
  return { time: section.startBeat, song, section };
}

module.exports = {
  barOffsetToBeats,
  buildArrangement,
  locatePosition,
  findJumpTarget
};
