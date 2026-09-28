autowatch = 1;
outlets = 1;

var serviceTimeline = { songs: [], transitions: [] };
var serviceTimelineTask = null;
var serviceTimelineSongIndex = -1;
var serviceTimelineVampIndex = -1;
var serviceTimelineHolds = {};
var queuedJumpTask = null;
var queuedJump = null;

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

function findTrackByName(name) {
  var needle = String(name || "").toLowerCase();
  var total = count("tracks");
  for (var i = 0; i < total; i++) {
    var api = live("live_set tracks " + i);
    if (String(getProp(api, "name") || "").toLowerCase() === needle) return i;
  }
  return -1;
}

function ensureTrack(kind, name) {
  var existing = findTrackByName(name);
  if (existing >= 0) return existing;

  var set = live("live_set");
  var before = count("tracks");
  if (kind === "midi") set.call("create_midi_track", -1);
  else set.call("create_audio_track", -1);
  setName("live_set tracks " + before, name);
  return before;
}

function arrangementClipAt(trackIndex, position) {
  var track = live("live_set tracks " + trackIndex);
  var total = Number(track.getcount("arrangement_clips")) || 0;
  for (var i = total - 1; i >= 0; i--) {
    var clip = live("live_set tracks " + trackIndex + " arrangement_clips " + i);
    var start = Number(getProp(clip, "start_time"));
    if (Math.abs(start - Number(position)) <= 0.01) return clip;
  }
  return null;
}

function clearLumaArrangement() {
  var removed = 0;
  var trackCount = count("tracks");
  for (var t = 0; t < trackCount; t++) {
    var track = live("live_set tracks " + t);
    var total = Number(track.getcount("arrangement_clips")) || 0;
    for (var i = total - 1; i >= 0; i--) {
      var clip = live("live_set tracks " + t + " arrangement_clips " + i);
      var name = String(getProp(clip, "name") || "");
      if (name.indexOf("LL|") !== 0) continue;
      track.call("delete_clip", "id " + Number(clip.id));
      removed += 1;
    }
  }
  return removed;
}

