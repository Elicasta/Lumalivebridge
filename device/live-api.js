autowatch = 1;
outlets = 1;

function asScalar(value, property) {
  if (value instanceof Array) {
    if (value.length === 0) return null;
    if (value.length === 1) return value[0];
    if (value[0] === property) return value[1];
    return value[value.length - 1];
  }
  return value;
}

function getProp(api, property) {
  return asScalar(api.get(property), property);
}

function live(path) {
  return new LiveAPI(path);
}

function count(child) {
  var set = live("live_set");
  return Number(set.getcount(child)) || 0;
}

function targetIndex(kind, target) {
  var total = count(kind);
  if (target && target.index !== undefined) {
    var index = Number(target.index);
    if (index < 0 || index >= total) throw new Error(kind + " index out of range");
    return index;
  }

  if (target && target.name) {
    var needle = String(target.name).toLowerCase();
    for (var i = 0; i < total; i++) {
      var api = live("live_set " + kind + " " + i);
      var name = String(getProp(api, "name") || "").toLowerCase();
      if (name === needle) return i;
    }
    throw new Error(kind + ' named "' + target.name + '" was not found');
  }

  throw new Error("missing " + kind + " target");
}

function setName(path, name) {
  live(path).set("name", String(name));
}

function sceneState() {
  var scenes = [];
  var sceneCount = count("scenes");
  for (var i = 0; i < sceneCount; i++) {
    var scene = live("live_set scenes " + i);
    scenes.push({
      index: i,
      number: i + 1,
      name: String(getProp(scene, "name") || "Scene " + (i + 1))
    });
  }
  return scenes;
}

function cuePointState() {
  var points = [];
  var total = count("cue_points");
  for (var i = 0; i < total; i++) {
    var cue = live("live_set cue_points " + i);
    points.push({
      index: i,
      name: String(getProp(cue, "name") || ""),
      time: Number(getProp(cue, "time"))
    });
  }
  return points;
}

function findCuePointAt(time, tolerance) {
  var points = cuePointState();
  var limit = tolerance === undefined ? 0.001 : Number(tolerance);
  for (var i = 0; i < points.length; i++) {
    if (Math.abs(points[i].time - Number(time)) <= limit) return points[i];
  }
  return null;
}

function clearLumaCuePoints() {
  var set = live("live_set");
  var saved = Number(getProp(set, "current_song_time"));
  var points = cuePointState().filter(function (point) {
    return point.name.indexOf("LL|") === 0;
  });

  for (var i = points.length - 1; i >= 0; i--) {
    set.set("current_song_time", points[i].time);
    set.call("set_or_delete_cue");
  }

  set.set("current_song_time", saved);
  return points.length;
}

function ensureLumaCuePoint(time, name) {
  var set = live("live_set");
  var saved = Number(getProp(set, "current_song_time"));
  var existing = findCuePointAt(time, 0.001);

  if (existing) {
    if (existing.name.indexOf("LL|") === 0) {
      setName("live_set cue_points " + existing.index, name);
      return { created: false, renamed: true, skipped: false };
    }
    return {
      created: false,
      renamed: false,
      skipped: true,
      reason: "existing non-Luma locator at the same time"
    };
  }

  set.set("current_song_time", Number(time));
  set.call("set_or_delete_cue");

  var created = findCuePointAt(time, 0.01);
  if (!created) {
    set.set("current_song_time", saved);
    throw new Error("Ableton did not create the locator");
  }

  setName("live_set cue_points " + created.index, name);
  set.set("current_song_time", saved);
  return { created: true, renamed: false, skipped: false };
}

function trackState() {
  var tracks = [];
  var trackCount = count("tracks");
  for (var i = 0; i < trackCount; i++) {
    var track = live("live_set tracks " + i);
    var volume = live("live_set tracks " + i + " mixer_device volume");
    tracks.push({
      index: i,
      number: i + 1,
      name: String(getProp(track, "name") || "Track " + (i + 1)),
      mute: Number(getProp(track, "mute")) === 1,
      solo: Number(getProp(track, "solo")) === 1,
      volume: Number(getProp(volume, "value")),
      playingSlotIndex: Number(getProp(track, "playing_slot_index"))
    });
  }
  return tracks;
}

function snapshot() {
  var set = live("live_set");
  var tracks = trackState();
  var activeScene = null;

  for (var i = 0; i < tracks.length; i++) {
    if (tracks[i].playingSlotIndex >= 0) {
      activeScene = tracks[i].playingSlotIndex;
      break;
    }
  }

  return {
    tempo: Number(getProp(set, "tempo")),
    meter: {
      numerator: Number(getProp(set, "signature_numerator")),
      denominator: Number(getProp(set, "signature_denominator"))
    },
    isPlaying: Number(getProp(set, "is_playing")) === 1,
    metronome: Number(getProp(set, "metronome")) === 1,
    currentSongTime: Number(getProp(set, "current_song_time")),
    activeSceneIndex: activeScene,
    scenes: sceneState(),
    tracks: tracks
  };
}

function result(requestId, ok, extra) {
  var payload = {
    requestId: requestId,
    ok: !!ok
  };

  if (extra) {
    for (var key in extra) payload[key] = extra[key];
  }

  outlet(0, "result_json", JSON.stringify(payload));
}

function pushState() {
  outlet(0, "state_json", JSON.stringify(snapshot()));
}

