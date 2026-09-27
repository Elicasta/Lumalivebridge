(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const incoming = params.get("token");
  if (incoming) localStorage.setItem("lumaBridgeToken", incoming);
  const token = incoming || localStorage.getItem("lumaBridgeToken") || "";

  const el = (id) => document.getElementById(id);
  const ui = {
    status: el("status"),
    error: el("error"),
    tempo: el("tempo"),
    meter: el("meter"),
    position: el("position"),
    currentSong: el("currentSong"),
    currentMeta: el("currentMeta"),
    currentSection: el("currentSection"),
    nextSection: el("nextSection"),
    liveSectionButtons: el("liveSectionButtons"),
    activeSetlistTitle: el("activeSetlistTitle"),
    liveSetlist: el("liveSetlist"),
    stopAll: el("stopAll"),
    refreshBtn: el("refreshBtn"),

    songEditorHeading: el("songEditorHeading"),
    songTitle: el("songTitle"),
    songArtist: el("songArtist"),
    songBpm: el("songBpm"),
    songKey: el("songKey"),
    songMeterNum: el("songMeterNum"),
    songMeterDen: el("songMeterDen"),
    songLengthBars: el("songLengthBars"),
    songSections: el("songSections"),
    saveSongBtn: el("saveSongBtn"),
    deleteSongBtn: el("deleteSongBtn"),
    newSongBtn: el("newSongBtn"),
    songList: el("songList"),
    songCount: el("songCount"),

    setlistEditorHeading: el("setlistEditorHeading"),
    setlistTitle: el("setlistTitle"),
    setlistGap: el("setlistGap"),
    addSongSelect: el("addSongSelect"),
    addSongBtn: el("addSongBtn"),
    setlistItems: el("setlistItems"),
    saveSetlistBtn: el("saveSetlistBtn"),
    syncSetlistBtn: el("syncSetlistBtn"),
    deleteSetlistBtn: el("deleteSetlistBtn"),
    newSetlistBtn: el("newSetlistBtn"),
    setlistList: el("setlistList"),
    setlistCount: el("setlistCount"),

    commandInput: el("commandInput"),
    previewBtn: el("previewBtn"),
    clearBtn: el("clearBtn"),
    planCard: el("planCard"),
    planTitle: el("planTitle"),
    confidence: el("confidence"),
    planList: el("planList"),
    planNotes: el("planNotes"),
    cancelBtn: el("cancelBtn"),
    applyBtn: el("applyBtn"),
    sceneGrid: el("sceneGrid")
  };

  const state = {
    live: null,
    songs: [],
    setlists: [],
    activeSetlistId: null,
    arrangement: null,
    editingSongId: null,
    editingSetlistId: null,
    draftItems: [],
    currentPlan: null
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : "item-" + Date.now() + "-" + Math.random();
  }

  function showError(message) {
    ui.error.textContent = message || "";
    ui.error.hidden = !message;
  }

  function setStatus(online) {
    ui.status.textContent = online ? "CONNECTED" : "OFFLINE";
    ui.status.className = "status " + (online ? "online" : "offline");
  }

  async function api(path, options = {}) {
    if (!token) throw new Error("Missing bridge token. Open the exact URL printed by Luma Live Bridge.");
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Luma-Token": token,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Bridge request failed");
    return data;
  }

  function setLibrary(data) {
    state.songs = Array.isArray(data.songs) ? data.songs : state.songs;
    state.setlists = Array.isArray(data.setlists) ? data.setlists : state.setlists;
    if ("activeSetlistId" in data) state.activeSetlistId = data.activeSetlistId;
    if ("arrangement" in data) state.arrangement = data.arrangement;
    renderSongs();
    renderSetlists();
    renderLive();
  }

  function activeSetlist() {
    return state.setlists.find((item) => item.id === state.activeSetlistId) || null;
  }

  function activeSongPlacement() {
    const ctx = state.live && state.live.liveContext;
    if (!ctx || !state.arrangement) return null;
    return state.arrangement.songs.find((song) => song.instanceId === ctx.instanceId) || null;
  }

  function renderLive() {
    const live = state.live;
    const ctx = live && live.liveContext;
    ui.tempo.textContent = live && Number.isFinite(live.tempo) ? Math.round(live.tempo * 10) / 10 : "--";
    ui.meter.textContent = live && live.meter ? live.meter.numerator + "/" + live.meter.denominator : "--";
    ui.position.textContent = live && Number.isFinite(live.currentSongTime)
      ? "Beat " + (Math.round(live.currentSongTime * 10) / 10)
      : "--";

    const setlist = activeSetlist();
    ui.activeSetlistTitle.textContent = setlist ? setlist.title : "No setlist synced";

    if (!ctx) {
      ui.currentSong.textContent = setlist ? "Waiting for song position" : "No active setlist";
      ui.currentMeta.textContent = setlist ? "Move the Ableton playhead into a synced song." : "Sync a setlist to Ableton.";
      ui.currentSection.textContent = "--";
      ui.nextSection.textContent = "--";
      ui.liveSectionButtons.innerHTML = "";
    } else {
      ui.currentSong.textContent = ctx.songTitle;
      const bits = [ctx.bpm + " BPM"];
      if (ctx.key) bits.push(ctx.key);
      if (ctx.meter) bits.push(ctx.meter.numerator + "/" + ctx.meter.denominator);
      ui.currentMeta.textContent = bits.join(" · ");
      ui.currentSection.textContent = ctx.sectionName || "COUNT / PRE-ROLL";
      ui.nextSection.textContent = ctx.nextSectionName || "END";

      const placement = activeSongPlacement();
      ui.liveSectionButtons.innerHTML = "";
      if (placement) {
        placement.sections.forEach((section) => {
          const button = document.createElement("button");
          button.className = "section-jump" + (section.id === ctx.sectionId ? " active" : "");
          button.textContent = section.name;
          button.addEventListener("click", () => jumpTo(placement, section.id));
          ui.liveSectionButtons.appendChild(button);
        });
      }
    }

    ui.liveSetlist.innerHTML = "";
    if (state.arrangement && state.arrangement.songs.length) {
      state.arrangement.songs.forEach((song, index) => {
        const row = document.createElement("button");
        const current = ctx && ctx.instanceId === song.instanceId;
        row.className = "live-song-row" + (current ? " active" : "");
        row.innerHTML =
          '<span class="index">' + String(index + 1).padStart(2, "0") + '</span>' +
          '<span class="song-copy"><b>' + escapeHtml(song.title) + '</b><small>' +
          escapeHtml(song.bpm + " BPM" + (song.key ? " · " + song.key : "")) +
          '</small></span><span class="go">GO</span>';
        row.addEventListener("click", () => jumpTo(song, null));
        ui.liveSetlist.appendChild(row);
      });
    } else {
      ui.liveSetlist.innerHTML = '<div class="empty">Build a setlist, then sync it to Ableton.</div>';
    }

    renderScenes();
  }

  async function jumpTo(song, sectionId) {
    showError("");
    try {
      const data = await api("/api/jump", {
        method: "POST",
        body: JSON.stringify({
          instanceId: song.instanceId,
          songId: song.songId,
          sectionId: sectionId || null
        })
      });
      if (data.state) {
        state.live = data.state;
        renderLive();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  function parseSections(value) {
    const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Add at least one section");
    return lines.map((line, index) => {
      const match = line.match(/^(.+?)\s*@\s*(\d+)$/);
      if (!match) throw new Error('Section line ' + (index + 1) + ' must look like "Chorus @ 25"');
      return { name: match[1].trim(), startBar: Number(match[2]) };
    });
  }

  function songFormValue() {
    return {
      id: state.editingSongId || undefined,
      title: ui.songTitle.value.trim(),
      artist: ui.songArtist.value.trim(),
      bpm: Number(ui.songBpm.value),
      key: ui.songKey.value.trim(),
      meter: {
        numerator: Number(ui.songMeterNum.value),
        denominator: Number(ui.songMeterDen.value)
      },
      lengthBars: Number(ui.songLengthBars.value),
      sections: parseSections(ui.songSections.value)
    };
  }

  function resetSongEditor() {
    state.editingSongId = null;
    ui.songEditorHeading.textContent = "New Song";
    ui.songTitle.value = "";
    ui.songArtist.value = "";
    ui.songBpm.value = "120";
    ui.songKey.value = "";
    ui.songMeterNum.value = "4";
    ui.songMeterDen.value = "4";
    ui.songLengthBars.value = "64";
    ui.songSections.value = "";
    ui.deleteSongBtn.hidden = true;
  }

  function editSong(song) {
    state.editingSongId = song.id;
    ui.songEditorHeading.textContent = song.title;
    ui.songTitle.value = song.title;
    ui.songArtist.value = song.artist || "";
    ui.songBpm.value = song.bpm;
    ui.songKey.value = song.key || "";
    ui.songMeterNum.value = song.meter.numerator;
    ui.songMeterDen.value = song.meter.denominator;
    ui.songLengthBars.value = song.lengthBars;
    ui.songSections.value = song.sections.map((section) => section.name + " @ " + section.startBar).join("\n");
    ui.deleteSongBtn.hidden = false;
    activateTab("songs");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSongs() {
    ui.songCount.textContent = String(state.songs.length);
    ui.songList.innerHTML = "";
    ui.addSongSelect.innerHTML = state.songs.length
      ? state.songs.map((song) => '<option value="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</option>').join("")
      : '<option value="">No songs saved</option>';

    state.songs.forEach((song) => {
      const row = document.createElement("button");
      row.className = "library-row";
      row.innerHTML =
        '<span><b>' + escapeHtml(song.title) + '</b><small>' +
        escapeHtml([song.artist, song.bpm + " BPM", song.key].filter(Boolean).join(" · ")) +
        '</small></span><span class="chev">›</span>';
      row.addEventListener("click", () => editSong(song));
      ui.songList.appendChild(row);
    });

    if (!state.songs.length) {
      ui.songList.innerHTML = '<div class="empty">Save your first reusable song above.</div>';
    }
  }

  function setlistFormValue() {
    return {
      id: state.editingSetlistId || undefined,
      title: ui.setlistTitle.value.trim(),
      gapBars: Number(ui.setlistGap.value),
      items: state.draftItems.map((item) => ({ id: item.id, songId: item.songId }))
    };
  }

  function resetSetlistEditor() {
    state.editingSetlistId = null;
    state.draftItems = [];
    ui.setlistEditorHeading.textContent = "New Setlist";
    ui.setlistTitle.value = "";
    ui.setlistGap.value = "4";
    ui.deleteSetlistBtn.hidden = true;
    renderSetlistItems();
  }

  function editSetlist(setlist) {
    state.editingSetlistId = setlist.id;
    state.draftItems = setlist.items.map((item) => ({ ...item }));
    ui.setlistEditorHeading.textContent = setlist.title;
    ui.setlistTitle.value = setlist.title;
    ui.setlistGap.value = setlist.gapBars;
    ui.deleteSetlistBtn.hidden = false;
    renderSetlistItems();
    activateTab("setlist");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSetlistItems() {
    ui.setlistItems.innerHTML = "";
    state.draftItems.forEach((item, index) => {
      const song = state.songs.find((entry) => entry.id === item.songId);
      const row = document.createElement("div");
      row.className = "setlist-row";
      row.innerHTML =
        '<span class="drag-num">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span class="song-copy"><b>' + escapeHtml(song ? song.title : item.songId) + '</b><small>' +
        escapeHtml(song ? song.bpm + " BPM" + (song.key ? " · " + song.key : "") : "Missing song") +
        '</small></span>' +
        '<div class="row-actions">' +
        '<button data-action="up" title="Move up">↑</button>' +
        '<button data-action="down" title="Move down">↓</button>' +
        '<button data-action="remove" title="Remove">×</button></div>';

      row.querySelector('[data-action="up"]').disabled = index === 0;
      row.querySelector('[data-action="down"]').disabled = index === state.draftItems.length - 1;
      row.querySelector('[data-action="up"]').addEventListener("click", () => {
        [state.draftItems[index - 1], state.draftItems[index]] = [state.draftItems[index], state.draftItems[index - 1]];
        renderSetlistItems();
      });
      row.querySelector('[data-action="down"]').addEventListener("click", () => {
        [state.draftItems[index + 1], state.draftItems[index]] = [state.draftItems[index], state.draftItems[index + 1]];
        renderSetlistItems();
      });
      row.querySelector('[data-action="remove"]').addEventListener("click", () => {
        state.draftItems.splice(index, 1);
        renderSetlistItems();
      });
      ui.setlistItems.appendChild(row);
    });

    if (!state.draftItems.length) {
      ui.setlistItems.innerHTML = '<div class="empty">Add songs in service order.</div>';
    }
  }

  function renderSetlists() {
    ui.setlistCount.textContent = String(state.setlists.length);
    ui.setlistList.innerHTML = "";
    state.setlists.forEach((setlist) => {
      const row = document.createElement("button");
      row.className = "library-row" + (setlist.id === state.activeSetlistId ? " active" : "");
      row.innerHTML =
        '<span><b>' + escapeHtml(setlist.title) + '</b><small>' +
        setlist.items.length + ' songs' + (setlist.id === state.activeSetlistId ? " · SYNCED" : "") +
        '</small></span><span class="chev">›</span>';
      row.addEventListener("click", () => editSetlist(setlist));
      ui.setlistList.appendChild(row);
    });

    if (!state.setlists.length) {
      ui.setlistList.innerHTML = '<div class="empty">No saved services yet.</div>';
    }
  }

  async function saveSong() {
    showError("");
    ui.saveSongBtn.disabled = true;
    try {
      const data = await api("/api/songs", {
        method: "POST",
        body: JSON.stringify({ song: songFormValue() })
      });
      setLibrary(data);
      editSong(data.song);
    } catch (error) {
      showError(error.message);
    } finally {
      ui.saveSongBtn.disabled = false;
    }
  }

  async function saveSetlist() {
    showError("");
    const data = await api("/api/setlists", {
      method: "POST",
      body: JSON.stringify({ setlist: setlistFormValue() })
    });
    setLibrary(data);
    editSetlist(data.setlist);
    return data.setlist;
  }

  async function syncSetlist() {
    showError("");
    ui.syncSetlistBtn.disabled = true;
    ui.syncSetlistBtn.textContent = "Syncing…";
    try {
      const setlist = await saveSetlist();
      const data = await api("/api/setlists/" + encodeURIComponent(setlist.id) + "/sync", {
        method: "POST",
        body: "{}"
      });
      setLibrary(data);
      if (data.state) state.live = data.state;
      renderLive();
      activateTab("live");
    } catch (error) {
      showError(error.message);
    } finally {
      ui.syncSetlistBtn.disabled = false;
      ui.syncSetlistBtn.textContent = "Sync to Ableton";
    }
  }

  function labelCommand(command) {
    const a = command.args || {};
    const ref = (value) => value && (value.name || ("#" + (Number(value.index) + 1)));
    const labels = {
      set_tempo: () => "Set tempo to " + a.bpm + " BPM",
      set_meter: () => "Set meter to " + a.numerator + "/" + a.denominator,
      create_track: () => "Create " + a.kind + " track · " + a.name,
      rename_track: () => "Rename track " + ref(a.track) + " → " + a.name,
      create_scene: () => "Create scene · " + a.name,
      rename_scene: () => "Rename scene " + ref(a.scene) + " → " + a.name,
      fire_scene: () => "Launch scene · " + ref(a.scene),
      stop_all_clips: () => "Stop all clips",
      create_midi_clip: () => "Create MIDI clip on " + ref(a.track) + " / " + ref(a.scene),
      duplicate_clip: () => "Duplicate clip on " + ref(a.track),
      set_clip_loop: () => (a.enabled ? "Enable" : "Disable") + " clip loop",
      set_track_volume: () => "Set " + ref(a.track) + " volume to " + Math.round(a.value * 100) + "%",
      set_track_mute: () => (a.value ? "Mute " : "Unmute ") + ref(a.track),
      set_track_solo: () => (a.value ? "Solo " : "Unsolo ") + ref(a.track),
      sync_cue_points: () => "Sync " + (a.points || []).length + " Luma locators",
      jump_to_time: () => "Jump to beat " + a.time
    };
    return labels[command.type] ? labels[command.type]() : command.type;
  }

  function renderPlan(plan) {
    state.currentPlan = plan;
    ui.planTitle.textContent = plan.title;
    ui.confidence.textContent = Math.round((plan.confidence || 0) * 100) + "%";
    ui.planList.innerHTML = "";
    plan.commands.forEach((command, index) => {
      const row = document.createElement("div");
      row.className = "plan-row";
      row.innerHTML = '<span class="num">' + String(index + 1).padStart(2, "0") + '</span><span>' +
        escapeHtml(labelCommand(command)) + "</span>";
      ui.planList.appendChild(row);
    });
    ui.planNotes.innerHTML = (plan.notes || []).map((note) => "<div>• " + escapeHtml(note) + "</div>").join("");
    ui.planCard.hidden = false;
  }

  function renderScenes() {
    ui.sceneGrid.innerHTML = "";
    const live = state.live;
    (live && live.scenes || []).forEach((item) => {
      const button = document.createElement("button");
      button.className = "scene-button" + (item.index === live.activeSceneIndex ? " active" : "");
      button.innerHTML = '<span class="scene-number">' + item.number + '</span><span>' + escapeHtml(item.name) + "</span>";
      button.addEventListener("click", () => direct({
        type: "fire_scene",
        args: { scene: { index: item.index } }
      }));
      ui.sceneGrid.appendChild(button);
    });
  }

  async function direct(command) {
    showError("");
    try {
      const data = await api("/api/direct", {
        method: "POST",
        body: JSON.stringify({ command })
      });
      if (data.state) {
        state.live = data.state;
        renderLive();
      }
    } catch (error) {
      showError(error.message);
    }
  }

  async function refresh() {
    try {
      const [liveData, libraryData] = await Promise.all([
        api("/api/state"),
        api("/api/library")
      ]);
      state.live = liveData.state;
      setLibrary(libraryData);
      renderLive();
      setStatus(true);
    } catch (error) {
      setStatus(false);
      showError(error.message);
    }
  }

  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === name);
    });
    document.querySelectorAll(".page").forEach((page) => {
      page.classList.toggle("active", page.dataset.page === name);
    });
  }

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  ui.stopAll.addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }));
  ui.refreshBtn.addEventListener("click", refresh);
  ui.newSongBtn.addEventListener("click", resetSongEditor);
  ui.saveSongBtn.addEventListener("click", saveSong);
  ui.deleteSongBtn.addEventListener("click", async () => {
    if (!state.editingSongId || !confirm("Delete this song from the library?")) return;
    try {
      const data = await api("/api/songs/" + encodeURIComponent(state.editingSongId), { method: "DELETE" });
      resetSongEditor();
      setLibrary(data);
    } catch (error) {
      showError(error.message);
    }
  });

  ui.newSetlistBtn.addEventListener("click", resetSetlistEditor);
  ui.addSongBtn.addEventListener("click", () => {
    const songId = ui.addSongSelect.value;
    if (!songId) return;
    state.draftItems.push({ id: uid(), songId });
    renderSetlistItems();
  });
  ui.saveSetlistBtn.addEventListener("click", () => saveSetlist().catch((error) => showError(error.message)));
  ui.syncSetlistBtn.addEventListener("click", syncSetlist);
  ui.deleteSetlistBtn.addEventListener("click", async () => {
    if (!state.editingSetlistId || !confirm("Delete this setlist?")) return;
    try {
      const data = await api("/api/setlists/" + encodeURIComponent(state.editingSetlistId), { method: "DELETE" });
      resetSetlistEditor();
      setLibrary(data);
    } catch (error) {
      showError(error.message);
    }
  });

  ui.previewBtn.addEventListener("click", async () => {
    showError("");
    ui.previewBtn.disabled = true;
    try {
      const data = await api("/api/plan", {
        method: "POST",
        body: JSON.stringify({ text: ui.commandInput.value })
      });
      renderPlan(data.plan);
    } catch (error) {
      showError(error.message);
    } finally {
      ui.previewBtn.disabled = false;
    }
  });

  ui.applyBtn.addEventListener("click", async () => {
    if (!state.currentPlan) return;
    showError("");
    ui.applyBtn.disabled = true;
    ui.applyBtn.textContent = "Applying…";
    try {
      const data = await api("/api/apply", {
        method: "POST",
        body: JSON.stringify({ plan: state.currentPlan })
      });
      if (data.state) state.live = data.state;
      renderLive();
      ui.planCard.hidden = true;
      state.currentPlan = null;
    } catch (error) {
      showError(error.message);
    } finally {
      ui.applyBtn.disabled = false;
      ui.applyBtn.textContent = "Apply to Ableton";
    }
  });

  ui.cancelBtn.addEventListener("click", () => {
    state.currentPlan = null;
    ui.planCard.hidden = true;
  });

  ui.clearBtn.addEventListener("click", () => {
    ui.commandInput.value = "";
    showError("");
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  if (token) {
    const events = new EventSource("/events?token=" + encodeURIComponent(token));
    events.addEventListener("connected", () => setStatus(true));
    events.addEventListener("state", (event) => {
      try {
        state.live = JSON.parse(event.data);
        renderLive();
        setStatus(true);
      } catch (_) {}
    });
    events.addEventListener("library", (event) => {
      try {
        setLibrary(JSON.parse(event.data));
      } catch (_) {}
    });
    events.onerror = () => setStatus(false);
  } else {
    showError("Missing bridge token. Open the exact URL printed by Luma Live Bridge.");
  }

  resetSongEditor();
  resetSetlistEditor();
  refresh();
})();
