(() => {
  "use strict";

  const invoke = window.__TAURI__.core.invoke;
  const $ = (id) => document.getElementById(id);

  const state = {
    songs: [],
    setlists: [],
    runtime: null,
    live: null,
    arrangement: null,
    activeSetlistId: null,
    editingSongId: null,
    editingSetlistId: null,
    draftItems: [],
    pendingPlainText: null,
    mixerSignature: "",
    sectionSignature: "",
    sceneSignature: "",
    buskSignature: "",
    packageStatuses: {},
    lastBuildFolder: null
  };

  const volumeTimers = new Map();
  let swingTimer = null;

  const titles = {
    live: ["LIVE", "Song Control"],
    busk: ["SESSION VIEW", "Busk"],
    songs: ["LIBRARY", "Songs"],
    setlists: ["SERVICES", "Setlists"],
    settings: ["SYSTEM", "Settings"]
  };

  function showError(message) {
    const box = $("error");
    box.textContent = message || "";
    box.hidden = !message;
  }

  function showNotice(message) {
    const box = $("notice");
    box.textContent = message || "";
    box.hidden = !message;
    if (message) {
      clearTimeout(showNotice.timer);
      showNotice.timer = setTimeout(() => { box.hidden = true; }, 2500);
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : "item-" + Date.now() + "-" + Math.random();
  }

  function liveColor(value, fallback = "#23272d") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return "#" + (n & 0xFFFFFF).toString(16).padStart(6, "0");
  }

  function readableText(hex) {
    const clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return "#f3f4f5";
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#101214" : "#ffffff";
  }

  function transposeKey(key, semitones) {
    const match = String(key || "").trim().match(/^([A-Ga-g])([#b]?)(m?)$/);
    if (!match || !semitones) return String(key || "").trim();
    const useFlats = match[2] === "b";
    const sharps = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const flats = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
    const lookup = {C:0,"C#":1,Db:1,D:2,"D#":3,Eb:3,E:4,F:5,"F#":6,Gb:6,G:7,"G#":8,Ab:8,A:9,"A#":10,Bb:10,B:11};
    const tonic = match[1].toUpperCase() + match[2];
    const index = lookup[tonic];
    if (index == null) return String(key || "").trim();
    const shifted = (index + Number(semitones) % 12 + 12) % 12;
    return (useFlats ? flats : sharps)[shifted] + match[3];
  }


  function go(page) {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
    document.querySelectorAll(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
    $("pageEyebrow").textContent = titles[page][0];
    $("pageTitle").textContent = titles[page][1];
  }

  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => go(item.dataset.page)));

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

  function currentPackageStatus() {
    return state.editingSongId ? state.packageStatuses[state.editingSongId] || null : null;
  }

  function renderSongPackageStatus() {
    const status = currentPackageStatus();
    const enabled = !!state.editingSongId;
    ["openSongFolder","attachSongProject","importSongStems","rescanSongPackage"].forEach((id) => {
      $(id).disabled = !enabled;
    });

    if (!status) {
      $("songPackageBadge").textContent = enabled ? "CHECKING" : "NEW";
      $("songPackagePath").textContent = enabled ? "Rescan to inspect this package" : "Save the song first";
      $("songProjectStatus").textContent = "Not attached";
      $("songStemStatus").textContent = "0";
      $("songCueStatus").textContent = "0";
      $("songPackageWarning").textContent = enabled
        ? "Attach the Ableton Project and import original stems before building a service."
        : "Save the song, then attach its Ableton Project and original stems here.";
      return;
    }

    $("songPackageBadge").textContent = status.sourceAls && status.stemCount > 0 ? "READY" : "NEEDS FILES";
    $("songPackagePath").textContent = status.packagePath || "Unavailable";
    $("songProjectStatus").textContent = status.sourceAls || (status.projectAttached ? "Project attached · no .als found" : "Not attached");
    $("songStemStatus").textContent = String(status.stemCount || 0);
    $("songCueStatus").textContent = String(status.cueCount || 0);
    $("songPackageWarning").textContent = (status.warnings || []).join(" · ") ||
      "Song package is ready to be collected into a service.";
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
    $("saveSongCopy").hidden = true;
    $("saveSong").textContent = "Create Song";
    renderSongPackageStatus();
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
    $("saveSongCopy").hidden = false;
    $("saveSong").textContent = "Update Song";
    renderSongPackageStatus();
  }

  function renderSongs() {
    $("songCount").textContent = state.songs.length;
    const list = $("songList");
    list.innerHTML = "";
    state.songs.forEach((song) => {
      const status = state.packageStatuses[song.id];
      const ready = status && status.sourceAls && status.stemCount > 0;
      const button = document.createElement("button");
      button.className = "data-row song-data-row";
      button.innerHTML =
        '<span><b>' + escapeHtml(song.title) + '</b><small>' +
        escapeHtml([song.artist, song.bpm + " BPM", song.key].filter(Boolean).join(" · ")) +
        '</small></span><span class="package-mini ' + (ready ? "ready" : "waiting") + '">' +
        (ready ? "FILES READY" : (status ? (status.stemCount + " STEMS") : "CHECKING")) +
        '</span><span class="arrow">›</span>';
      button.addEventListener("click", () => editSong(song));
      list.appendChild(button);
    });
    if (!state.songs.length) list.innerHTML = '<div class="empty">Your song library is empty.</div>';

    $("songPicker").innerHTML = state.songs.length
      ? state.songs.map((song) => '<option value="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</option>').join("")
      : '<option value="">No songs saved</option>';
  }

  async function saveSong(copyAsNew = false) {
    showError("");
    try {
      const payload = songPayload();
      if (copyAsNew) payload.id = null;
      const song = await invoke("save_song", { song: payload });
      await loadLibrary();
      try {
        const status = await invoke("rescan_song_package", { id: song.id });
        state.packageStatuses[song.id] = status;
      } catch (_) {}
      editSong(song);
      recomputeArrangement();
      renderLive();
      showNotice(copyAsNew ? "Created a new song package." : (payload.id ? "Song updated." : "Song created."));
      return song;
    } catch (error) {
      showError(error);
      return null;
    }
  }

  function defaultTransition() {
    return { mode: "inherit", bars: 0, vampSectionId: null };
  }

  function normalizeTransition(value) {
    const raw = value || {};
    return {
      mode: raw.mode || "inherit",
      bars: Number.isFinite(Number(raw.bars)) ? Number(raw.bars) : 0,
      vampSectionId: raw.vampSectionId || null
    };
  }

  function resetSetlistEditor() {
    state.editingSetlistId = null;
    state.draftItems = [];
    $("setlistEditorTitle").textContent = "New Setlist";
    $("setlistTitle").value = "";
    $("setlistGap").value = "4";
    $("deleteSetlist").hidden = true;
    $("syncSetlist").disabled = true;
    renderDraft();
  }

  function editSetlist(setlist) {
    state.editingSetlistId = setlist.id;
    state.draftItems = setlist.items.map((item) => ({
      ...item,
      transition: normalizeTransition(item.transition),
      transposeSemitones: Number(item.transposeSemitones || 0)
    }));
    $("setlistEditorTitle").textContent = setlist.title;
    $("setlistTitle").value = setlist.title;
    $("setlistGap").value = setlist.gapBars;
    $("deleteSetlist").hidden = false;
    $("syncSetlist").disabled = false;
    renderDraft();
  }

  function transitionLabel(transition, song) {
    const t = normalizeTransition(transition);
    if (t.mode === "inherit") return "Default Gap";
    if (t.mode === "gap") return t.bars + " Bar Gap";
    if (t.mode === "segue") return "Segue";
    if (t.mode === "hold") return "Hold";
    if (t.mode === "mashup") return "Mashup · " + t.bars + " Bar" + (t.bars === 1 ? "" : "s");
    if (t.mode === "vamp") {
      const section = song && (song.sections || []).find((item) => item.id === t.vampSectionId);
      return "Vamp · " + (section ? section.name : "Choose Section");
    }
    return t.mode;
  }

  function renderTransitionEditor(row, item, song, index) {
    const host = row.querySelector(".transition-editor");
    if (!host) return;
    const isLast = index === state.draftItems.length - 1;
    if (isLast) {
      host.innerHTML = '<span class="transition-end">END OF SERVICE</span>';
      return;
    }

    const transition = normalizeTransition(item.transition);
    item.transition = transition;

    host.innerHTML =
      '<label class="transition-mode-label">AFTER THIS SONG' +
        '<select class="transition-mode">' +
          '<option value="inherit">Default Gap</option>' +
          '<option value="gap">Gap</option>' +
          '<option value="segue">Segue / No Gap</option>' +
          '<option value="hold">Hold / Stop</option>' +
          '<option value="vamp">Vamp Until Released</option>' +
          '<option value="mashup">Mashup / Overlap</option>' +
        '</select>' +
      '</label>' +
      '<div class="transition-detail"></div>';

    const mode = host.querySelector(".transition-mode");
    mode.value = transition.mode;
    const detail = host.querySelector(".transition-detail");

    function renderDetail() {
      const selected = mode.value;
      transition.mode = selected;

      if (selected === "gap" || selected === "mashup") {
        if (!transition.bars) transition.bars = selected === "mashup" ? 4 : 2;
        detail.innerHTML =
          '<label>' + (selected === "mashup" ? "OVERLAP BARS" : "GAP BARS") +
          '<input class="transition-bars" type="number" min="0" max="64" value="' +
          Math.max(0, Number(transition.bars || 0)) + '"></label>';
        detail.querySelector(".transition-bars").addEventListener("input", (event) => {
          transition.bars = Math.max(0, Number(event.target.value || 0));
        });
      } else if (selected === "vamp") {
        const sections = song ? song.sections || [] : [];
        if (!transition.vampSectionId && sections.length) {
          const likely = sections.find((section) => /vamp|bridge|chorus/i.test(section.name));
          transition.vampSectionId = (likely || sections[sections.length - 1]).id;
        }
        detail.innerHTML =
          '<label>VAMP SECTION<select class="transition-vamp">' +
          sections.map((section) =>
            '<option value="' + escapeHtml(section.id) + '">' + escapeHtml(section.name) + '</option>'
          ).join("") + '</select></label>';
        const picker = detail.querySelector(".transition-vamp");
        if (picker) {
          picker.value = transition.vampSectionId || "";
          picker.addEventListener("change", () => transition.vampSectionId = picker.value || null);
        }
      } else if (selected === "hold") {
        detail.innerHTML = '<span class="transition-note">Stop at the song boundary. Continue when you are ready.</span>';
        transition.bars = 0;
        transition.vampSectionId = null;
      } else if (selected === "segue") {
        detail.innerHTML = '<span class="transition-note">Next song starts on the exact next downbeat with no gap.</span>';
        transition.bars = 0;
        transition.vampSectionId = null;
      } else {
        detail.innerHTML = '<span class="transition-note">Uses the service default gap of ' +
          Number($("setlistGap").value || 0) + ' bars.</span>';
        transition.bars = 0;
        transition.vampSectionId = null;
      }
    }

    mode.addEventListener("change", renderDetail);
    renderDetail();
  }

  function renderDraft() {
    const host = $("setlistItems");
    host.innerHTML = "";

    state.draftItems.forEach((item, index) => {
      const song = state.songs.find((entry) => entry.id === item.songId);
      item.transition = normalizeTransition(item.transition);
      item.transposeSemitones = Number(item.transposeSemitones || 0);

      const row = document.createElement("div");
      row.className = "setlist-item transition-setlist-item";
      row.innerHTML =
        '<span class="number">' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span class="item-copy"><b>' + escapeHtml(song ? song.title : item.songId) + '</b><small>' +
        escapeHtml(song ? song.bpm + " BPM" + (song.key ? " · " + song.key : "") : "Missing song") +
        '</small></span>' +
        '<div class="mini-actions"><button data-up>↑</button><button data-down>↓</button><button data-remove>×</button></div>' +
        '<div class="song-key-control">' +
          '<label>KEY SHIFT<select data-transpose>' +
            Array.from({length:25},(_,i)=>i-12).map((value) =>
              '<option value="' + value + '">' + (value === 0 ? "Original" : (value > 0 ? "+" + value : value) + " semitone" + (Math.abs(value) === 1 ? "" : "s")) + '</option>'
            ).join("") +
          '</select></label>' +
          '<span data-effective-key></span>' +
        '</div>' +
        '<div class="transition-editor"></div>';

      const transpose = row.querySelector("[data-transpose]");
      transpose.value = String(item.transposeSemitones);
      const effective = row.querySelector("[data-effective-key]");
      const refreshEffectiveKey = () => {
        const shift = Number(transpose.value || 0);
        item.transposeSemitones = shift;
        const original = song && song.key ? song.key : "";
        const result = transposeKey(original, shift);
        effective.textContent = original
          ? (shift ? original + " → " + (result || original) : original + " · original")
          : (shift ? (shift > 0 ? "+" : "") + shift + " st" : "No key metadata");
      };
      transpose.addEventListener("change", refreshEffectiveKey);
      refreshEffectiveKey();

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
      renderTransitionEditor(row, item, song, index);
    });

    if (!state.draftItems.length) {
      host.innerHTML = '<div class="empty boxed">Add songs in service order.</div>';
    }
  }

  function setlistPayload() {
    return {
      id: state.editingSetlistId,
      title: $("setlistTitle").value.trim(),
      gapBars: Number($("setlistGap").value),
      items: state.draftItems.map((item) => ({
        id: item.id,
        songId: item.songId,
        transition: normalizeTransition(item.transition),
        transposeSemitones: Number(item.transposeSemitones || 0)
      }))
    };
  }

  function renderSetlists() {
    $("setlistCount").textContent = state.setlists.length;
    const list = $("setlistList");
    list.innerHTML = "";

    state.setlists.forEach((setlist) => {
      const row = document.createElement("div");
      row.className = "data-row setlist-data-row" + (setlist.id === state.activeSetlistId ? " active" : "");
      row.innerHTML =
        '<button class="row-main"><span><b>' + escapeHtml(setlist.title) + '</b><small>' +
        setlist.items.length + ' song' + (setlist.items.length === 1 ? "" : "s") +
        (setlist.id === state.activeSetlistId ? " · ACTIVE" : "") +
        '</small></span><span class="arrow">›</span></button>' +
        '<button class="row-sync">' + (setlist.id === state.activeSetlistId ? "Resync" : "Sync") + '</button>';
      row.querySelector(".row-main").addEventListener("click", () => editSetlist(setlist));
      row.querySelector(".row-sync").addEventListener("click", () => syncSetlistById(setlist.id));
      list.appendChild(row);
    });
    if (!state.setlists.length) list.innerHTML = '<div class="empty">No saved setlists yet.</div>';
  }

  async function saveSetlist() {
    showError("");
    try {
      const setlist = await invoke("save_setlist", { setlist: setlistPayload() });
      await loadLibrary();
      editSetlist(setlist);
      recomputeArrangement();
      return setlist;
    } catch (error) {
      showError(error);
      return null;
    }
  }

  function buildArrangement(setlist) {
    if (!setlist) return null;
    const songsById = new Map(state.songs.map((song) => [song.id, song]));
    let cursor = 0;
    const songs = [];
    const transitions = [];

    setlist.items.forEach((item, index) => {
      const song = songsById.get(item.songId);
      if (!song) return;
      const numerator = Number(song.meter && song.meter.numerator || 4);
      const denominator = Number(song.meter && song.meter.denominator || 4);
      const beatsPerBar = numerator * (4 / denominator);
      const startBeat = cursor;
      const endBeat = startBeat + Number(song.lengthBars) * beatsPerBar;
      const sections = (song.sections || []).map((section) => ({
        id: section.id,
        name: section.name,
        localStartBar: section.startBar,
        startBeat: startBeat + (Number(section.startBar) - 1) * beatsPerBar
      }));

      songs.push({
        instanceId: item.id,
        songId: song.id,
        title: song.title,
        artist: song.artist || "",
        bpm: Number(song.bpm),
        key: song.key || "",
        transposeSemitones: Number(item.transposeSemitones || 0),
        meter: song.meter,
        startBeat,
        endBeat,
        sections
      });

      const nextItem = setlist.items[index + 1];
      if (!nextItem) {
        cursor = endBeat;
        return;
      }

      const transition = normalizeTransition(item.transition);
      let nextStart = endBeat;
      if (transition.mode === "inherit") {
        nextStart += Number(setlist.gapBars || 0) * beatsPerBar;
      } else if (transition.mode === "gap") {
        nextStart += Number(transition.bars || 0) * beatsPerBar;
      } else if (transition.mode === "hold") {
        nextStart += beatsPerBar;
      } else if (transition.mode === "mashup") {
        nextStart -= Number(transition.bars || 0) * beatsPerBar;
      }

      transitions.push({
        fromInstanceId: item.id,
        toInstanceId: nextItem.id,
        mode: transition.mode,
        bars: transition.bars,
        nextStartBeat: nextStart,
        vampSectionId: transition.vampSectionId
      });
      cursor = nextStart;
    });

    return {
      setlistId: setlist.id,
      title: setlist.title,
      startBeat: 0,
      endBeat: songs.reduce((max, song) => Math.max(max, song.endBeat), cursor),
      songs,
      transitions
    };
  }

  function recomputeArrangement() {
    const active = state.setlists.find((item) => item.id === state.activeSetlistId);
    state.arrangement = active ? buildArrangement(active) : null;
  }

  function currentPlacement() {
    const ctx = state.live && state.live.liveContext;
    if (!ctx || !state.arrangement) return null;
    return state.arrangement.songs.find((song) => song.instanceId === ctx.instanceId) || null;
  }

  function updateBridgeStatus() {
    const connected = !!(state.live && state.live.bridgeConnected);
    $("bridgeDot").className = "dot " + (connected ? "ready" : "waiting");
    $("bridgeStatus").textContent = connected ? "Ableton connected" : "Ableton offline";
  }

  function renderTransport() {
    const live = state.live || {};
    const ctx = live.liveContext;
    $("desktopPlay").classList.toggle("active", !!live.isPlaying);
    $("desktopPlayLabel").textContent = live.isPlaying ? "Playing" : "Play";
    $("desktopClick").classList.toggle("active", !!live.metronome);
    $("desktopTempo").textContent = Number.isFinite(live.tempo) ? Math.round(live.tempo * 10) / 10 : "--";
    $("desktopMeter").textContent = live.meter ? live.meter.numerator + "/" + live.meter.denominator : "--";
    $("desktopBar").textContent = ctx && Number.isFinite(ctx.currentBar) ? ctx.currentBar + "." + (ctx.beatInBar || 1) : "--";
  }

  function renderSections(placement, ctx) {
    const sections = placement ? placement.sections || [] : [];
    const signature = placement
      ? placement.instanceId + "|" + sections.map((s) => s.id + ":" + s.name + ":" + s.localStartBar).join("|")
      : "";

    if (signature !== state.sectionSignature) {
      state.sectionSignature = signature;
      $("desktopSectionGrid").innerHTML = "";
      sections.forEach((section, index) => {
        const button = document.createElement("button");
        button.className = "desktop-section";
        button.dataset.sectionId = section.id;
        button.innerHTML =
          '<span>' + String(index + 1).padStart(2, "0") + '</span>' +
          '<strong>' + escapeHtml(section.name) + '</strong>' +
          '<small>Bar ' + section.localStartBar + '</small>';
        button.addEventListener("click", () => jumpTo(placement, section.id));
        $("desktopSectionGrid").appendChild(button);
      });
    }

    $("desktopSectionGrid").querySelectorAll(".desktop-section").forEach((button) => {
      button.classList.toggle("active", !!ctx && button.dataset.sectionId === ctx.sectionId);
    });

    const currentIndex = placement && ctx && ctx.sectionId
      ? sections.findIndex((section) => section.id === ctx.sectionId)
      : -1;
    $("desktopPrevSection").disabled = !placement || currentIndex <= 0;
    $("desktopNextSectionBtn").disabled = !placement || !sections.length || currentIndex >= sections.length - 1;
  }

  function renderMixer() {
    const tracks = state.live && Array.isArray(state.live.tracks) ? state.live.tracks : [];
    const signature = tracks.map((track) => track.index + ":" + track.name).join("|");

    if (signature !== state.mixerSignature) {
      state.mixerSignature = signature;
      $("desktopMixer").innerHTML = "";
      tracks.forEach((track) => {
        const row = document.createElement("div");
        row.className = "desktop-mixer-row";
        row.dataset.trackIndex = track.index;
        row.innerHTML =
          '<span class="mix-num">' + String(track.number).padStart(2, "0") + '</span>' +
          '<strong>' + escapeHtml(track.name) + '</strong>' +
          '<input type="range" min="0" max="1" step="0.01" value="' +
          (Number.isFinite(track.volume) ? track.volume : 0.85) + '">' +
          '<span class="mix-value">--</span>' +
          '<button class="mix-toggle mute">M</button>' +
          '<button class="mix-toggle solo">S</button>';

        const slider = row.querySelector('input[type="range"]');
        slider.addEventListener("pointerdown", () => slider.dataset.dragging = "1");
        const release = () => delete slider.dataset.dragging;
        slider.addEventListener("pointerup", release);
        slider.addEventListener("pointercancel", release);
        slider.addEventListener("input", () => {
          row.querySelector(".mix-value").textContent = Math.round(Number(slider.value) * 100) + "%";
          clearTimeout(volumeTimers.get(track.index));
          volumeTimers.set(track.index, setTimeout(() => {
            direct({
              type: "set_track_volume",
              args: { track: { index: track.index }, value: Number(slider.value) }
            }).catch(() => {});
          }, 90));
        });

        row.querySelector(".mute").addEventListener("click", () => {
          const current = (state.live.tracks || []).find((item) => item.index === track.index);
          direct({
            type: "set_track_mute",
            args: { track: { index: track.index }, value: !(current && current.mute) }
          }).catch(() => {});
        });
        row.querySelector(".solo").addEventListener("click", () => {
          const current = (state.live.tracks || []).find((item) => item.index === track.index);
          direct({
            type: "set_track_solo",
            args: { track: { index: track.index }, value: !(current && current.solo) }
          }).catch(() => {});
        });

        $("desktopMixer").appendChild(row);
      });
    }

    tracks.forEach((track) => {
      const row = $("desktopMixer").querySelector('[data-track-index="' + track.index + '"]');
      if (!row) return;
      const slider = row.querySelector('input[type="range"]');
      if (!slider.dataset.dragging && Number.isFinite(track.volume)) slider.value = track.volume;
      row.querySelector(".mix-value").textContent = Number.isFinite(track.volume) ? Math.round(track.volume * 100) + "%" : "--";
      row.querySelector(".mute").classList.toggle("active", !!track.mute);
      row.querySelector(".solo").classList.toggle("active", !!track.solo);
    });

    if (!tracks.length) $("desktopMixer").innerHTML = '<div class="empty">Open Ableton and load Luma Live.amxd to see track controls.</div>';
  }

  function renderBusk() {
    const live = state.live || {};
    $("desktopBuskClick").classList.toggle("active", !!live.metronome);
    $("desktopSessionRecord").classList.toggle("active", !!live.sessionRecord);
    $("desktopCaptureMidi").disabled = live.canCaptureMidi === false;
    $("desktopUndo").disabled = live.canUndo === false;
    $("desktopRedo").disabled = live.canRedo === false;
    const selectedClip = live.selectedClip || null;
    $("desktopClearClip").disabled = !(selectedClip && selectedClip.hasClip);
    $("desktopDuplicateClip").disabled = !(selectedClip && selectedClip.hasClip);
    $("desktopDoubleClip").disabled = !(selectedClip && selectedClip.hasClip && selectedClip.isMidiClip);
    const swing = Number.isFinite(Number(live.swingAmount)) ? Number(live.swingAmount) : 0;
    if (document.activeElement !== $("desktopSwing")) $("desktopSwing").value = String(swing);
    $("desktopSwingValue").textContent = Math.round(swing * 100) + "%";
    const session = live.session || {};
    const tracks = Array.isArray(session.tracks) ? session.tracks : [];
    const scenes = Array.isArray(session.scenes) && session.scenes.length ? session.scenes : (Array.isArray(live.scenes) ? live.scenes : []);

    $("desktopBuskMeta").textContent = [
      tracks.length + " tracks",
      scenes.length + " scenes",
      Number.isFinite(Number(live.tempo)) ? Math.round(Number(live.tempo) * 10) / 10 + " BPM" : null
    ].filter(Boolean).join(" · ");

    const signature = JSON.stringify({
      activeSceneIndex: live.activeSceneIndex,
      tracks: tracks.map((track) => [
        track.index, track.name, track.color, track.playingSlotIndex, track.firedSlotIndex,
        track.mute, track.solo, track.volume,
        (track.clips || []).map((clip) => [clip.sceneIndex, clip.hasClip, clip.name, clip.color, clip.isRecording])
      ]),
      scenes: scenes.map((scene) => [scene.index, scene.name, scene.color, scene.tempoEnabled, scene.tempo, scene.isTriggered])
    });
    if (signature === state.buskSignature) return;
    state.buskSignature = signature;

    const host = $("desktopBuskGrid");
    host.innerHTML = "";
    if (!tracks.length || !scenes.length) {
      host.innerHTML = '<div class="empty boxed">No Session View grid yet. Click Sync after Ableton finishes loading.</div>';
      return;
    }

    const grid = document.createElement("div");
    grid.className = "desktop-session-matrix";
    grid.style.gridTemplateColumns = "150px 52px repeat(" + tracks.length + ", minmax(132px,1fr))";

    const sceneHeader = document.createElement("div");
    sceneHeader.className = "busk-matrix-label";
    sceneHeader.textContent = "SCENES";
    grid.appendChild(sceneHeader);
    grid.appendChild(document.createElement("div"));

    tracks.forEach((track, index) => {
      const header = document.createElement("div");
      header.className = "busk-track-header";
      header.style.borderTopColor = liveColor(track.color);
      const volume = Number.isFinite(Number(track.volume)) ? Math.round(Number(track.volume) * 100) : null;
      header.innerHTML =
        '<div class="busk-track-title">' +
          '<span>' + String(index + 1).padStart(2, "0") + '</span>' +
          '<strong>' + escapeHtml(track.name || ("Track " + (index + 1))) + '</strong>' +
        '</div>' +
        '<small>' +
          (Number(track.playingSlotIndex) >= 0 ? "PLAYING SCENE " + (Number(track.playingSlotIndex) + 1) : "STOPPED") +
          (volume == null ? "" : " · " + volume + "%") +
        '</small>' +
        '<div class="busk-track-actions">' +
          '<button class="busk-mini-toggle mute' + (track.mute ? " active" : "") + '" title="Mute">M</button>' +
          '<button class="busk-mini-toggle solo' + (track.solo ? " active" : "") + '" title="Solo">S</button>' +
        '</div>';
      header.querySelector(".mute").addEventListener("click", () => direct({
        type: "set_track_mute",
        args: { track: { index: Number(track.index) }, value: !track.mute }
      }).catch((error) => showError(error)));
      header.querySelector(".solo").addEventListener("click", () => direct({
        type: "set_track_solo",
        args: { track: { index: Number(track.index) }, value: !track.solo }
      }).catch((error) => showError(error)));
      grid.appendChild(header);
    });

    scenes.forEach((scene, sceneIndex) => {
      const info = document.createElement("div");
      info.className = "busk-scene-info" + (Number(scene.index) === Number(live.activeSceneIndex) ? " active" : "");
      info.innerHTML =
        '<strong>' + escapeHtml(scene.name || ("Scene " + (sceneIndex + 1))) + '</strong>' +
        '<small>' + String(Number(scene.index ?? sceneIndex) + 1).padStart(2, "0") +
        (scene.tempoEnabled && Number(scene.tempo) > 0 ? " · " + Math.round(Number(scene.tempo) * 10) / 10 + " BPM" : "") + '</small>';
      grid.appendChild(info);

      const sceneLaunch = document.createElement("button");
      sceneLaunch.className = "busk-scene-launch";
      sceneLaunch.textContent = "▶";
      sceneLaunch.title = "Launch " + (scene.name || ("Scene " + (sceneIndex + 1)));
      sceneLaunch.addEventListener("click", () => direct({
        type: "fire_scene",
        args: { scene: { index: Number(scene.index ?? sceneIndex) } }
      }).catch((error) => showError(error)));
      grid.appendChild(sceneLaunch);

      tracks.forEach((track) => {
        const clip = (track.clips || []).find((entry) => Number(entry.sceneIndex) === Number(scene.index ?? sceneIndex));
        const cell = document.createElement("button");
        const hasClip = !!(clip && clip.hasClip);
        const playing = Number(track.playingSlotIndex) === Number(scene.index ?? sceneIndex);
        const fired = Number(track.firedSlotIndex) === Number(scene.index ?? sceneIndex);
        cell.className = "desktop-clip-cell" + (hasClip ? " has-clip" : "") + (playing ? " playing" : "") + (fired ? " fired" : "");

        if (hasClip) {
          const bg = liveColor(clip.color, liveColor(track.color));
          cell.style.background = bg;
          cell.style.color = readableText(bg);
          cell.innerHTML =
            '<strong>' + escapeHtml(clip.name || "Clip") + '</strong>' +
            '<small>' + (playing ? "PLAYING" : fired ? "QUEUED" : "Launch") + '</small>';
          cell.addEventListener("click", () => direct({
            type: "fire_clip",
            args: { trackIndex: Number(track.index), sceneIndex: Number(scene.index ?? sceneIndex) }
          }).catch((error) => showError(error)));
        } else {
          cell.disabled = true;
          cell.innerHTML = '<span class="empty-dot">■</span>';
        }
        grid.appendChild(cell);
      });
    });

    const stopLabel = document.createElement("div");
    stopLabel.className = "busk-matrix-label";
    stopLabel.textContent = "TRACK STOP";
    grid.appendChild(stopLabel);
    grid.appendChild(document.createElement("div"));

    tracks.forEach((track) => {
      const stop = document.createElement("button");
      stop.className = "busk-track-stop";
      stop.textContent = "■ STOP";
      stop.addEventListener("click", () => direct({
        type: "stop_track",
        args: { trackIndex: Number(track.index) }
      }).catch((error) => showError(error)));
      grid.appendChild(stop);
    });

    host.appendChild(grid);
  }

  function renderService() {
    const songs = state.arrangement && state.arrangement.songs || [];
    const ctx = state.live && state.live.liveContext;
    const setlist = state.setlists.find((item) => item.id === state.activeSetlistId);
    $("desktopServiceTitle").textContent = setlist ? setlist.title : "No setlist loaded";
    $("desktopServiceCount").textContent = songs.length;
    $("desktopServiceOrder").innerHTML = "";

    songs.forEach((song, index) => {
      const button = document.createElement("button");
      button.className = "live-service-row" + (ctx && ctx.instanceId === song.instanceId ? " active" : "");
      button.innerHTML =
        '<span>' + String(index + 1).padStart(2, "0") + '</span>' +
        '<span><b>' + escapeHtml(song.title) + '</b><small>' +
        escapeHtml(song.bpm + " BPM" + (song.key ? " · " + transposeKey(song.key, song.transposeSemitones || 0) : "") +
          (song.transposeSemitones ? " · " + (song.transposeSemitones > 0 ? "+" : "") + song.transposeSemitones + " st" : "")) +
        '</small></span><em>' + (ctx && ctx.instanceId === song.instanceId ? "NOW" : "GO") + '</em>';
      button.addEventListener("click", () => jumpTo(song, null));
      $("desktopServiceOrder").appendChild(button);
    });

    if (!songs.length) $("desktopServiceOrder").innerHTML = '<div class="empty">Sync a setlist to Ableton.</div>';
  }

  function renderLive() {
    updateBridgeStatus();
    renderTransport();
    const live = state.live || {};
    const ctx = live.liveContext;
    const placement = currentPlacement();

    if (!ctx) {
      $("desktopCurrentSong").textContent = state.activeSetlistId ? "Waiting for playhead" : "No service loaded";
      $("desktopCurrentMeta").textContent = live.bridgeConnected
        ? "Sync a setlist or move the playhead into a song."
        : "Open Ableton and load Luma Live.amxd.";
      $("desktopCurrentSection").textContent = "—";
      $("desktopNextSection").textContent = "—";
      $("desktopProgress").style.width = "0%";
      $("desktopPrevSong").disabled = true;
      $("desktopNextSong").disabled = !(state.arrangement && state.arrangement.songs && state.arrangement.songs.length);
    } else {
      $("desktopCurrentSong").textContent = ctx.songTitle;
      $("desktopCurrentMeta").textContent = [
        ctx.bpm + " BPM",
        ctx.key ? transposeKey(ctx.key, ctx.transposeSemitones || 0) : null,
        ctx.transposeSemitones ? ((ctx.transposeSemitones > 0 ? "+" : "") + ctx.transposeSemitones + " st") : null,
        ctx.meter ? ctx.meter.numerator + "/" + ctx.meter.denominator : null,
        state.arrangement ? "Song " + (ctx.songIndex + 1) + " of " + state.arrangement.songs.length : null
      ].filter(Boolean).join(" · ");
      $("desktopCurrentSection").textContent = ctx.sectionName || "COUNT / PRE-ROLL";
      $("desktopNextSection").textContent = ctx.nextSectionName || "END";
      $("desktopProgress").style.width = Math.round((ctx.progress || 0) * 1000) / 10 + "%";
      $("desktopPrevSong").disabled = !ctx.previousSong;
      $("desktopNextSong").disabled = !ctx.nextSong;
    }

    renderSections(placement, ctx);
    renderMixer();
    renderBusk();
    renderService();
  }

  async function direct(command) {
    const live = await invoke("direct_live_command", { command });
    state.live = live;
    if ("activeSetlistId" in live) state.activeSetlistId = live.activeSetlistId;
    recomputeArrangement();
    renderLive();
    return live;
  }

  async function jumpTo(song, sectionId) {
    if (!song) return;
    try {
      const live = await invoke("jump_live", {
        songId: song.songId || null,
        instanceId: song.instanceId || null,
        sectionId: sectionId || null
      });
      state.live = live;
      renderLive();
      if (sectionId && live && live.queuedJump) {
        const section = (song.sections || []).find((item) => item.id === sectionId);
        showNotice("Queued " + (section ? section.name : "section") + " for the next bar.");
      }
    } catch (error) {
      showError(error);
    }
  }

  async function jumpAdjacentSong(direction) {
    const ctx = state.live && state.live.liveContext;
    if (!ctx) {
      const first = state.arrangement && state.arrangement.songs && state.arrangement.songs[0];
      if (direction > 0 && first) return jumpTo(first, null);
      return;
    }
    const ref = direction < 0 ? ctx.previousSong : ctx.nextSong;
    const song = ref && state.arrangement && state.arrangement.songs.find((item) => item.instanceId === ref.instanceId);
    if (song) await jumpTo(song, null);
  }

  async function jumpAdjacentSection(direction) {
    const ctx = state.live && state.live.liveContext;
    const placement = currentPlacement();
    if (!placement) return;
    const sections = placement.sections || [];
    const currentIndex = ctx && ctx.sectionId
      ? sections.findIndex((section) => section.id === ctx.sectionId)
      : -1;
    const target = sections[currentIndex + direction];
    if (target) await jumpTo(placement, target.id);
  }

  async function syncSetlistById(id) {
    if (!id) return;
    showError("");
    try {
      const data = await invoke("sync_live_setlist", { id });
      state.activeSetlistId = id;
      state.arrangement = data.arrangement || null;
      state.live = data.state || state.live;
      renderSetlists();
      renderLive();
      go("live");
      showNotice(data.syncError
        ? "Setlist loaded locally. Ableton sync is pending."
        : "Setlist synced to Ableton.");
    } catch (error) {
      showError(error);
    }
  }

  function clearPlainPreview() {
    state.pendingPlainText = null;
    $("plainPreviewPanel").hidden = true;
    $("plainPreviewSummary").textContent = "—";
    $("plainPreviewMeta").textContent = "";
  }

  async function previewPlain(text) {
    const value = String(text || "").trim();
    if (!value) return;
    $("plainPreview").disabled = true;
    showError("");
    try {
      const preview = await invoke("preview_plain_command", { text: value });
      state.pendingPlainText = value;
      $("plainPreviewSummary").textContent = preview.summary || "Ready to apply";
      $("plainPreviewMeta").textContent = [
        preview.requiresAbleton ? "ABLETON" : "LOCAL",
        preview.changesLibrary ? "CHANGES LIBRARY" : "LIVE CONTROL"
      ].join(" · ");
      $("plainPreviewPanel").hidden = false;
    } catch (error) {
      clearPlainPreview();
      showError(error);
    } finally {
      $("plainPreview").disabled = false;
    }
  }

  async function runPlain(text) {
    const value = String(text || "").trim();
    if (!value) return;
    $("plainRun").disabled = true;
    showError("");
    try {
      const data = await invoke("run_plain_command", { text: value });
      if (data.library) {
        state.songs = data.library.songs || [];
        state.setlists = data.library.setlists || [];
        renderSongs();
        renderSetlists();
      }
      if ("activeSetlistId" in data) state.activeSetlistId = data.activeSetlistId;
      if ("arrangement" in data) state.arrangement = data.arrangement;
      if (data.state) state.live = data.state;
      renderLive();
      $("plainCommand").value = "";
      clearPlainPreview();
      showNotice(data.result && data.result.summary ? data.result.summary : "Command completed.");
    } catch (error) {
      showError(error);
    } finally {
      $("plainRun").disabled = false;
    }
  }

  function renderRuntime() {
    const runtime = state.runtime;
    if (!runtime) return;

    $("databasePath").textContent = runtime.databasePath || "Unavailable";
    $("libraryRoot").textContent = runtime.libraryRoot || "Unavailable";
    if (runtime.startupWarning) showError(runtime.startupWarning);
    $("serverDot").className = "dot " + (runtime.serverRunning ? "ready" : "waiting");
    $("serverStatus").textContent = runtime.serverRunning
      ? "Remote ready · " + (runtime.port || "LAN")
      : "Starting remote";

    const links = runtime.localUrls || [];
    const host = $("remoteLinks");
    host.innerHTML = "";
    links.forEach((url) => {
      const baseUrl = url.replace(/\?token=.*/, "");
      const item = document.createElement("div");
      item.className = "remote-link";
      item.innerHTML = '<code>' + escapeHtml(baseUrl) + '</code><button>Copy Address</button>';
      item.querySelector("button").addEventListener("click", async () => {
        await navigator.clipboard.writeText(baseUrl);
        item.querySelector("button").textContent = "Copied";
        setTimeout(() => item.querySelector("button").textContent = "Copy Address", 1200);
      });
      host.appendChild(item);
    });
    if (!links.length) host.innerHTML = '<div class="empty">Connect this Mac to the same network as the iPad.</div>';
  }

  async function loadPairingCode() {
    const data = await invoke("get_pairing_code");
    $("desktopPairingCode").textContent = data.code || "------";
  }

  async function loadLibrary() {
    const payload = await invoke("get_library");
    state.songs = payload.songs || [];
    state.setlists = payload.setlists || [];
    renderSongs();
    renderSetlists();
    renderDraft();
    recomputeArrangement();
    renderSongPackageStatus();
  }

  async function loadPackageStatuses() {
    const statuses = await invoke("get_song_package_statuses").catch(() => []);
    state.packageStatuses = Object.fromEntries((statuses || []).map((status) => [status.songId, status]));
    renderSongs();
    renderSongPackageStatus();
  }

  async function loadRuntime() {
    state.runtime = await invoke("get_runtime_info");
    renderRuntime();
  }

  async function loadLive() {
    try {
      const live = await invoke("get_live_state");
      state.live = live || {};
      if ("activeSetlistId" in state.live) state.activeSetlistId = state.live.activeSetlistId;
      recomputeArrangement();
      renderSetlists();
      renderLive();
    } catch (_) {
      state.live = { bridgeConnected: false };
      renderLive();
    }
  }

  $("newSong").addEventListener("click", () => {
    resetSongEditor();
    $("songTitle").focus();
  });
  $("saveSong").addEventListener("click", () => saveSong(false));
  $("saveSongCopy").addEventListener("click", () => saveSong(true));
  $("deleteSong").addEventListener("click", async () => {
    if (!state.editingSongId || !confirm("Delete this song?")) return;
    try {
      await invoke("delete_song", { id: state.editingSongId });
      resetSongEditor();
      await loadLibrary();
    } catch (error) {
      showError(error);
    }
  });

  $("newSetlist").addEventListener("click", resetSetlistEditor);
  $("addSong").addEventListener("click", () => {
    const songId = $("songPicker").value;
    if (!songId) return;
    state.draftItems.push({ id: uid(), songId, transition: defaultTransition(), transposeSemitones: 0 });
    renderDraft();
  });
  $("saveSetlist").addEventListener("click", saveSetlist);
  $("syncSetlist").addEventListener("click", () => syncSetlistById(state.editingSetlistId));
  $("buildService").addEventListener("click", async () => {
    $("buildService").disabled = true;
    $("buildService").textContent = "Building…";
    showError("");
    try {
      let setlist = null;
      if (state.editingSetlistId) {
        setlist = await saveSetlist();
      } else {
        setlist = await saveSetlist();
      }
      if (!setlist) return;

      const result = await invoke("build_service", {
        id: setlist.id,
        buildAbleton: true
      });
      await Promise.all([loadLibrary(), loadRuntime(), loadLive()]);
      const warnings = result.service && result.service.warnings || [];
      const serviceResult = result.service || {};
      state.lastBuildFolder = serviceResult.serviceFolder || null;
      $("buildResultPanel").hidden = !state.lastBuildFolder;
      $("buildResultPath").textContent = state.lastBuildFolder || "";
      $("buildResultSummary").textContent =
        (serviceResult.audio ? serviceResult.audio.length : 0) + " audio placements · " +
        (serviceResult.cues ? serviceResult.cues.length : 0) + " cue placements · " +
        (result.abletonBuilt ? "Ableton built" : "folder built");

      if (result.abletonBuilt) {
        showNotice("Service folder built and stems placed into Ableton.");
      } else {
        const reason = result.abletonError || "Ableton build is pending.";
        showError("Service folder built, but Ableton was not completed: " + reason);
      }
      if (warnings.length) {
        showError(warnings.join(" · "));
      }
    } catch (error) {
      showError(error);
    } finally {
      $("buildService").disabled = false;
      $("buildService").textContent = "Build Service + Ableton";
    }
  });
  $("openBuildFolder").addEventListener("click", async () => {
    if (!state.lastBuildFolder) return;
    try {
      await invoke("reveal_service_build", { path: state.lastBuildFolder });
    } catch (error) {
      showError(error);
    }
  });

  $("deleteSetlist").addEventListener("click", async () => {
    if (!state.editingSetlistId || !confirm("Delete this setlist?")) return;
    const deletingId = state.editingSetlistId;
    try {
      await invoke("delete_setlist", { id: deletingId });
      if (state.activeSetlistId === deletingId) state.activeSetlistId = null;
      resetSetlistEditor();
      await loadLibrary();
      recomputeArrangement();
      renderLive();
    } catch (error) {
      showError(error);
    }
  });

  $("desktopPlay").addEventListener("click", () => direct({
    type: state.live && state.live.isPlaying ? "stop_playback" : "start_playback",
    args: {}
  }).catch((error) => showError(error)));
  $("desktopStop").addEventListener("click", () => direct({ type: "stop_playback", args: {} }).catch((error) => showError(error)));
  $("desktopClick").addEventListener("click", () => direct({
    type: "set_metronome",
    args: { enabled: !(state.live && state.live.metronome) }
  }).catch((error) => showError(error)));
  $("desktopStopAll").addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }).catch((error) => showError(error)));
  $("desktopBuskClick").addEventListener("click", () => direct({
    type: "set_metronome",
    args: { enabled: !(state.live && state.live.metronome) }
  }).catch((error) => showError(error)));
  $("desktopBuskPlay").addEventListener("click", () => direct({ type: "start_playback", args: {} }).catch((error) => showError(error)));
  $("desktopBuskStop").addEventListener("click", () => direct({ type: "stop_playback", args: {} }).catch((error) => showError(error)));
  $("desktopBuskSync").addEventListener("click", async () => {
    try {
      await direct({ type: "refresh_session", args: {} });
    } catch (_) {
      await loadLive();
    }
  });
  $("desktopPrevScene").addEventListener("click", () => direct({ type: "prev_scene", args: {} }).catch((error) => showError(error)));
  $("desktopNextScene").addEventListener("click", () => direct({ type: "next_scene", args: {} }).catch((error) => showError(error)));
  $("desktopTapTempo").addEventListener("click", () => direct({ type: "tap_tempo", args: {} }).catch((error) => showError(error)));
  $("desktopCaptureMidi").addEventListener("click", () => direct({ type: "capture_midi", args: {} }).catch((error) => showError(error)));
  $("desktopSessionRecord").addEventListener("click", () => direct({ type: "session_record", args: { bars: 0 } }).catch((error) => showError(error)));
  $("desktopUndo").addEventListener("click", () => direct({ type: "undo", args: {} }).catch((error) => showError(error)));
  $("desktopRedo").addEventListener("click", () => direct({ type: "redo", args: {} }).catch((error) => showError(error)));
  $("desktopClearClip").addEventListener("click", () => direct({ type: "clear_selected_clip", args: {} }).catch((error) => showError(error)));
  $("desktopDuplicateClip").addEventListener("click", () => direct({ type: "duplicate_selected_clip", args: {} }).catch((error) => showError(error)));
  $("desktopDoubleClip").addEventListener("click", () => direct({ type: "double_selected_clip", args: {} }).catch((error) => showError(error)));
  $("desktopSwing").addEventListener("input", () => {
    const value = Math.max(0, Math.min(1, Number($("desktopSwing").value || 0)));
    $("desktopSwingValue").textContent = Math.round(value * 100) + "%";
    clearTimeout(swingTimer);
    swingTimer = setTimeout(() => {
      direct({ type: "set_swing", args: { value } }).catch((error) => showError(error));
    }, 100);
  });

  $("desktopPrevSong").addEventListener("click", () => jumpAdjacentSong(-1));
  $("desktopNextSong").addEventListener("click", () => jumpAdjacentSong(1));
  $("desktopPrevSection").addEventListener("click", () => jumpAdjacentSection(-1));
  $("desktopNextSectionBtn").addEventListener("click", () => jumpAdjacentSection(1));

  $("openSongFolder").addEventListener("click", async () => {
    if (!state.editingSongId) return;
    try {
      await invoke("reveal_song_package", { id: state.editingSongId });
    } catch (error) { showError(error); }
  });

  $("attachSongProject").addEventListener("click", async () => {
    if (!state.editingSongId) return;
    try {
      const status = await invoke("attach_song_project", { id: state.editingSongId });
      state.packageStatuses[state.editingSongId] = status;
      renderSongs();
      renderSongPackageStatus();
      showNotice("Ableton Project copied into this song package.");
    } catch (error) {
      if (!String(error).toLowerCase().includes("cancel")) showError(error);
    }
  });

  $("importSongStems").addEventListener("click", async () => {
    if (!state.editingSongId) return;
    try {
      const status = await invoke("import_song_stems", { id: state.editingSongId });
      state.packageStatuses[state.editingSongId] = status;
      renderSongs();
      renderSongPackageStatus();
      showNotice(status.stemCount + " original stems detected.");
    } catch (error) {
      if (!String(error).toLowerCase().includes("cancel")) showError(error);
    }
  });

  $("rescanSongPackage").addEventListener("click", async () => {
    if (!state.editingSongId) return;
    try {
      const status = await invoke("rescan_song_package", { id: state.editingSongId });
      state.packageStatuses[state.editingSongId] = status;
      renderSongs();
      renderSongPackageStatus();
      showNotice("Song package rescanned.");
    } catch (error) { showError(error); }
  });

  $("revealLibrary").addEventListener("click", async () => {
    try {
      const path = await invoke("reveal_library_root");
      $("libraryRoot").textContent = path || $("libraryRoot").textContent;
    } catch (error) {
      showError(error);
    }
  });

  $("setlistGap").addEventListener("input", () => renderDraft());

  $("runSystemCheck").addEventListener("click", async () => {
    const button = $("runSystemCheck");
    const host = $("systemCheckResults");
    button.disabled = true;
    button.textContent = "Checking…";
    host.innerHTML = "";
    try {
      const result = await invoke("run_system_check");
      const packages = result.packages || [];
      const ready = packages.filter((item) => item.sourceAls && item.stemCount > 0).length;
      const capabilities = Array.isArray(result.adapterCapabilities) ? result.adapterCapabilities : [];
      const requiredBuildCapabilities = ["arrangement-audio", "transpose", "bulk-build", "extended-busk"];
      const missingBuildCapabilities = requiredBuildCapabilities.filter((name) => !capabilities.includes(name));
      const buildReady = !!result.bridgeConnected && missingBuildCapabilities.length === 0;
      host.innerHTML =
        '<div class="check-row ' + (result.libraryWritable ? "pass" : "fail") + '"><strong>Library write access</strong><span>' + (result.libraryWritable ? "PASS" : "FAIL") + '</span></div>' +
        '<div class="check-row ' + (result.templateExists ? "pass" : "warn") + '"><strong>Church Standard.als</strong><span>' + (result.templateExists ? "FOUND" : "MISSING") + '</span></div>' +
        '<div class="check-row ' + (result.bridgeConnected ? "pass" : "fail") + '"><strong>Ableton adapter' +
          (result.adapterVersion ? " · v" + escapeHtml(result.adapterVersion) : "") +
          '</strong><span>' + (result.bridgeConnected ? "CONNECTED" : "OFFLINE") + '</span></div>' +
        '<div class="check-row ' + (buildReady ? "pass" : "fail") + '"><strong>Service build API</strong><span>' +
          (buildReady ? "READY" : (result.bridgeConnected ? "UPDATE MAX" : "OFFLINE")) + '</span></div>' +
        (missingBuildCapabilities.length ? '<div class="package-check"><strong>Missing adapter capabilities</strong><small>' +
          escapeHtml(missingBuildCapabilities.join(", ")) + '</small></div>' : '') +
        '<div class="check-row ' + (ready === packages.length && packages.length ? "pass" : "warn") + '"><strong>Song packages</strong><span>' + ready + " / " + packages.length + ' READY</span></div>' +
        packages.map((item) =>
          '<div class="package-check"><strong>' + escapeHtml((state.songs.find((song) => song.id === item.songId) || {}).title || item.songId) + '</strong><small>' +
          escapeHtml((item.sourceAls || "No ALS") + " · " + item.stemCount + " stems · " + item.cueCount + " cues") +
          '</small></div>'
        ).join("");
    } catch (error) {
      host.innerHTML = '<div class="check-row fail"><strong>System check failed</strong><span>' + escapeHtml(error) + '</span></div>';
    } finally {
      button.disabled = false;
      button.textContent = "Run Full Check";
    }
  });

  $("newPairingCode").addEventListener("click", async () => {
    try {
      const data = await invoke("rotate_pairing_code");
      $("desktopPairingCode").textContent = data.code || "------";
      showNotice("New iPad pairing code generated.");
    } catch (error) {
      showError(error);
    }
  });

  $("plainPreview").addEventListener("click", () => previewPlain($("plainCommand").value));
  $("plainRun").addEventListener("click", () => runPlain($("plainCommand").value));
  $("plainApply").addEventListener("click", () => {
    if (state.pendingPlainText) runPlain(state.pendingPlainText);
  });
  $("plainCancel").addEventListener("click", clearPlainPreview);
  $("plainCommand").addEventListener("input", clearPlainPreview);
  $("plainCommand").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      previewPlain($("plainCommand").value);
    }
  });
  document.querySelectorAll("[data-plain]").forEach((button) => {
    button.addEventListener("click", () => {
      $("plainCommand").value = button.dataset.plain;
      previewPlain(button.dataset.plain);
    });
  });

  resetSongEditor();
  resetSetlistEditor();

  Promise.all([loadLibrary(), loadPackageStatuses(), loadRuntime(), loadLive(), loadPairingCode()]).catch((error) => showError(error));
  setInterval(() => loadRuntime().catch(() => {}), 2500);
  setInterval(() => loadLive().catch(() => {}), 750);
  // The iPad plain-language surface can mutate the same SQLite library.
  // Refresh the desktop lists without requiring a relaunch.
  setInterval(() => loadLibrary().catch(() => {}), 4000);
})();