function execute(command) {
  var set = live("live_set");
  var args = command.args || {};
  var type = command.type;

  if (type === "get_state") {
    return { state: snapshot() };
  }

  if (type === "create_track") {
    var before = count("tracks");
    var index = args.index === undefined ? -1 : Number(args.index);
    if (args.kind === "midi") set.call("create_midi_track", index);
    else if (args.kind === "audio") set.call("create_audio_track", index);
    else throw new Error("unsupported track kind");

    var createdIndex = index === -1 ? before : index;
    setName("live_set tracks " + createdIndex, args.name);
    return { createdIndex: createdIndex };
  }

  if (type === "rename_track") {
    var renameTrack = targetIndex("tracks", args.track);
    setName("live_set tracks " + renameTrack, args.name);
    return { trackIndex: renameTrack };
  }

  if (type === "create_scene") {
    var sceneBefore = count("scenes");
    var sceneIndex = args.index === undefined ? -1 : Number(args.index);
    set.call("create_scene", sceneIndex);
    var createdScene = sceneIndex === -1 ? sceneBefore : sceneIndex;
    setName("live_set scenes " + createdScene, args.name);
    return { createdIndex: createdScene };
  }

  if (type === "rename_scene") {
    var renameScene = targetIndex("scenes", args.scene);
    setName("live_set scenes " + renameScene, args.name);
    return { sceneIndex: renameScene };
  }

  if (type === "set_tempo") {
    set.set("tempo", Number(args.bpm));
    return { bpm: Number(args.bpm) };
  }

  if (type === "set_meter") {
    set.set("signature_numerator", Number(args.numerator));
    set.set("signature_denominator", Number(args.denominator));
    return {
      numerator: Number(args.numerator),
      denominator: Number(args.denominator)
    };
  }

  if (type === "start_playback") {
    set.call("start_playing");
    return {};
  }

  if (type === "stop_playback") {
    set.call("stop_playing");
    return {};
  }

  if (type === "set_metronome") {
    set.set("metronome", args.enabled ? 1 : 0);
    return { enabled: !!args.enabled };
  }

  if (type === "fire_scene") {
    var fireIndex = targetIndex("scenes", args.scene);
    live("live_set scenes " + fireIndex).call("fire");
    return { sceneIndex: fireIndex };
  }

  if (type === "stop_all_clips") {
    set.call("stop_all_clips");
    return {};
  }

  if (type === "create_midi_clip") {
    var clipTrack = targetIndex("tracks", args.track);
    var clipScene = targetIndex("scenes", args.scene);
    var slot = live("live_set tracks " + clipTrack + " clip_slots " + clipScene);
    if (Number(getProp(slot, "has_clip")) === 1) {
      throw new Error("target clip slot already contains a clip");
    }
    slot.call("create_clip", Number(args.lengthBeats));
    if (args.name) {
      setName("live_set tracks " + clipTrack + " clip_slots " + clipScene + " clip", args.name);
    }
    return { trackIndex: clipTrack, sceneIndex: clipScene };
  }

  if (type === "duplicate_clip") {
    var duplicateTrack = targetIndex("tracks", args.track);
    var duplicateScene = targetIndex("scenes", args.sourceScene);
    live("live_set tracks " + duplicateTrack).call("duplicate_clip_slot", duplicateScene);
    return { trackIndex: duplicateTrack, sourceSceneIndex: duplicateScene };
  }

  if (type === "set_clip_loop") {
    var loopTrack = targetIndex("tracks", args.track);
    var loopScene = targetIndex("scenes", args.scene);
    var clipPath = "live_set tracks " + loopTrack + " clip_slots " + loopScene + " clip";
    var clip = live(clipPath);
    clip.set("looping", args.enabled ? 1 : 0);
    if (args.start !== undefined) clip.set("loop_start", Number(args.start));
    if (args.end !== undefined) clip.set("loop_end", Number(args.end));
    return { trackIndex: loopTrack, sceneIndex: loopScene };
  }

  if (type === "set_track_volume") {
    var volumeTrack = targetIndex("tracks", args.track);
    live("live_set tracks " + volumeTrack + " mixer_device volume").set("value", Number(args.value));
    return { trackIndex: volumeTrack, value: Number(args.value) };
  }

  if (type === "set_track_mute") {
    var muteTrack = targetIndex("tracks", args.track);
    live("live_set tracks " + muteTrack).set("mute", args.value ? 1 : 0);
    return { trackIndex: muteTrack, value: !!args.value };
  }

  if (type === "set_track_solo") {
    var soloTrack = targetIndex("tracks", args.track);
    live("live_set tracks " + soloTrack).set("solo", args.value ? 1 : 0);
    return { trackIndex: soloTrack, value: !!args.value };
  }

  if (type === "sync_cue_points") {
    var removed = args.replace ? clearLumaCuePoints() : 0;
    var createdCount = 0;
    var renamedCount = 0;
    var skipped = [];

    for (var pointIndex = 0; pointIndex < args.points.length; pointIndex++) {
      var point = args.points[pointIndex];
      var cueResult = ensureLumaCuePoint(Number(point.time), String(point.name));
      if (cueResult.created) createdCount += 1;
      if (cueResult.renamed) renamedCount += 1;
      if (cueResult.skipped) {
        skipped.push({
          time: Number(point.time),
          name: String(point.name),
          reason: cueResult.reason
        });
      }
    }

    return {
      removed: removed,
      created: createdCount,
      renamed: renamedCount,
      skipped: skipped
    };
  }

  if (type === "jump_to_time") {
    set.set("current_song_time", Number(args.time));
    return { time: Number(args.time) };
  }

  throw new Error("unsupported command type: " + type);
}

function command_json(payload) {
  var packet;
  try {
    packet = JSON.parse(String(payload));
    if (!packet || !packet.command || !packet.requestId) {
      throw new Error("invalid command packet");
    }

    var data = execute(packet.command);
    result(packet.requestId, true, data || {});
    if (packet.command.type !== "get_state") pushState();
  } catch (error) {
    var requestId = packet && packet.requestId ? packet.requestId : "unknown";
    result(requestId, false, { error: String(error.message || error) });
  }
}
