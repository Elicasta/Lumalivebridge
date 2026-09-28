(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const incomingToken = params.get("token");
  if (incomingToken) localStorage.setItem("lumaLiveToken", incomingToken);
  const token = incomingToken || localStorage.getItem("lumaLiveToken") || "";

  const $ = (id) => document.getElementById(id);
  const state = {
    library: { songs: [], setlists: [], activeSetlistId: null },
    live: null,
    editingSongId: null,
    editingSetlistId: null,
    draftItems: [],
    plan: null
  };

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

  function showError(message) {
    const box = $("error");
    box.textContent = message || "";
    box.hidden = !message;
  }

  function setStatus(id, online, label) {
    const node = $(id);
    node.className = "status " + (online ? "online" : "offline");
    node.innerHTML = "<i></i>" + label;
  }

  async function api(path, options = {}) {
    if (!token) throw new Error("Open the full Luma Live remote link from Settings on the Mac.");
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Luma-Token": token,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Luma Live request failed");
    return data;
  }

  function go(page) {
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === page);
    });
    document.querySelectorAll(".page").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.page === page);
    });
  }

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.tab));
  });

  function activeSetlist() {
    return state.library.setlists.find((item) => item.id === state.library.activeSetlistId) || null;
  }

  function activePlacement() {
    const ctx = state.live && state.live.liveContext;
    const arrangement = state.live && state.live.arrangement;
    if (!ctx || !arrangement) return null;
    return arrangement.songs.find((song) => song.instanceId === ctx.instanceId) || null;
  }

  function arrangementSong(instanceId) {
    const arrangement = state.live && state.live.arrangement;
    return arrangement ? arrangement.songs.find((song) => song.instanceId === instanceId) : null;
  }

  async function direct(command) {
    const data = await api("/api/live/direct", {
      method: "POST",
      body: JSON.stringify({ command })
    });
    state.live = data;
    renderLive();
    return data;
  }

  async function jump(song, sectionId = null) {
    if (!song) return;
    const data = await api("/api/live/jump", {
      method: "POST",
      body: JSON.stringify({
        songId: song.songId,
        instanceId: song.instanceId,
        sectionId
      })
    });
    state.live = data;
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
      grid.innerHTML = '<div class="empty">Load a service and move the Ableton playhead into a song.</div>';
      return;
    }

    $("currentSection").textContent = ctx.sectionName || "COUNT / PRE-ROLL";
    $("nextSection").textContent = ctx.nextSectionName || "END";

    let currentIndex = placement.sections.findIndex((section) => section.id === ctx.sectionId);
    placement.sections.forEach((section, index) => {
      const button = document.createElement("button");
      button.className = "section-button" + (section.id === ctx.sectionId ? " active" : "");
      button.innerHTML =
        '<span>' + String(index + 1).padStart(2, "0") + '</span>' +
        '<strong>' + escapeHtml(section.name) + '</strong>' +
        '<small>BAR ' + section.localStartBar + '</small>';
      button.addEventListener("click", () => jump(placement, section.id).catch((error) => showError(error.message)));
      grid.appendChild(button);
    });

    $("prevSection").disabled = currentIndex <= 0;
    $("nextSectionBtn").disabled = currentIndex < 0 || currentIndex >= placement.sections.length - 1;
    $("prevSection").onclick = () => {
      const target = placement.sections[currentIndex - 1];
      if (target) jump(placement, target.id).catch((error) => showError(error.message));
    };
    $("nextSectionBtn").onclick = () => {
      const target = placement.sections[currentIndex + 1];
      if (target) jump(placement, target.id).catch((error) => showError(error.message));
    };
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
      const button = document.createElement("button");
      const active = ctx && ctx.instanceId === song.instanceId;
      button.className = "service-row" + (active ? " active" : "");
      button.innerHTML =
        '<span class="row-number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span><b>' + escapeHtml(song.title) + '</b><small>' +
        escapeHtml(song.bpm + " BPM" + (song.key ? " · " + song.key : "")) +
        '</small></span><em>' + (active ? "NOW" : "GO") + '</em>';
      button.addEventListener("click", () => jump(song).catch((error) => showError(error.message)));
      host.appendChild(button);
    });
  }

  function renderTrackMixer() {
    const host = $("trackMixer");
    const tracks = state.live && state.live.state && state.live.state.tracks || [];
    $("trackCount").textContent = tracks.length;
    host.innerHTML = "";

    tracks.forEach((track) => {
      const row = document.createElement("div");
      row.className = "mixer-row";
      const volume = Number.isFinite(track.volume) ? track.volume : 0;
      row.innerHTML =
        '<span class="track-number">' + String(track.number).padStart(2, "0") + '</span>' +
        '<span class="track-name">' + escapeHtml(track.name) + '</span>' +
        '<input class="volume" type="range" min="0" max="1" step="0.01" value="' + volume + '">' +
        '<span class="volume-readout">' + Math.round(volume * 100) + '%</span>' +
        '<button class="mini mute' + (track.mute ? " active" : "") + '">M</button>' +
        '<button class="mini solo' + (track.solo ? " active" : "") + '">S</button>';

      const slider = row.querySelector(".volume");
      const readout = row.querySelector(".volume-readout");
      slider.addEventListener("input", () => {
        readout.textContent = Math.round(Number(slider.value) * 100) + "%";
      });
      slider.addEventListener("change", () => {
        direct({
          type: "set_track_volume",
          args: { track: { index: track.index }, value: Number(slider.value) }
        }).catch((error) => showError(error.message));
      });
      row.querySelector(".mute").addEventListener("click", () => {
        direct({
          type: "set_track_mute",
          args: { track: { index: track.index }, value: !track.mute }
        }).catch((error) => showError(error.message));
      });
      row.querySelector(".solo").addEventListener("click", () => {
        direct({
          type: "set_track_solo",
          args: { track: { index: track.index }, value: !track.solo }
        }).catch((error) => showError(error.message));
      });

      host.appendChild(row);
    });

    if (!tracks.length) host.innerHTML = '<div class="empty">Ableton tracks will appear when the Max adapter is connected.</div>';
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
        if (first) jump(first).catch((error) => showError(error.message));
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
      const song = ctx.previousSong && arrangementSong(ctx.previousSong.instanceId);
      if (song) jump(song).catch((error) => showError(error.message));
    };
    $("nextSong").onclick = () => {
      const song = ctx.nextSong && arrangementSong(ctx.nextSong.instanceId);
      if (song) jump(song).catch((error) => showError(error.message));
    };
  }

  function renderBusk() {
    const host = $("sceneGrid");
    const liveState = state.live && state.live.state || {};
    host.innerHTML = "";
    (liveState.scenes || []).forEach((scene) => {
      const button = document.createElement("button");
      button.className = "scene-button" + (scene.index === liveState.activeSceneIndex ? " active" : "");
      button.innerHTML =
        '<span>' + String(scene.number).padStart(2, "0") + '</span><strong>' + escapeHtml(scene.name) + '</strong>';
      button.addEventListener("click", () => {
        direct({ type: "fire_scene", args: { scene: { index: scene.index } } })
          .catch((error) => showError(error.message));
      });
      host.appendChild(button);
    });
    if (!(liveState.scenes || []).length) {
      host.innerHTML = '<div class="empty">No Session View scenes are available.</div>';
    }
  }

  function renderLive() {
    const connected = !!(state.live && state.live.bridgeConnected);
    setStatus("abletonStatus", connected, connected ? "ABLETON" : "ABLETON");
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
      lengthBars: Number($("songLengthBars").value),
      sections: parseSections($("songSections").value)
    };
  }

  function resetSongEditor() {
    state.editingSongId = null;
    $("songEditorHeading").textContent = "New Song";
    $("songTitle").value = "";
    $("songArtist").value = "";
    $("songBpm").value = "120";
    $("songKey").value = "";
    $("songMeterNum").value = "4";
    $("songMeterDen").value = "4";
    $("songLengthBars").value = "64";
    $("songSections").value = "";
    $("deleteSongBtn").hidden = true;
  }

  function editSong(song) {
    state.editingSongId = song.id;
    $("songEditorHeading").textContent = song.title;
    $("songTitle").value = song.title;
    $("songArtist").value = song.artist || "";
    $("songBpm").value = song.bpm;
    $("songKey").value = song.key || "";
    $("songMeterNum").value = song.meter.numerator;
    $("songMeterDen").value = song.meter.denominator;
    $("songLengthBars").value = song.lengthBars;
    $("songSections").value = song.sections.map((section) => section.name + " @ " + section.startBar).join("\n");
    $("deleteSongBtn").hidden = false;
    go("library");
  }

  function renderLibrary() {
    $("songCount").textContent = state.library.songs.length;
    const host = $("songList");
    host.innerHTML = "";

    state.library.songs.forEach((song) => {
      const button = document.createElement("button");
      button.className = "data-row";
      button.innerHTML =
        '<span><b>' + escapeHtml(song.title) + '</b><small>' +
        escapeHtml([song.artist, song.bpm + " BPM", song.key].filter(Boolean).join(" · ")) +
        '</small></span><span>›</span>';
      button.addEventListener("click", () => editSong(song));
      host.appendChild(button);
    });
    if (!state.library.songs.length) host.innerHTML = '<div class="empty">Your song library is empty.</div>';

    $("addSongSelect").innerHTML = state.library.songs.length
      ? state.library.songs.map((song) => '<option value="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</option>').join("")
      : '<option value="">No songs saved</option>';
  }

  function resetSetlistEditor() {
    state.editingSetlistId = null;
    state.draftItems = [];
    $("setlistEditorHeading").textContent = "New Setlist";
    $("setlistTitle").value = "";
    $("setlistGap").value = "4";
    $("deleteSetlistBtn").hidden = true;
    $("loadSetlistBtn").disabled = true;
    renderDraft();
  }

  function editSetlist(setlist) {
    state.editingSetlistId = setlist.id;
    state.draftItems = setlist.items.map((item) => ({ ...item }));
    $("setlistEditorHeading").textContent = setlist.title;
    $("setlistTitle").value = setlist.title;
    $("setlistGap").value = setlist.gapBars;
    $("deleteSetlistBtn").hidden = false;
    $("loadSetlistBtn").disabled = false;
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
      const song = state.library.songs.find((entry) => entry.id === item.songId);
      const row = document.createElement("div");
      row.className = "setlist-item";
      row.innerHTML =
        '<span class="row-number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span><b>' + escapeHtml(song ? song.title : item.songId) + '</b><small>' +
        escapeHtml(song ? song.bpm + " BPM" + (song.key ? " · " + song.key : "") : "Missing song") +
        '</small></span><div class="mini-actions">' +
        '<button data-up>↑</button><button data-down>↓</button><button data-remove>×</button></div>';

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
    $("setlistCount").textContent = state.library.setlists.length;
    const host = $("setlistList");
    host.innerHTML = "";

    state.library.setlists.forEach((setlist) => {
      const row = document.createElement("div");
      const active = setlist.id === state.library.activeSetlistId;
      row.className = "setlist-saved" + (active ? " active" : "");
      row.innerHTML =
        '<button class="setlist-main"><span><b>' + escapeHtml(setlist.title) + '</b><small>' +
        setlist.items.length + ' song' + (setlist.items.length === 1 ? "" : "s") +
        (active ? " · ACTIVE" : "") + '</small></span><span>›</span></button>' +
        '<button class="load-small">' + (active ? "RESYNC" : "LOAD") + '</button>';
      row.querySelector(".setlist-main").addEventListener("click", () => editSetlist(setlist));
      row.querySelector(".load-small").addEventListener("click", () => {
        loadSetlist(setlist.id).catch((error) => showError(error.message));
      });
      host.appendChild(row);
    });
    if (!state.library.setlists.length) host.innerHTML = '<div class="empty">No saved setlists yet.</div>';
  }

  function renderLibraryState() {
    renderLibrary();
    renderSetlists();
    renderServiceOrder();
    const setlist = activeSetlist();
    $("activeSetlistTitle").textContent = setlist ? setlist.title : "No active setlist";
  }

  async function saveSong() {
    const saved = await api("/api/songs", {
      method: "POST",
      body: JSON.stringify(songPayload())
    });
    await refreshLibrary();
    editSong(saved);
  }

  async function saveSetlist() {
    const saved = await api("/api/setlists", {
      method: "POST",
      body: JSON.stringify(setlistPayload())
    });
    await refreshLibrary();
    editSetlist(saved);
    return saved;
  }

  async function loadSetlist(id) {
    if (!id) return;
    const result = await api("/api/setlists/" + encodeURIComponent(id) + "/load", {
      method: "POST",
      body: "{}"
    });
    await Promise.all([refreshLibrary(), refreshLive()]);
    go("song");
    if (result.syncError) showError("Service loaded locally, but Ableton is not connected yet.");
  }

  function renderPlan(plan) {
    state.plan = plan;
    $("planTitle").textContent = plan.title || "Command Plan";
    $("planSteps").innerHTML = (plan.steps || []).map((step, index) =>
      '<div class="plan-step"><span>' + String(index + 1).padStart(2, "0") + '</span><b>' +
      escapeHtml(step.summary) + '</b></div>'
    ).join("");
    $("planNotes").innerHTML = (plan.notes || []).map((note) => '<p>' + escapeHtml(note) + '</p>').join("");
    $("planPanel").hidden = false;
  }

  async function refreshLibrary() {
    const library = await api("/api/library");
    state.library = library;
    renderLibraryState();
  }

  async function refreshLive() {
    try {
      const live = await api("/api/live");
      state.live = live;
      renderLive();
      setStatus("appStatus", true, "MAC");
      return live;
    } catch (error) {
      setStatus("appStatus", false, "MAC");
      throw error;
    }
  }

  async function refreshAll() {
    showError("");
    await Promise.all([refreshLibrary(), refreshLive()]);
  }

  $("playBtn").addEventListener("click", () => {
    const playing = !!(state.live && state.live.state && state.live.state.isPlaying);
    direct({ type: playing ? "stop_playback" : "start_playback", args: {} })
      .catch((error) => showError(error.message));
  });
  $("stopBtn").addEventListener("click", () => direct({ type: "stop_playback", args: {} }).catch((error) => showError(error.message)));
  $("clickBtn").addEventListener("click", () => {
    const enabled = !!(state.live && state.live.state && state.live.state.metronome);
    direct({ type: "set_metronome", args: { enabled: !enabled } }).catch((error) => showError(error.message));
  });
  $("refreshBtn").addEventListener("click", () => refreshAll().catch((error) => showError(error.message)));
  $("stopAll").addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }).catch((error) => showError(error.message)));

  $("newSongBtn").addEventListener("click", resetSongEditor);
  $("saveSongBtn").addEventListener("click", () => saveSong().catch((error) => showError(error.message)));
  $("deleteSongBtn").addEventListener("click", async () => {
    if (!state.editingSongId || !confirm("Delete this song?")) return;
    try {
      await api("/api/songs/" + encodeURIComponent(state.editingSongId), { method: "DELETE" });
      resetSongEditor();
      await refreshLibrary();
    } catch (error) {
      showError(error.message);
    }
  });

  $("newSetlistBtn").addEventListener("click", resetSetlistEditor);
  $("addSongBtn").addEventListener("click", () => {
    const songId = $("addSongSelect").value;
    if (!songId) return;
    state.draftItems.push({ id: uid(), songId });
    renderDraft();
  });
  $("saveSetlistBtn").addEventListener("click", () => saveSetlist().catch((error) => showError(error.message)));
  $("loadSetlistBtn").addEventListener("click", async () => {
    try {
      let id = state.editingSetlistId;
      if (!id) {
        const saved = await saveSetlist();
        id = saved.id;
      }
      await loadSetlist(id);
    } catch (error) {
      showError(error.message);
    }
  });
  $("deleteSetlistBtn").addEventListener("click", async () => {
    if (!state.editingSetlistId || !confirm("Delete this setlist?")) return;
    try {
      await api("/api/setlists/" + encodeURIComponent(state.editingSetlistId), { method: "DELETE" });
      resetSetlistEditor();
      await Promise.all([refreshLibrary(), refreshLive()]);
    } catch (error) {
      showError(error.message);
    }
  });

  document.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      $("commandInput").value = button.dataset.example;
    });
  });
  $("clearCommandBtn").addEventListener("click", () => {
    $("commandInput").value = "";
    $("planPanel").hidden = true;
    state.plan = null;
  });
  $("previewCommandBtn").addEventListener("click", async () => {
    try {
      const data = await api("/api/plain/plan", {
        method: "POST",
        body: JSON.stringify({ text: $("commandInput").value })
      });
      renderPlan(data.plan);
    } catch (error) {
      showError(error.message);
    }
  });
  $("cancelPlanBtn").addEventListener("click", () => {
    state.plan = null;
    $("planPanel").hidden = true;
  });
  $("applyPlanBtn").addEventListener("click", async () => {
    if (!state.plan) return;
    $("applyPlanBtn").disabled = true;
    $("applyPlanBtn").textContent = "Applying…";
    try {
      await api("/api/plain/apply", {
        method: "POST",
        body: JSON.stringify({ plan: state.plan })
      });
      state.plan = null;
      $("planPanel").hidden = true;
      await refreshAll();
    } catch (error) {
      showError(error.message);
    } finally {
      $("applyPlanBtn").disabled = false;
      $("applyPlanBtn").textContent = "Apply";
    }
  });

  resetSongEditor();
  resetSetlistEditor();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  if (!token) {
    showError("Open the full Luma Live remote link shown in Settings on the Mac.");
  } else {
    refreshAll().catch((error) => showError(error.message));
    setInterval(() => refreshLive().catch(() => {}), 900);
    setInterval(() => refreshLibrary().catch(() => {}), 5000);
  }
})();
