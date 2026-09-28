(() => {
  "use strict";

  const invoke = window.__TAURI__.core.invoke;
  const $ = (id) => document.getElementById(id);

  const state = {
    songs: [],
    setlists: [],
    activeSetlistId: null,
    live: null,
    runtime: null,
    editingSongId: null,
    editingSetlistId: null,
    draftItems: [],
    plan: null
  };

  const titles = {
    song: ["LIVE", "Song Control"],
    busk: ["SESSION", "Busk"],
    library: ["LIBRARY", "Songs"],
    setlists: ["SERVICES", "Setlists"],
    command: ["CONTROL", "Command"],
    settings: ["SYSTEM", "Settings"]
  };

  function showError(message) {
    const box = $("error");
    box.textContent = message || "";
    box.hidden = !message;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : "item-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function go(page) {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
    document.querySelectorAll(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
    $("pageEyebrow").textContent = titles[page][0];
    $("pageTitle").textContent = titles[page][1];
  }

  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => go(item.dataset.page)));

  function activeSetlist() {
    return state.setlists.find((item) => item.id === state.activeSetlistId) || null;
  }

  function activePlacement() {
    const ctx = state.live && state.live.liveContext;
    const arrangement = state.live && state.live.arrangement;
    if (!ctx || !arrangement) return null;
    return arrangement.songs.find((song) => song.instanceId === ctx.instanceId) || null;
  }

  function placementByInstance(instanceId) {
    const arrangement = state.live && state.live.arrangement;
    return arrangement ? arrangement.songs.find((song) => song.instanceId === instanceId) : null;
  }

  async function direct(command) {
    state.live = await invoke("direct_live_control", { command });
    renderLive();
  }

  async function jump(song, sectionId = null) {
    if (!song) return;
    state.live = await invoke("jump_live_control", {
      songId: song.songId,
      instanceId: song.instanceId,
      sectionId
    });
    renderLive();
  }

  function renderTransport() {
    const liveState = state.live && state.live.state || {};
    const ctx = state.live && state.live.liveContext;
    $("playBtn").classList.toggle("active", !!liveState.isPlaying);
    $("playLabel").textContent = liveState.isPlaying ? "PLAYING" : "PLAY";
    $("clickBtn").classList.toggle("active", !!liveState.metronome);
    $("tempo").textContent = Number.isFinite(liveState.tempo) ? Math.round(liveState.tempo * 10) / 10 : "--";
    $("meter").textContent = liveState.meter ? liveState.meter.numerator + "/" + liveState.meter.denominator : "--";
    $("barBeat").textContent = ctx ? ctx.currentBar + "." + ctx.beatInBar : "--";
  }

  function renderSongHeader() {
    const ctx = state.live && state.live.liveContext;
    const arrangement = state.live && state.live.arrangement;
    const setlist = activeSetlist();
    $("activeSetlistTitle").textContent = setlist ? setlist.title : "No active setlist";

    if (!ctx) {
      $("currentSong").textContent = setlist ? "Waiting for playhead" : "No service loaded";
      $("songMeta").textContent = setlist ? "Move the Ableton playhead into a song." : "Load a setlist to build the Arrangement map.";
      $("prevSongName").textContent = "—";
      $("nextSongName").textContent = arrangement && arrangement.songs[0] ? arrangement.songs[0].title : "—";
      $("prevSong").disabled = true;
      $("nextSong").disabled = !(arrangement && arrangement.songs.length);
      $("songProgress").style.width = "0%";
      $("nextSong").onclick = () => {
        const first = arrangement && arrangement.songs[0];
        if (first) jump(first).catch((error) => showError(error));
      };
      return;
    }

    $("currentSong").textContent = ctx.songTitle;
    $("songMeta").textContent = [
      ctx.bpm + " BPM",
      ctx.key || null,
      ctx.meter ? ctx.meter.numerator + "/" + ctx.meter.denominator : null
    ].filter(Boolean).join(" · ");
    $("songProgress").style.width = Math.round((ctx.progress || 0) * 1000) / 10 + "%";
    $("prevSongName").textContent = ctx.previousSong ? ctx.previousSong.title : "—";
    $("nextSongName").textContent = ctx.nextSong ? ctx.nextSong.title : "—";
    $("prevSong").disabled = !ctx.previousSong;
    $("nextSong").disabled = !ctx.nextSong;

    $("prevSong").onclick = () => {
      const song = ctx.previousSong && placementByInstance(ctx.previousSong.instanceId);
      if (song) jump(song).catch((error) => showError(error));
    };
    $("nextSong").onclick = () => {
      const song = ctx.nextSong && placementByInstance(ctx.nextSong.instanceId);
      if (song) jump(song).catch((error) => showError(error));
    };
  }

  function renderSections() {
    const ctx = state.live && state.live.liveContext;
    const placement = activePlacement();
    const grid = $("sectionGrid");
    grid.innerHTML = "";

    if (!ctx || !placement) {
      $("currentSection").textContent = "—";
      $("nextSection").textContent = "—";
      $("prevSection").disabled = true;
      $("nextSectionBtn").disabled = true;
      grid.innerHTML = '<div class="empty">Load a service and move Ableton into a song.</div>';
      return;
    }

    $("currentSection").textContent = ctx.sectionName || "COUNT / PRE-ROLL";
    $("nextSection").textContent = ctx.nextSectionName || "END";
    const currentIndex = placement.sections.findIndex((section) => section.id === ctx.sectionId);

    placement.sections.forEach((section, index) => {
      const button = document.createElement("button");
      button.className = "section-button" + (section.id === ctx.sectionId ? " active" : "");
      button.innerHTML =
        '<span>' + String(index + 1).padStart(2, "0") + '</span>' +
        '<strong>' + escapeHtml(section.name) + '</strong>' +
        '<small>BAR ' + section.localStartBar + '</small>';
      button.addEventListener("click", () => jump(placement, section.id).catch((error) => showError(error)));
      grid.appendChild(button);
    });

    $("prevSection").disabled = currentIndex <= 0;
    $("nextSectionBtn").disabled = currentIndex < 0 || currentIndex >= placement.sections.length - 1;
    $("prevSection").onclick = () => {
      const target = placement.sections[currentIndex - 1];
      if (target) jump(placement, target.id).catch((error) => showError(error));
    };
    $("nextSectionBtn").onclick = () => {
      const target = placement.sections[currentIndex + 1];
      if (target) jump(placement, target.id).catch((error) => showError(error));
    };
  }

  function renderTrackMixer() {
    const host = $("trackMixer");
    const tracks = state.live && state.live.state && state.live.state.tracks || [];
    $("trackCount").textContent = tracks.length;
    host.innerHTML = "";

    tracks.forEach((track) => {
      const row = document.createElement("div");
      const volume = Number.isFinite(track.volume) ? track.volume : 0;
      row.className = "mixer-row";
      row.innerHTML =
        '<span class="number">' + String(track.number).padStart(2, "0") + '</span>' +
        '<span class="track-name">' + escapeHtml(track.name) + '</span>' +
        '<input class="volume" type="range" min="0" max="1" step="0.01" value="' + volume + '">' +
        '<span class="volume-readout">' + Math.round(volume * 100) + '%</span>' +
        '<button class="mini mute' + (track.mute ? " active" : "") + '">M</button>' +
        '<button class="mini solo' + (track.solo ? " active" : "") + '">S</button>';
      const slider = row.querySelector(".volume");
      const readout = row.querySelector(".volume-readout");
      slider.addEventListener("input", () => readout.textContent = Math.round(Number(slider.value) * 100) + "%");
      slider.addEventListener("change", () => direct({
        type: "set_track_volume",
        args: { track: { index: track.index }, value: Number(slider.value) }
      }).catch((error) => showError(error)));
      row.querySelector(".mute").addEventListener("click", () => direct({
        type: "set_track_mute",
        args: { track: { index: track.index }, value: !track.mute }
      }).catch((error) => showError(error)));
      row.querySelector(".solo").addEventListener("click", () => direct({
        type: "set_track_solo",
        args: { track: { index: track.index }, value: !track.solo }
      }).catch((error) => showError(error)));
      host.appendChild(row);
    });
    if (!tracks.length) host.innerHTML = '<div class="empty">Ableton tracks appear when Luma Live.amxd is connected.</div>';
  }

  function renderServiceOrder() {
    const host = $("serviceOrder");
    const arrangement = state.live && state.live.arrangement;
    const ctx = state.live && state.live.liveContext;
    host.innerHTML = "";
    if (!arrangement || !arrangement.songs.length) {
      host.innerHTML = '<div class="empty">No active Arrangement setlist.</div>';
      return;
    }
    arrangement.songs.forEach((song, index) => {
      const row = document.createElement("button");
      row.className = "service-row" + (ctx && ctx.instanceId === song.instanceId ? " active" : "");
      row.innerHTML =
        '<span class="number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span><b>' + escapeHtml(song.title) + '</b><small>' + escapeHtml(song.bpm + " BPM" + (song.key ? " · " + song.key : "")) + '</small></span>' +
        '<em>' + (ctx && ctx.instanceId === song.instanceId ? "NOW" : "GO") + '</em>';
      row.addEventListener("click", () => jump(song).catch((error) => showError(error)));
      host.appendChild(row);
    });
  }

  function renderBusk() {
    const host = $("sceneGrid");
    const liveState = state.live && state.live.state || {};
    host.innerHTML = "";
    (liveState.scenes || []).forEach((scene) => {
      const button = document.createElement("button");
      button.className = "scene-button" + (scene.index === liveState.activeSceneIndex ? " active" : "");
      button.innerHTML = '<span>' + String(scene.number).padStart(2, "0") + '</span><strong>' + escapeHtml(scene.name) + '</strong>';
      button.addEventListener("click", () => direct({
        type: "fire_scene",
        args: { scene: { index: scene.index } }
      }).catch((error) => showError(error)));
      host.appendChild(button);
    });
    if (!(liveState.scenes || []).length) host.innerHTML = '<div class="empty">No Session View scenes available.</div>';
  }

  function renderLive() {
    const connected = !!(state.live && state.live.bridgeConnected);
    $("abletonDot").className = "dot " + (connected ? "ready" : "waiting");
    $("abletonStatus").textContent = connected ? "Ableton connected" : "Ableton offline";
    renderTransport();
    renderSongHeader();
    renderSections();
    renderTrackMixer();
    renderServiceOrder();
    renderBusk();
  }

  function parseSections(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Add at least one section.");
    return lines.map((line, index) => {
      const match = line.match(/^(.+?)\s*@\s*(\d+)$/);
      if (!match) throw new Error('Section line ' + (index + 1) + ' should look like "Chorus @ 25".');
      return { id: null, name: match[1].trim(), startBar: Number(match[2]) };
    });
  }

  function songPayload() {
    return {
      id: state.editingSongId,
      title: $("songTitle").value.trim(),
      artist: $("songArtist").value.trim(),
      bpm: Number($("songBpm").value),
      key: $("songKey").value.trim(),
      meter: {
        numerator: Number($("songMeterNum").value),
        denominator: Number($("songMeterDen").value)
      },
      lengthBars: Number($("songLength").value),
      sections: parseSections($("songSections").value)
    };
  }

  function resetSongEditor() {
    state.editingSongId = null;
    $("songEditorTitle").textContent = "New Song";
    $("songTitle").value = "";
    $("songArtist").value = "";
    $("songBpm").value = "120";
    $("songKey").value = "";
    $("songMeterNum").value = "4";
    $("songMeterDen").value = "4";
    $("songLength").value = "64";
    $("songSections").value = "";
    $("deleteSong").hidden = true;
  }

  function editSong(song) {
    state.editingSongId = song.id;
    $("songEditorTitle").textContent = song.title;
    $("songTitle").value = song.title;
    $("songArtist").value = song.artist || "";
    $("songBpm").value = song.bpm;
    $("songKey").value = song.key || "";
    $("songMeterNum").value = song.meter.numerator;
    $("songMeterDen").value = song.meter.denominator;
    $("songLength").value = song.lengthBars;
    $("songSections").value = song.sections.map((section) => section.name + " @ " + section.startBar).join("\n");
    $("deleteSong").hidden = false;
    go("library");
  }

  function renderSongs() {
    $("songCount").textContent = state.songs.length;
    const list = $("songList");
    list.innerHTML = "";
    state.songs.forEach((song) => {
      const button = document.createElement("button");
      button.className = "data-row";
      button.innerHTML =
        '<span><b>' + escapeHtml(song.title) + '</b><small>' +
        escapeHtml([song.artist, song.bpm + " BPM", song.key].filter(Boolean).join(" · ")) +
        '</small></span><span>›</span>';
      button.addEventListener("click", () => editSong(song));
      list.appendChild(button);
    });
    if (!state.songs.length) list.innerHTML = '<div class="empty">Your song library is empty.</div>';

    $("songPicker").innerHTML = state.songs.length
      ? state.songs.map((song) => '<option value="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</option>').join("")
      : '<option value="">No songs saved</option>';
  }

  async function saveSong() {
    const song = await invoke("save_song", { song: songPayload() });
    await loadLibrary();
    editSong(song);
  }

  function resetSetlistEditor() {
    state.editingSetlistId = null;
    state.draftItems = [];
    $("setlistEditorTitle").textContent = "New Setlist";
    $("setlistTitle").value = "";
    $("setlistGap").value = "4";
    $("deleteSetlist").hidden = true;
    $("loadSetlist").disabled = true;
    renderDraft();
  }

  function editSetlist(setlist) {
    state.editingSetlistId = setlist.id;
    state.draftItems = setlist.items.map((item) => ({ ...item }));
    $("setlistEditorTitle").textContent = setlist.title;
    $("setlistTitle").value = setlist.title;
    $("setlistGap").value = setlist.gapBars;
    $("deleteSetlist").hidden = false;
    $("loadSetlist").disabled = false;
    renderDraft();
    go("setlists");
  }

  function setlistPayload() {
    return {
      id: state.editingSetlistId,
      title: $("setlistTitle").value.trim(),
      gapBars: Number($("setlistGap").value),
      items: state.draftItems.map((item) => ({ id: item.id || null, songId: item.songId }))
    };
  }

  function renderDraft() {
    const host = $("setlistItems");
    host.innerHTML = "";
    state.draftItems.forEach((item, index) => {
      const song = state.songs.find((entry) => entry.id === item.songId);
      const row = document.createElement("div");
      row.className = "setlist-item";
      row.innerHTML =
        '<span class="number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span><b>' + escapeHtml(song ? song.title : item.songId) + '</b><small>' +
        escapeHtml(song ? song.bpm + " BPM" + (song.key ? " · " + song.key : "") : "Missing song") +
        '</small></span><div class="mini-actions"><button data-up>↑</button><button data-down>↓</button><button data-remove>×</button></div>';
      const up = row.querySelector("[data-up]");
      const down = row.querySelector("[data-down]");
      up.disabled = index === 0;
      down.disabled = index === state.draftItems.length - 1;
      up.addEventListener("click", () => {
        [state.draftItems[index - 1], state.draftItems[index]] = [state.draftItems[index], state.draftItems[index - 1]];
        renderDraft();
      });
      down.addEventListener("click", () => {
        [state.draftItems[index + 1], state.draftItems[index]] = [state.draftItems[index], state.draftItems[index + 1]];
        renderDraft();
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        state.draftItems.splice(index, 1);
        renderDraft();
      });
      host.appendChild(row);
    });
    if (!state.draftItems.length) host.innerHTML = '<div class="empty boxed">Add songs in service order.</div>';
  }

  function renderSetlists() {
    $("setlistCount").textContent = state.setlists.length;
    const list = $("setlistList");
    list.innerHTML = "";
    state.setlists.forEach((setlist) => {
      const wrapper = document.createElement("div");
      wrapper.className = "saved-setlist" + (setlist.id === state.activeSetlistId ? " active" : "");
      wrapper.innerHTML =
        '<button class="setlist-main"><span><b>' + escapeHtml(setlist.title) + '</b><small>' +
        setlist.items.length + ' song' + (setlist.items.length === 1 ? "" : "s") +
        (setlist.id === state.activeSetlistId ? " · ACTIVE" : "") +
        '</small></span><span>›</span></button><button class="load-small">' +
        (setlist.id === state.activeSetlistId ? "RESYNC" : "LOAD") + '</button>';
      wrapper.querySelector(".setlist-main").addEventListener("click", () => editSetlist(setlist));
      wrapper.querySelector(".load-small").addEventListener("click", () => loadService(setlist.id).catch((error) => showError(error)));
      list.appendChild(wrapper);
    });
    if (!state.setlists.length) list.innerHTML = '<div class="empty">No saved setlists yet.</div>';
  }

  async function saveSetlist() {
    const setlist = await invoke("save_setlist", { setlist: setlistPayload() });
    await loadLibrary();
    editSetlist(setlist);
    return setlist;
  }

  async function loadService(id) {
    if (!id) return;
    const result = await invoke("load_service", { id });
    await Promise.all([loadLibrary(), loadLive()]);
    go("song");
    if (result.syncError) showError("Service loaded locally, but Ableton is not connected yet.");
  }

  function renderPlan(plan) {
    state.plan = plan;
    $("planTitle").textContent = plan.title || "Command Plan";
    $("planSteps").innerHTML = (plan.steps || []).map((step, index) =>
      '<div class="plan-step"><span>' + String(index + 1).padStart(2, "0") + '</span><b>' + escapeHtml(step.summary) + '</b></div>'
    ).join("");
    $("planNotes").innerHTML = (plan.notes || []).map((note) => '<p>' + escapeHtml(note) + '</p>').join("");
    $("planPanel").hidden = false;
  }

  function renderRuntime() {
    const runtime = state.runtime;
    if (!runtime) return;
    $("databasePath").textContent = runtime.databasePath || "Unavailable";
    $("serverDot").className = "dot " + (runtime.serverRunning ? "ready" : "waiting");
    $("serverStatus").textContent = runtime.serverRunning ? "LAN remote ready" : "Starting LAN server";
    const links = runtime.localUrls || [];
    const host = $("remoteLinks");
    host.innerHTML = "";
    links.forEach((url) => {
      const row = document.createElement("div");
      row.className = "remote-link";
      row.innerHTML = '<code>' + escapeHtml(url.replace(/\?token=.*/, "")) + '</code><button>Copy Full Link</button>';
      row.querySelector("button").addEventListener("click", async () => {
        await navigator.clipboard.writeText(url);
        row.querySelector("button").textContent = "Copied";
        setTimeout(() => row.querySelector("button").textContent = "Copy Full Link", 1200);
      });
      host.appendChild(row);
    });
    if (!links.length) host.innerHTML = '<div class="empty">Connect this Mac to the same network as the iPad.</div>';
  }

  async function loadLibrary() {
    const payload = await invoke("get_library");
    state.songs = payload.songs || [];
    state.setlists = payload.setlists || [];
    state.activeSetlistId = payload.activeSetlistId || null;
    renderSongs();
    renderSetlists();
    renderDraft();
    const active = activeSetlist();
    $("activeSetlistTitle").textContent = active ? active.title : "No active setlist";
  }

  async function loadLive() {
    state.live = await invoke("get_live_control");
    renderLive();
  }

  async function loadRuntime() {
    state.runtime = await invoke("get_runtime_info");
    renderRuntime();
  }

  $("playBtn").addEventListener("click", () => {
    const playing = !!(state.live && state.live.state && state.live.state.isPlaying);
    direct({ type: playing ? "stop_playback" : "start_playback", args: {} }).catch((error) => showError(error));
  });
  $("stopBtn").addEventListener("click", () => direct({ type: "stop_playback", args: {} }).catch((error) => showError(error)));
  $("clickBtn").addEventListener("click", () => {
    const enabled = !!(state.live && state.live.state && state.live.state.metronome);
    direct({ type: "set_metronome", args: { enabled: !enabled } }).catch((error) => showError(error));
  });
  $("stopAll").addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }).catch((error) => showError(error)));

  $("newSong").addEventListener("click", resetSongEditor);
  $("saveSong").addEventListener("click", () => saveSong().catch((error) => showError(error)));
  $("deleteSong").addEventListener("click", async () => {
    if (!state.editingSongId || !confirm("Delete this song?")) return;
    try {
      await invoke("delete_song", { id: state.editingSongId });
      resetSongEditor();
      await loadLibrary();
    } catch (error) { showError(error); }
  });

  $("newSetlist").addEventListener("click", resetSetlistEditor);
  $("addSong").addEventListener("click", () => {
    const songId = $("songPicker").value;
    if (!songId) return;
    state.draftItems.push({ id: uid(), songId });
    renderDraft();
  });
  $("saveSetlist").addEventListener("click", () => saveSetlist().catch((error) => showError(error)));
  $("loadSetlist").addEventListener("click", async () => {
    try {
      let id = state.editingSetlistId;
      if (!id) id = (await saveSetlist()).id;
      await loadService(id);
    } catch (error) { showError(error); }
  });
  $("deleteSetlist").addEventListener("click", async () => {
    if (!state.editingSetlistId || !confirm("Delete this setlist?")) return;
    try {
      await invoke("delete_setlist", { id: state.editingSetlistId });
      resetSetlistEditor();
      await Promise.all([loadLibrary(), loadLive()]);
    } catch (error) { showError(error); }
  });

  document.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => $("commandInput").value = button.dataset.example);
  });
  $("clearCommand").addEventListener("click", () => {
    $("commandInput").value = "";
    $("planPanel").hidden = true;
    state.plan = null;
  });
  $("previewCommand").addEventListener("click", async () => {
    try {
      const plan = await invoke("plan_plain_language", { text: $("commandInput").value });
      renderPlan(plan);
    } catch (error) { showError(error); }
  });
  $("cancelPlan").addEventListener("click", () => {
    state.plan = null;
    $("planPanel").hidden = true;
  });
  $("applyPlan").addEventListener("click", async () => {
    if (!state.plan) return;
    $("applyPlan").disabled = true;
    $("applyPlan").textContent = "Applying…";
    try {
      await invoke("apply_plain_language", { plan: state.plan });
      state.plan = null;
      $("planPanel").hidden = true;
      await Promise.all([loadLibrary(), loadLive()]);
    } catch (error) {
      showError(error);
    } finally {
      $("applyPlan").disabled = false;
      $("applyPlan").textContent = "Apply";
    }
  });

  resetSongEditor();
  resetSetlistEditor();

  Promise.all([loadLibrary(), loadLive(), loadRuntime()]).catch((error) => showError(error));
  setInterval(() => loadLive().catch(() => {}), 900);
  setInterval(() => loadRuntime().catch(() => {}), 2000);
})();
