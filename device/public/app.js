(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const incoming = params.get("token");
  if (incoming) localStorage.setItem("lumaBridgeToken", incoming);
  const token = incoming || localStorage.getItem("lumaBridgeToken") || "";

  const el = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    "status","error","playBtn","playLabel","stopBtn","clickBtn","tempo","meter","barReadout",
    "previousSongBtn","previousSongName","nextSongBtn","nextSongName","currentSong","currentMeta",
    "songProgress","currentSection","nextSection","previousSectionBtn","nextSectionBtn",
    "liveSectionButtons","activeSetlistTitle","refreshBtn","liveSetlist","activeSongCount",
    "arrangementSetlist","savedSetlistCount","savedSetlistRemote","stopAll","sceneGrid","trackGrid",
    "songEditorHeading","newSongBtn","songTitle","songArtist","songBpm","songKey","songMeterNum",
    "songMeterDen","songLengthBars","songSections","deleteSongBtn","saveSongBtn","songCount","songList",
    "setlistEditorHeading","newSetlistBtn","setlistTitle","setlistGap","addSongSelect","addSongBtn",
    "setlistItems","deleteSetlistBtn","saveSetlistBtn","syncSetlistBtn","setlistCount","setlistList",
    "commandInput","clearBtn","previewBtn","planCard","planTitle","confidence","planList","planNotes",
    "cancelBtn","applyBtn"
  ].map((id) => [id, el(id)]));

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
    return crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : "item-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function showError(message) {
    ui.error.textContent = message || "";
    ui.error.hidden = !message;
  }

  function setStatus(online) {
    const text = ui.status.querySelector("span:last-child");
    if (text) text.textContent = online ? "CONNECTED" : "OFFLINE";
    ui.status.className = "status " + (online ? "online" : "offline");
  }

  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === name);
    });
    document.querySelectorAll(".page").forEach((page) => {
      page.classList.toggle("active", page.dataset.page === name);
    });
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

  function activeSetlist() {
    return state.setlists.find((item) => item.id === state.activeSetlistId) || null;
  }

  function activeSongPlacement() {
    const ctx = state.live && state.live.liveContext;
    if (!ctx || !state.arrangement) return null;
    return state.arrangement.songs.find((song) => song.instanceId === ctx.instanceId) || null;
  }

  function placementByInstance(instanceId) {
    if (!state.arrangement || !instanceId) return null;
    return state.arrangement.songs.find((song) => song.instanceId === instanceId) || null;
  }

  function currentSectionIndex(placement, ctx) {
    if (!placement || !ctx || !ctx.sectionId) return -1;
    return placement.sections.findIndex((section) => section.id === ctx.sectionId);
  }

  function setLibrary(data) {
    if (Array.isArray(data.songs)) state.songs = data.songs;
    if (Array.isArray(data.setlists)) state.setlists = data.setlists;
    if ("activeSetlistId" in data) state.activeSetlistId = data.activeSetlistId;
    if ("arrangement" in data) state.arrangement = data.arrangement;
    renderPrep();
    renderSetlistRemote();
    renderLive();
  }

  function renderTransport() {
    const live = state.live || {};
    const ctx = live.liveContext;

    ui.playBtn.classList.toggle("active", !!live.isPlaying);
    ui.playLabel.textContent = live.isPlaying ? "PLAYING" : "PLAY";
    ui.clickBtn.classList.toggle("active", !!live.metronome);
    ui.tempo.textContent = Number.isFinite(live.tempo) ? Math.round(live.tempo * 10) / 10 : "--";
    ui.meter.textContent = live.meter ? live.meter.numerator + "/" + live.meter.denominator : "--";
    ui.barReadout.textContent = ctx && Number.isFinite(ctx.currentBar)
      ? ctx.currentBar + "." + (ctx.beatInBar || 1)
      : "--";
  }

  function renderLive() {
    renderTransport();

    const live = state.live || {};
    const ctx = live.liveContext;
    const setlist = activeSetlist();
    const placement = activeSongPlacement();

    ui.activeSetlistTitle.textContent = setlist ? setlist.title : "No setlist synced";

    if (!ctx) {
      ui.currentSong.textContent = setlist ? "Waiting for playhead" : "No active setlist";
      ui.currentMeta.textContent = setlist
        ? "Move the Ableton playhead into a song."
        : "Build and sync a setlist in Prep.";
      ui.currentSection.textContent = "—";
      ui.nextSection.textContent = "—";
      ui.previousSongName.textContent = "—";
      ui.nextSongName.textContent = state.arrangement && state.arrangement.songs[0]
        ? state.arrangement.songs[0].title
        : "—";
      ui.previousSongBtn.disabled = true;
      ui.nextSongBtn.disabled = !(state.arrangement && state.arrangement.songs.length);
      ui.songProgress.style.width = "0%";
      ui.liveSectionButtons.innerHTML = "";
      ui.previousSectionBtn.disabled = true;
      ui.nextSectionBtn.disabled = true;
    } else {
      ui.currentSong.textContent = ctx.songTitle;
      ui.currentMeta.textContent = [
        ctx.bpm ? ctx.bpm + " BPM" : null,
        ctx.key || null,
        ctx.meter ? ctx.meter.numerator + "/" + ctx.meter.denominator : null
      ].filter(Boolean).join(" · ");

      ui.currentSection.textContent = ctx.sectionName || "COUNT / PRE-ROLL";
      ui.nextSection.textContent = ctx.nextSectionName || "END";
      ui.previousSongName.textContent = ctx.previousSong ? ctx.previousSong.title : "—";
      ui.nextSongName.textContent = ctx.nextSong ? ctx.nextSong.title : "—";
      ui.previousSongBtn.disabled = !ctx.previousSong;
      ui.nextSongBtn.disabled = !ctx.nextSong;
      ui.songProgress.style.width = Math.round((ctx.progress || 0) * 1000) / 10 + "%";

      ui.liveSectionButtons.innerHTML = "";
      if (placement) {
        placement.sections.forEach((section, index) => {
          const button = document.createElement("button");
          const active = section.id === ctx.sectionId;
          button.className = "section-button" + (active ? " active" : "");
          button.innerHTML =
            '<span class="section-index">' + String(index + 1).padStart(2, "0") + '</span>' +
            '<strong>' + escapeHtml(section.name) + '</strong>' +
            '<small>Bar ' + section.localStartBar + '</small>';
          button.addEventListener("click", () => jumpTo(placement, section.id));
          ui.liveSectionButtons.appendChild(button);
        });

        const sectionIndex = currentSectionIndex(placement, ctx);
        ui.previousSectionBtn.disabled = sectionIndex <= 0;
        ui.nextSectionBtn.disabled = sectionIndex < 0 || sectionIndex >= placement.sections.length - 1;
      }
    }

    renderServiceStack();
    renderSetlistRemote();
    renderBusk();
  }

  function renderServiceStack() {
    ui.liveSetlist.innerHTML = "";
    if (!state.arrangement || !state.arrangement.songs.length) {
      ui.liveSetlist.innerHTML = '<div class="empty">No Arrangement setlist is active.</div>';
      return;
    }

    const ctx = state.live && state.live.liveContext;
    state.arrangement.songs.forEach((song, index) => {
      const button = document.createElement("button");
      const active = ctx && ctx.instanceId === song.instanceId;
      button.className = "service-row" + (active ? " active" : "");
      button.innerHTML =
        '<span class="service-number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span class="service-copy"><strong>' + escapeHtml(song.title) + '</strong><small>' +
        escapeHtml(song.bpm + " BPM" + (song.key ? " · " + song.key : "")) +
        '</small></span>' +
        '<span class="service-go">' + (active ? "NOW" : "GO") + '</span>';
      button.addEventListener("click", () => jumpTo(song, null));
      ui.liveSetlist.appendChild(button);
    });
  }

  function renderSetlistRemote() {
    const arrangementSongs = state.arrangement && state.arrangement.songs || [];
    const ctx = state.live && state.live.liveContext;
    ui.activeSongCount.textContent = String(arrangementSongs.length);
    ui.savedSetlistCount.textContent = String(state.setlists.length);

    ui.arrangementSetlist.innerHTML = "";
    arrangementSongs.forEach((song, index) => {
      const active = ctx && ctx.instanceId === song.instanceId;
      const row = document.createElement("button");
      row.className = "arrangement-song" + (active ? " active" : "");
      row.innerHTML =
        '<span class="arrangement-number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span><strong>' + escapeHtml(song.title) + '</strong><small>' +
        escapeHtml(song.sections.length + " sections · " + song.bpm + " BPM" + (song.key ? " · " + song.key : "")) +
        '</small></span><span class="arrangement-go">' + (active ? "NOW" : "GO") + '</span>';
      row.addEventListener("click", () => jumpTo(song, null));
      ui.arrangementSetlist.appendChild(row);
    });

    if (!arrangementSongs.length) {
      ui.arrangementSetlist.innerHTML = '<div class="empty">Sync a saved setlist to build the Arrangement map.</div>';
    }

    ui.savedSetlistRemote.innerHTML = "";
    state.setlists.forEach((setlist) => {
      const active = setlist.id === state.activeSetlistId;
      const row = document.createElement("div");
      row.className = "saved-setlist-row" + (active ? " active" : "");
      row.innerHTML =
        '<span><strong>' + escapeHtml(setlist.title) + '</strong><small>' +
        setlist.items.length + ' song' + (setlist.items.length === 1 ? "" : "s") +
        (active ? " · ACTIVE" : "") + '</small></span>' +
        '<button class="' + (active ? "quiet" : "primary-action compact") + '">' +
        (active ? "Resync" : "Load") + '</button>';
      row.querySelector("button").addEventListener("click", () => syncExistingSetlist(setlist.id));
      ui.savedSetlistRemote.appendChild(row);
    });

    if (!state.setlists.length) {
      ui.savedSetlistRemote.innerHTML = '<div class="empty">No saved services yet. Build one in Prep.</div>';
    }
  }

  function renderBusk() {
    const live = state.live || {};

    ui.sceneGrid.innerHTML = "";
    (live.scenes || []).forEach((scene) => {
      const button = document.createElement("button");
      const active = scene.index === live.activeSceneIndex;
      button.className = "scene-button" + (active ? " active" : "");
      button.innerHTML =
        '<span class="scene-number">' + String(scene.number).padStart(2, "0") + '</span>' +
        '<strong>' + escapeHtml(scene.name) + '</strong>';
      button.addEventListener("click", () => direct({
        type: "fire_scene",
        args: { scene: { index: scene.index } }
      }));
      ui.sceneGrid.appendChild(button);
    });

    if (!(live.scenes || []).length) {
      ui.sceneGrid.innerHTML = '<div class="empty">No Session View scenes found.</div>';
    }

    ui.trackGrid.innerHTML = "";
    (live.tracks || []).forEach((track) => {
      const row = document.createElement("div");
      row.className = "track-row";
      row.innerHTML =
        '<span class="track-number">' + String(track.number).padStart(2, "0") + '</span>' +
        '<strong class="track-name">' + escapeHtml(track.name) + '</strong>' +
        '<button data-mute class="track-toggle' + (track.mute ? " active mute" : "") + '">M</button>' +
        '<button data-solo class="track-toggle' + (track.solo ? " active solo" : "") + '">S</button>';
      row.querySelector("[data-mute]").addEventListener("click", () => direct({
        type: "set_track_mute",
        args: { track: { index: track.index }, value: !track.mute }
      }));
      row.querySelector("[data-solo]").addEventListener("click", () => direct({
        type: "set_track_solo",
        args: { track: { index: track.index }, value: !track.solo }
      }));
      ui.trackGrid.appendChild(row);
    });
  }

  async function jumpTo(song, sectionId) {
    if (!song) return;
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

  async function jumpAdjacentSong(direction) {
    const ctx = state.live && state.live.liveContext;
    if (!ctx) {
      const first = state.arrangement && state.arrangement.songs[0];
      if (first && direction > 0) return jumpTo(first, null);
      return;
    }
    const ref = direction < 0 ? ctx.previousSong : ctx.nextSong;
    const song = ref && placementByInstance(ref.instanceId);
    if (song) await jumpTo(song, null);
  }

  async function jumpAdjacentSection(direction) {
    const ctx = state.live && state.live.liveContext;
    const placement = activeSongPlacement();
    if (!ctx || !placement) return;
    const index = currentSectionIndex(placement, ctx);
    const target = placement.sections[index + direction];
    if (target) await jumpTo(placement, target.id);
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
      return data;
    } catch (error) {
      showError(error.message);
      throw error;
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
    activateTab("prep");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    activateTab("prep");
  }

  function renderPrep() {
    ui.songCount.textContent = String(state.songs.length);
    ui.setlistCount.textContent = String(state.setlists.length);

    ui.addSongSelect.innerHTML = state.songs.length
      ? state.songs.map((song) => '<option value="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</option>').join("")
      : '<option value="">No songs saved</option>';

    ui.songList.innerHTML = "";
    state.songs.forEach((song) => {
      const row = document.createElement("button");
      row.className = "library-row";
      row.innerHTML =
        '<span><strong>' + escapeHtml(song.title) + '</strong><small>' +
        escapeHtml([song.artist, song.bpm + " BPM", song.key].filter(Boolean).join(" · ")) +
        '</small></span><span class="chev">›</span>';
      row.addEventListener("click", () => editSong(song));
      ui.songList.appendChild(row);
    });
    if (!state.songs.length) ui.songList.innerHTML = '<div class="empty">No reusable songs saved yet.</div>';

    ui.setlistList.innerHTML = "";
    state.setlists.forEach((setlist) => {
      const row = document.createElement("button");
      row.className = "library-row" + (setlist.id === state.activeSetlistId ? " active" : "");
      row.innerHTML =
        '<span><strong>' + escapeHtml(setlist.title) + '</strong><small>' +
        setlist.items.length + ' songs' + (setlist.id === state.activeSetlistId ? " · ACTIVE" : "") +
        '</small></span><span class="chev">›</span>';
      row.addEventListener("click", () => editSetlist(setlist));
      ui.setlistList.appendChild(row);
    });
    if (!state.setlists.length) ui.setlistList.innerHTML = '<div class="empty">No saved services yet.</div>';

    renderSetlistItems();
  }

  function renderSetlistItems() {
    ui.setlistItems.innerHTML = "";
    state.draftItems.forEach((item, index) => {
      const song = state.songs.find((entry) => entry.id === item.songId);
      const row = document.createElement("div");
      row.className = "setlist-item";
      row.innerHTML =
        '<span class="drag-number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span class="setlist-copy"><strong>' + escapeHtml(song ? song.title : item.songId) + '</strong><small>' +
        escapeHtml(song ? song.bpm + " BPM" + (song.key ? " · " + song.key : "") : "Missing song") +
        '</small></span>' +
        '<div class="row-actions">' +
        '<button data-up>↑</button><button data-down>↓</button><button data-remove>×</button></div>';

      const up = row.querySelector("[data-up]");
      const down = row.querySelector("[data-down]");
      up.disabled = index === 0;
      down.disabled = index === state.draftItems.length - 1;
      up.addEventListener("click", () => {
        [state.draftItems[index - 1], state.draftItems[index]] = [state.draftItems[index], state.draftItems[index - 1]];
        renderSetlistItems();
      });
      down.addEventListener("click", () => {
        [state.draftItems[index + 1], state.draftItems[index]] = [state.draftItems[index], state.draftItems[index + 1]];
        renderSetlistItems();
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        state.draftItems.splice(index, 1);
        renderSetlistItems();
      });
      ui.setlistItems.appendChild(row);
    });

    if (!state.draftItems.length) {
      ui.setlistItems.innerHTML = '<div class="empty boxed">Add songs in service order.</div>';
    }
  }

  async function saveSong() {
    showError("");
    try {
      const data = await api("/api/songs", {
        method: "POST",
        body: JSON.stringify({ song: songFormValue() })
      });
      setLibrary(data);
      editSong(data.song);
    } catch (error) {
      showError(error.message);
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

  async function syncExistingSetlist(setlistId) {
    showError("");
    try {
      const data = await api("/api/setlists/" + encodeURIComponent(setlistId) + "/sync", {
        method: "POST",
        body: "{}"
      });
      if (data.state) state.live = data.state;
      setLibrary(data);
      activateTab("live");
    } catch (error) {
      showError(error.message);
    }
  }

  async function syncDraftSetlist() {
    ui.syncSetlistBtn.disabled = true;
    ui.syncSetlistBtn.textContent = "Syncing…";
    try {
      const setlist = await saveSetlist();
      await syncExistingSetlist(setlist.id);
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
      start_playback: () => "Start Arrangement playback",
      stop_playback: () => "Stop Arrangement playback",
      set_metronome: () => (a.enabled ? "Turn click on" : "Turn click off"),
      create_track: () => "Create " + a.kind + " track · " + a.name,
      rename_track: () => "Rename track " + ref(a.track) + " → " + a.name,
      create_scene: () => "Create scene · " + a.name,
      rename_scene: () => "Rename scene " + ref(a.scene) + " → " + a.name,
      fire_scene: () => "Launch scene · " + ref(a.scene),
      stop_all_clips: () => "Stop all Session clips",
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
      row.innerHTML =
        '<span class="plan-number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span>' + escapeHtml(labelCommand(command)) + '</span>';
      ui.planList.appendChild(row);
    });
    ui.planNotes.innerHTML = (plan.notes || []).map((note) => "<div>• " + escapeHtml(note) + "</div>").join("");
    ui.planCard.hidden = false;
  }

  async function refresh() {
    try {
      const [liveData, libraryData] = await Promise.all([
        api("/api/state"),
        api("/api/library")
      ]);
      state.live = liveData.state;
      setLibrary(libraryData);
      setStatus(true);
      showError("");
    } catch (error) {
      setStatus(false);
      showError(error.message);
    }
  }

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  ui.playBtn.addEventListener("click", () => {
    const isPlaying = state.live && state.live.isPlaying;
    direct({ type: isPlaying ? "stop_playback" : "start_playback", args: {} }).catch(() => {});
  });
  ui.stopBtn.addEventListener("click", () => direct({ type: "stop_playback", args: {} }).catch(() => {}));
  ui.clickBtn.addEventListener("click", () => {
    const enabled = !!(state.live && state.live.metronome);
    direct({ type: "set_metronome", args: { enabled: !enabled } }).catch(() => {});
  });

  ui.previousSongBtn.addEventListener("click", () => jumpAdjacentSong(-1));
  ui.nextSongBtn.addEventListener("click", () => jumpAdjacentSong(1));
  ui.previousSectionBtn.addEventListener("click", () => jumpAdjacentSection(-1));
  ui.nextSectionBtn.addEventListener("click", () => jumpAdjacentSection(1));
  ui.refreshBtn.addEventListener("click", refresh);
  ui.stopAll.addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }).catch(() => {}));

  ui.newSongBtn.addEventListener("click", resetSongEditor);
  ui.saveSongBtn.addEventListener("click", saveSong);
  ui.deleteSongBtn.addEventListener("click", async () => {
    if (!state.editingSongId || !confirm("Delete this song from the bridge library?")) return;
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
  ui.syncSetlistBtn.addEventListener("click", syncDraftSetlist);
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