function trackState() {
  var tracks = [];
  var trackCount = count("tracks");
  for (var i = 0; i < trackCount; i++) {
    var track = live("live_set tracks " + i);
    tracks.push({
      index: i,
      number: i + 1,
      name: String(getProp(track, "name") || "Track " + (i + 1)),
      mute: Number(getProp(track, "mute")) === 1,
      solo: Number(getProp(track, "solo")) === 1,
      volume: Number(getProp(live("live_set tracks " + i + " mixer_device volume"), "value")),
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

function cancelQueuedJump() {
  if (queuedJumpTask) {
    try { queuedJumpTask.cancel(); } catch (_) {}
    queuedJumpTask = null;
  }
  queuedJump = null;
}

function runQueuedJump() {
  if (!queuedJump) return;
  try {
    var set = live("live_set");
    var playing = Number(getProp(set, "is_playing")) === 1;
    if (!playing) {
      var stoppedTarget = queuedJump.target;
      cancelQueuedJump();
      releaseServiceLoop();
      set.set("current_song_time", stoppedTarget);
      pushState();
      return;
    }

    var now = Number(getProp(set, "current_song_time"));
    if (now + 0.012 >= queuedJump.boundary) {
      var target = queuedJump.target;
      cancelQueuedJump();
      releaseServiceLoop();
      set.set("current_song_time", target);
      pushState();
    }
  } catch (_) {
    cancelQueuedJump();
  }
}

function queueJumpToTime(args) {
  var set = live("live_set");
  var target = Number(args.time);
  var origin = Number(args.origin);
  var bar = Number(args.beatsPerBar);

  if (Number(getProp(set, "is_playing")) !== 1) {
    releaseServiceLoop();
    set.set("current_song_time", target);
    pushState();
    return { queued: false, time: target };
  }

  var now = Number(getProp(set, "current_song_time"));
  var relative = Math.max(0, now - origin);
  var nextBar = Math.floor((relative + 0.0001) / bar) + 1;
  var boundary = origin + nextBar * bar;

  cancelQueuedJump();
  queuedJump = { target: target, boundary: boundary };
  queuedJumpTask = new Task(runQueuedJump, this);
  queuedJumpTask.interval = 10;
  queuedJumpTask.repeat();
  return { queued: true, time: target, boundary: boundary };
}

function stopServiceTimelineTask() {
  if (serviceTimelineTask) {
    try { serviceTimelineTask.cancel(); } catch (_) {}
    serviceTimelineTask = null;
  }
}

function serviceSongAt(time) {
  var index = -1;
  for (var i = 0; i < serviceTimeline.songs.length; i++) {
    if (Number(time) + 0.0001 >= Number(serviceTimeline.songs[i].startBeat)) index = i;
    else break;
  }
  return index;
}

function releaseServiceLoop() {
  var set = live("live_set");
  try { set.set("loop", 0); } catch (_) {}
  serviceTimelineVampIndex = -1;
}

function runServiceTimeline() {
  if (!serviceTimeline.songs.length) return;
  try {
    var set = live("live_set");
    var time = Number(getProp(set, "current_song_time"));
    var songIndex = serviceSongAt(time);

    if (songIndex >= 0 && songIndex !== serviceTimelineSongIndex) {
      var song = serviceTimeline.songs[songIndex];
      set.set("tempo", Number(song.bpm));
      set.set("signature_numerator", Number(song.numerator));
      set.set("signature_denominator", Number(song.denominator));
      serviceTimelineSongIndex = songIndex;
      if (serviceTimelineVampIndex >= 0) releaseServiceLoop();
    }

    for (var i = 0; i < serviceTimeline.transitions.length; i++) {
      var transition = serviceTimeline.transitions[i];
      if (transition.mode !== "vamp") continue;
      var loopStart = Number(transition.vampStartBeat);
      var loopEnd = Number(transition.vampEndBeat);
      if (!isFinite(loopStart) || !isFinite(loopEnd) || loopEnd <= loopStart) continue;
      if (time + 0.01 >= loopStart && time < loopEnd && serviceTimelineVampIndex !== i) {
        set.set("loop_start", loopStart);
        set.set("loop_length", loopEnd - loopStart);
        set.set("loop", 1);
        serviceTimelineVampIndex = i;
      }
    }

    if (Number(getProp(set, "is_playing")) !== 1) return;

    for (var h = 0; h < serviceTimeline.transitions.length; h++) {
      var hold = serviceTimeline.transitions[h];
      if (hold.mode !== "hold" || serviceTimelineHolds[h]) continue;
      var trigger = Number(hold.triggerBeat);
      var nextStart = Number(hold.nextStartBeat);
      if (!isFinite(trigger) || !isFinite(nextStart)) continue;
      if (time + 0.015 >= trigger && time < trigger + 0.5) {
        set.call("stop_playing");
        set.set("current_song_time", nextStart);
        serviceTimelineHolds[h] = 1;
        pushState();
        break;
      }
    }
  } catch (_) {}
}

function configureServiceTimeline(args) {
  serviceTimeline = {
    songs: (args.songs || []).slice().sort(function(a, b) { return Number(a.startBeat) - Number(b.startBeat); }),
    transitions: (args.transitions || []).slice()
  };
  serviceTimelineSongIndex = -1;
  serviceTimelineVampIndex = -1;
  serviceTimelineHolds = {};
  releaseServiceLoop();
  stopServiceTimelineTask();

  if (serviceTimeline.songs.length) {
    serviceTimelineTask = new Task(runServiceTimeline, this);
    serviceTimelineTask.interval = 20;
    serviceTimelineTask.repeat();
    runServiceTimeline();
  }
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

  if (type === "refresh_session") {
    return { state: snapshot() };
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
    cancelQueuedJump();
    releaseServiceLoop();
    set.set("current_song_time", Number(args.time));
    return { time: Number(args.time) };
  }

  if (type === "queue_jump_to_time") {
    return queueJumpToTime(args);
  }

  if (type === "ensure_track") {
    var ensuredIndex = ensureTrack(args.kind, args.name);
    return { trackIndex: ensuredIndex };
  }

  if (type === "clear_luma_arrangement") {
    return { removed: clearLumaArrangement() };
  }

  if (type === "create_arrangement_audio_clip") {
    var arrangementTrack = targetIndex("tracks", args.track);
    var arrangementTrackApi = live("live_set tracks " + arrangementTrack);
    arrangementTrackApi.call("create_audio_clip", String(args.filePath), Number(args.position));
    var createdArrangementClip = arrangementClipAt(arrangementTrack, args.position);
    if (!createdArrangementClip) throw new Error("Ableton did not create the Arrangement audio clip");
    createdArrangementClip.set("name", String(args.name));
    var transposeSemitones = Number(args.transposeSemitones || 0);
    if (transposeSemitones !== 0) {
      try { createdArrangementClip.set("pitch_coarse", transposeSemitones); } catch (_) {}
    }
    return {
      trackIndex: arrangementTrack,
      position: Number(args.position),
      transposeSemitones: transposeSemitones
    };
  }

  if (type === "create_arrangement_midi_clip") {
    var midiArrangementTrack = targetIndex("tracks", args.track);
    var midiTrackApi = live("live_set tracks " + midiArrangementTrack);
    midiTrackApi.call("create_midi_clip", Number(args.position), Number(args.lengthBeats));
    var createdMidiClip = arrangementClipAt(midiArrangementTrack, args.position);
    if (!createdMidiClip) throw new Error("Ableton did not create the Arrangement MIDI clip");
    createdMidiClip.set("name", String(args.name));
    return {
      trackIndex: midiArrangementTrack,
      position: Number(args.position),
      lengthBeats: Number(args.lengthBeats)
    };
  }

  if (type === "configure_service_timeline") {
    configureServiceTimeline(args);
    return { songs: args.songs.length, transitions: args.transitions.length };
  }

  if (type === "set_arrangement_loop") {
    set.set("loop_start", Number(args.start));
    set.set("loop_length", Number(args.length));
    set.set("loop", args.enabled ? 1 : 0);
    return { enabled: !!args.enabled, start: Number(args.start), length: Number(args.length) };
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
