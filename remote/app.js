(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const incoming = params.get("token");
  if (incoming) {
    localStorage.setItem("lumaLiveToken", incoming);
    try {
      history.replaceState({}, "", location.pathname);
    } catch (_) {}
  }
  let token = incoming || localStorage.getItem("lumaLiveToken") || "";

  const $ = (id) => document.getElementById(id);
  const state = {
    live: null,
    songs: [],
    setlists: [],
    activeSetlistId: null,
    arrangement: null,
    pendingCommandText: null,
    mixerSignature: "",
    sectionSignature: "",
    sceneSignature: ""
  };
  const volumeTimers = new Map();

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(macOnline, bridgeOnline) {
    $("status").textContent = macOnline ? "MAC CONNECTED" : "MAC OFFLINE";
    $("status").className = "status " + (macOnline ? "online" : "offline");
    $("bridgeStatus").textContent = bridgeOnline ? "ABLETON CONNECTED" : "ABLETON OFFLINE";
    $("bridgeStatus").className = "status " + (bridgeOnline ? "bridge-online" : "bridge-offline");
  }

  function showError(message) {
    $("error").textContent = message || "";
    $("error").hidden = !message;
  }

  function showNotice(message) {
    $("notice").textContent = message || "";
    $("notice").hidden = !message;
    if (message) {
      clearTimeout(showNotice.timer);
      showNotice.timer = setTimeout(() => {
        $("notice").hidden = true;
      }, 2600);
    }
  }

  function setPairingVisible(visible) {
    $("pairingScreen").hidden = !visible;
    $("remoteShell").classList.toggle("pairing-locked", visible);
    if (visible) {
      setTimeout(() => $("pairingCodeInput").focus(), 80);
    }
  }

  function pairingError(message) {
    $("pairingError").textContent = message || "";
    $("pairingError").hidden = !message;
  }

  async function pairDevice() {
    const code = $("pairingCodeInput").value.replace(/\D/g, "").slice(0, 6);
    $("pairingCodeInput").value = code;
    if (code.length !== 6) {
      pairingError("Enter all six digits.");
      return;
    }

    $("pairingConnectBtn").disabled = true;
    $("pairingConnectBtn").textContent = "Connecting…";
    pairingError("");

    try {
      const response = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          deviceName: navigator.userAgent.includes("iPad") ? "iPad" : "PWA Remote"
        }),
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Pairing failed");
      }

      token = data.token || "";
      if (!token) throw new Error("The Mac did not return a device token.");
      localStorage.setItem("lumaLiveToken", token);
      $("pairingCodeInput").value = "";
      setPairingVisible(false);
      showNotice("iPad paired with Luma Live.");
      await Promise.all([refreshLibrary(), refreshState()]);
    } catch (error) {
      pairingError(error.message || String(error));
    } finally {
      $("pairingConnectBtn").disabled = false;
      $("pairingConnectBtn").textContent = "Connect";
    }
  }

  async function api(path, options = {}) {
    if (!token) {
      throw new Error("Open the remote using the full link shown in Luma Live on the Mac.");
    }
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Luma-Token": token,
        ...(options.headers || {})
      },
      body: options.body == null
        ? undefined
        : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        token = "";
        localStorage.removeItem("lumaLiveToken");
        setPairingVisible(true);
      }
      throw new Error(data.error || "Luma Live request failed");
    }
    return data;
  }

  function setLibrary(payload) {
    const source = payload && payload.library && Array.isArray(payload.library.songs)
      ? payload.library
      : payload || {};

    state.songs = Array.isArray(source.songs) ? source.songs : state.songs;
    state.setlists = Array.isArray(source.setlists) ? source.setlists : state.setlists;
    if ("activeSetlistId" in source) state.activeSetlistId = source.activeSetlistId;
    if ("arrangement" in source) state.arrangement = source.arrangement;
    renderLibrary();
    renderSetlists();
    renderLive();
  }

  function activeSetlist() {
    return state.setlists.find((item) => item.id === state.activeSetlistId) || null;
  }

  function currentPlacement() {
    const ctx = state.live && state.live.liveContext;
    if (!ctx || !state.arrangement) return null;
    return (state.arrangement.songs || []).find((song) => song.instanceId === ctx.instanceId) || null;
  }

  function placementByInstance(id) {
    if (!state.arrangement) return null;
    return (state.arrangement.songs || []).find((song) => song.instanceId === id) || null;
  }

  function renderTransport() {
    const live = state.live || {};
    const ctx = live.liveContext;

    $("playBtn").classList.toggle("active", !!live.isPlaying);
    $("playLabel").textContent = live.isPlaying ? "PLAYING" : "PLAY";
    $("clickBtn").classList.toggle("active", !!live.metronome);
    $("tempo").textContent = Number.isFinite(live.tempo) ? Math.round(live.tempo * 10) / 10 : "--";
    $("meter").textContent = live.meter
      ? live.meter.numerator + "/" + live.meter.denominator
      : "--";
    $("barReadout").textContent = ctx && Number.isFinite(ctx.currentBar)
      ? ctx.currentBar + "." + (ctx.beatInBar || 1)
      : "--";
  }

  function renderSections(placement, ctx) {
    const sections = placement ? placement.sections || [] : [];
    const signature = placement
      ? placement.instanceId + "|" + sections.map((section) => section.id + ":" + section.name + ":" + section.localStartBar).join("|")
      : "";

    if (signature !== state.sectionSignature) {
      state.sectionSignature = signature;
      $("sectionGrid").innerHTML = "";
      sections.forEach((section, index) => {
        const button = document.createElement("button");
        button.className = "section-btn";
        button.dataset.sectionId = section.id;
        button.innerHTML =
          '<span>' + String(index + 1).padStart(2, "0") + '</span>' +
          '<strong>' + escapeHtml(section.name) + '</strong>' +
          '<small>Bar ' + section.localStartBar + '</small>';
        button.addEventListener("click", () => jumpTo(placement, section.id));
        $("sectionGrid").appendChild(button);
      });
    }

    $("sectionGrid").querySelectorAll(".section-btn").forEach((button) => {
      button.classList.toggle("active", !!ctx && button.dataset.sectionId === ctx.sectionId);
    });

    if (!placement) {
      $("previousSectionBtn").disabled = true;
      $("nextSectionBtn").disabled = true;
      return;
    }

    const currentIndex = ctx && ctx.sectionId
      ? sections.findIndex((section) => section.id === ctx.sectionId)
      : -1;
    $("previousSectionBtn").disabled = currentIndex <= 0;
    $("nextSectionBtn").disabled = sections.length === 0 || currentIndex >= sections.length - 1;
  }

  function renderMixer() {
    const tracks = state.live && Array.isArray(state.live.tracks) ? state.live.tracks : [];
    const signature = tracks.map((track) => track.index + ":" + track.name).join("|");

    if (signature !== state.mixerSignature) {
      state.mixerSignature = signature;
      $("trackMixer").innerHTML = "";

      tracks.forEach((track) => {
        const row = document.createElement("div");
        row.className = "mixer-row";
        row.dataset.trackIndex = track.index;
        row.innerHTML =
          '<span class="track-num">' + String(track.number).padStart(2, "0") + '</span>' +
          '<strong class="track-name">' + escapeHtml(track.name) + '</strong>' +
          '<input class="track-volume" type="range" min="0" max="1" step="0.01" value="' +
          (Number.isFinite(track.volume) ? track.volume : 0.85) + '">' +
          '<span class="volume-value">--</span>' +
          '<button class="track-toggle mute">M</button>' +
          '<button class="track-toggle solo">S</button>';

        const slider = row.querySelector(".track-volume");
        slider.addEventListener("pointerdown", () => slider.dataset.dragging = "1");
        const release = () => delete slider.dataset.dragging;
        slider.addEventListener("pointerup", release);
        slider.addEventListener("pointercancel", release);
        slider.addEventListener("input", () => {
          row.querySelector(".volume-value").textContent = Math.round(Number(slider.value) * 100) + "%";
          clearTimeout(volumeTimers.get(track.index));
          volumeTimers.set(track.index, setTimeout(() => {
            direct({
              type: "set_track_volume",
              args: { track: { index: track.index }, value: Number(slider.value) }
            }).catch(() => {});
          }, 80));
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

        $("trackMixer").appendChild(row);
      });
    }

    tracks.forEach((track) => {
      const row = $("trackMixer").querySelector('[data-track-index="' + track.index + '"]');
      if (!row) return;
      const slider = row.querySelector(".track-volume");
      if (!slider.dataset.dragging && Number.isFinite(track.volume)) slider.value = track.volume;
      row.querySelector(".volume-value").textContent = Number.isFinite(track.volume)
        ? Math.round(track.volume * 100) + "%"
        : "--";
      row.querySelector(".mute").classList.toggle("active", !!track.mute);
      row.querySelector(".solo").classList.toggle("active", !!track.solo);
    });

    if (!tracks.length) {
      $("trackMixer").innerHTML = '<div class="empty">Open Ableton and load Luma Live.amxd to see tracks.</div>';
    }
  }

  function renderScenes() {
    const scenes = state.live && Array.isArray(state.live.scenes) ? state.live.scenes : [];
    const signature = scenes.map((scene) => scene.index + ":" + scene.name).join("|");

    if (signature !== state.sceneSignature) {
      state.sceneSignature = signature;
      $("sceneGrid").innerHTML = "";
      scenes.forEach((scene) => {
        const button = document.createElement("button");
        button.className = "scene-btn";
        button.dataset.sceneIndex = scene.index;
        button.innerHTML =
          '<span>' + String(scene.number).padStart(2, "0") + '</span>' +
          '<strong>' + escapeHtml(scene.name) + '</strong>';
        button.addEventListener("click", () => direct({
          type: "fire_scene",
          args: { scene: { index: scene.index } }
        }).catch(() => {}));
        $("sceneGrid").appendChild(button);
      });
    }

    $("sceneGrid").querySelectorAll(".scene-btn").forEach((button) => {
      button.classList.toggle(
        "active",
        Number(button.dataset.sceneIndex) === Number(state.live && state.live.activeSceneIndex)
      );
    });

    if (!scenes.length) {
      $("sceneGrid").innerHTML = '<div class="empty">No Session View scenes found.</div>';
    }
  }

  function renderServiceOrder() {
    const songs = state.arrangement && Array.isArray(state.arrangement.songs)
      ? state.arrangement.songs
      : [];
    const ctx = state.live && state.live.liveContext;

    $("serviceCount").textContent = songs.length;
    $("activeSongCount").textContent = songs.length;
    $("activeSetlistTitle").textContent = activeSetlist()
      ? activeSetlist().title
      : "No setlist loaded";

    for (const id of ["serviceOrder", "activeArrangement"]) {
      const host = $(id);
      host.innerHTML = "";
      songs.forEach((song, index) => {
        const button = document.createElement("button");
        button.className = "service-row" + (ctx && ctx.instanceId === song.instanceId ? " active" : "");
        button.innerHTML =
          '<span class="row-num">' + String(index + 1).padStart(2, "0") + '</span>' +
          '<span><strong>' + escapeHtml(song.title) + '</strong><small>' +
          escapeHtml(song.bpm + " BPM" + (song.key ? " · " + song.key : "")) +
          '</small></span><b>' + (ctx && ctx.instanceId === song.instanceId ? "NOW" : "GO") + '</b>';
        button.addEventListener("click", () => jumpTo(song, null));
        host.appendChild(button);
      });
      if (!songs.length) host.innerHTML = '<div class="empty">Load a setlist to build the Arrangement map.</div>';
    }
  }

  function renderLive() {
    const live = state.live || {};
    const ctx = live.liveContext;
    const placement = currentPlacement();

    setStatus(true, !!live.bridgeConnected);
    renderTransport();

    if (!ctx) {
      $("currentSong").textContent = state.activeSetlistId ? "Waiting for playhead" : "No service loaded";
      $("currentMeta").textContent = live.bridgeConnected
        ? "Load a setlist or move the Ableton playhead into a synced song."
        : "Open Ableton and load Luma Live.amxd.";
      $("currentSection").textContent = "—";
      $("nextSection").textContent = "—";
      $("previousSongName").textContent = "—";
      $("nextSongName").textContent = state.arrangement && state.arrangement.songs && state.arrangement.songs[0]
        ? state.arrangement.songs[0].title
        : "—";
      $("previousSongBtn").disabled = true;
      $("nextSongBtn").disabled = !(state.arrangement && state.arrangement.songs && state.arrangement.songs.length);
      $("songProgress").style.width = "0%";
    } else {
      $("currentSong").textContent = ctx.songTitle;
      $("currentMeta").textContent = [
        ctx.bpm ? ctx.bpm + " BPM" : null,
        ctx.key || null,
        ctx.meter ? ctx.meter.numerator + "/" + ctx.meter.denominator : null,
        state.arrangement ? "Song " + (ctx.songIndex + 1) + " of " + state.arrangement.songs.length : null
      ].filter(Boolean).join(" · ");
      $("currentSection").textContent = ctx.sectionName || "COUNT / PRE-ROLL";
      $("nextSection").textContent = ctx.nextSectionName || "END";
      $("previousSongName").textContent = ctx.previousSong ? ctx.previousSong.title : "—";
      $("nextSongName").textContent = ctx.nextSong ? ctx.nextSong.title : "—";
      $("previousSongBtn").disabled = !ctx.previousSong;
      $("nextSongBtn").disabled = !ctx.nextSong;
      $("songProgress").style.width = Math.round((ctx.progress || 0) * 1000) / 10 + "%";
    }

    renderSections(placement, ctx);
    renderMixer();
    renderScenes();
    renderServiceOrder();
  }

  function renderSetlists() {
    $("setlistCount").textContent = state.setlists.length;
    $("setlistList").innerHTML = "";

    state.setlists.forEach((setlist) => {
      const row = document.createElement("div");
      const active = setlist.id === state.activeSetlistId;
      row.className = "saved-row" + (active ? " active" : "");
      row.innerHTML =
        '<span><strong>' + escapeHtml(setlist.title) + '</strong><small>' +
        setlist.items.length + ' song' + (setlist.items.length === 1 ? "" : "s") +
        (active ? " · ACTIVE" : "") + '</small></span>' +
        '<button class="' + (active ? "quiet" : "primary") + '">' + (active ? "Resync" : "Load") + '</button>';
      row.querySelector("button").addEventListener("click", () => syncSetlist(setlist.id));
      $("setlistList").appendChild(row);
    });

    if (!state.setlists.length) {
      $("setlistList").innerHTML = '<div class="empty">Build your first setlist in the Mac app.</div>';
    }
  }

  function renderLibrary() {
    $("songCount").textContent = state.songs.length;
    $("songList").innerHTML = "";

    state.songs.forEach((song) => {
      const card = document.createElement("article");
      card.className = "song-library-card";
      card.innerHTML =
        '<div><span class="eyebrow">SONG</span><h3>' + escapeHtml(song.title) + '</h3><p>' +
        escapeHtml([song.artist, song.bpm + " BPM", song.key, song.meter.numerator + "/" + song.meter.denominator].filter(Boolean).join(" · ")) +
        '</p></div>' +
        '<div class="section-chips">' +
        (song.sections || []).map((section) => '<span>' + escapeHtml(section.name) + ' · ' + section.startBar + '</span>').join("") +
        '</div>';
      $("songList").appendChild(card);
    });

    if (!state.songs.length) {
      $("songList").innerHTML = '<div class="empty">No songs saved in the local library yet.</div>';
    }
  }

  async function direct(command) {
    const data = await api("/api/direct", {
      method: "POST",
      body: { command }
    });
    if (data.state) {
      state.live = data.state;
      renderLive();
    }
    return data;
  }

  async function jumpTo(song, sectionId) {
    if (!song) return;
    try {
      showError("");
      const data = await api("/api/jump", {
        method: "POST",
        body: {
          instanceId: song.instanceId,
          songId: song.songId,
          sectionId: sectionId || null
        }
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
      const first = state.arrangement && state.arrangement.songs && state.arrangement.songs[0];
      if (direction > 0 && first) await jumpTo(first, null);
      return;
    }
    const ref = direction < 0 ? ctx.previousSong : ctx.nextSong;
    const placement = ref && placementByInstance(ref.instanceId);
    if (placement) await jumpTo(placement, null);
  }

  async function jumpAdjacentSection(direction) {
    const ctx = state.live && state.live.liveContext;
    const placement = currentPlacement();
    if (!placement) return;
    const sections = placement.sections || [];
    let index = ctx && ctx.sectionId
      ? sections.findIndex((section) => section.id === ctx.sectionId)
      : -1;
    if (direction > 0 && index < 0) index = -1;
    const target = sections[index + direction];
    if (target) await jumpTo(placement, target.id);
  }

  async function syncSetlist(id) {
    try {
      showError("");
      const data = await api("/api/setlists/" + encodeURIComponent(id) + "/sync", {
        method: "POST",
        body: {}
      });
      if (data.state) state.live = data.state;
      if (data.library) setLibrary(data.library);
      else await refreshLibrary();
      document.querySelector('[data-tab="song"]').click();
      showNotice(data.syncError
        ? "Setlist loaded locally. Ableton sync is pending."
        : "Setlist synced to Ableton.");
    } catch (error) {
      showError(error.message);
    }
  }

  function clearCommandPreview() {
    state.pendingCommandText = null;
    $("commandPreviewPanel").hidden = true;
    $("commandPreviewSummary").textContent = "—";
    $("commandPreviewMeta").textContent = "";
  }

  async function previewPlainCommand(text) {
    const value = String(text || "").trim();
    if (!value) return;
    $("commandPreviewBtn").disabled = true;
    try {
      showError("");
      const data = await api("/api/command/preview", {
        method: "POST",
        body: { text: value }
      });
      const preview = data.preview || {};
      state.pendingCommandText = value;
      $("commandPreviewSummary").textContent = preview.summary || "Ready to apply";
      $("commandPreviewMeta").textContent = [
        preview.requiresAbleton ? "ABLETON" : "LOCAL",
        preview.changesLibrary ? "CHANGES LIBRARY" : "LIVE CONTROL"
      ].join(" · ");
      $("commandPreviewPanel").hidden = false;
    } catch (error) {
      clearCommandPreview();
      showError(error.message);
    } finally {
      $("commandPreviewBtn").disabled = false;
    }
  }

  async function runPlainCommand(text) {
    const value = String(text || "").trim();
    if (!value) return;
    $("commandBtn").disabled = true;
    try {
      showError("");
      const data = await api("/api/command", {
        method: "POST",
        body: { text: value }
      });
      if (data.state) state.live = data.state;
      if (data.library) setLibrary(data.library);
      else renderLive();
      const summary = data.result && data.result.summary
        ? data.result.summary
        : "Command completed.";
      showNotice(summary);
      $("commandInput").value = "";
      clearCommandPreview();
    } catch (error) {
      showError(error.message);
    } finally {
      $("commandBtn").disabled = false;
    }
  }

  async function refreshState() {
    try {
      const data = await api("/api/state");
      state.live = data.state || {};
      setStatus(true, !!state.live.bridgeConnected);
      renderLive();
      showError("");
    } catch (error) {
      setStatus(false, false);
      showError(error.message);
    }
  }

  async function refreshLibrary() {
    try {
      const data = await api("/api/library");
      setLibrary(data);
      setStatus(true, !!data.bridgeConnected || !!(state.live && state.live.bridgeConnected));
    } catch (error) {
      setStatus(false, false);
      showError(error.message);
    }
  }

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".page").forEach((page) => {
        page.classList.toggle("active", page.dataset.page === button.dataset.tab);
      });
    });
  });

  $("playBtn").addEventListener("click", () => {
    direct({
      type: state.live && state.live.isPlaying ? "stop_playback" : "start_playback",
      args: {}
    }).catch((error) => showError(error.message));
  });
  $("stopBtn").addEventListener("click", () => direct({ type: "stop_playback", args: {} }).catch((error) => showError(error.message)));
  $("clickBtn").addEventListener("click", () => direct({
    type: "set_metronome",
    args: { enabled: !(state.live && state.live.metronome) }
  }).catch((error) => showError(error.message)));

  $("previousSongBtn").addEventListener("click", () => jumpAdjacentSong(-1));
  $("nextSongBtn").addEventListener("click", () => jumpAdjacentSong(1));
  $("previousSectionBtn").addEventListener("click", () => jumpAdjacentSection(-1));
  $("nextSectionBtn").addEventListener("click", () => jumpAdjacentSection(1));
  $("stopAllBtn").addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }).catch((error) => showError(error.message)));

  $("commandPreviewBtn").addEventListener("click", () => previewPlainCommand($("commandInput").value));
  $("commandBtn").addEventListener("click", () => runPlainCommand($("commandInput").value));
  $("commandApplyBtn").addEventListener("click", () => {
    if (state.pendingCommandText) runPlainCommand(state.pendingCommandText);
  });
  $("commandCancelBtn").addEventListener("click", clearCommandPreview);
  $("commandInput").addEventListener("input", clearCommandPreview);
  $("commandInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      previewPlainCommand($("commandInput").value);
    }
  });
  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      $("commandInput").value = button.dataset.command;
      previewPlainCommand(button.dataset.command);
    });
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  $("pairingConnectBtn").addEventListener("click", pairDevice);
  $("pairingCodeInput").addEventListener("input", () => {
    const digits = $("pairingCodeInput").value.replace(/\D/g, "").slice(0, 6);
    if ($("pairingCodeInput").value !== digits) $("pairingCodeInput").value = digits;
    pairingError("");
    if (digits.length === 6) pairDevice();
  });
  $("pairingCodeInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") pairDevice();
  });

  if (!token) {
    setStatus(false, false);
    setPairingVisible(true);
  } else {
    setPairingVisible(false);
    Promise.all([refreshLibrary(), refreshState()]).catch(() => {});
  }

  setInterval(() => {
    if (token) refreshState().catch(() => {});
  }, 650);
  setInterval(() => {
    if (token) refreshLibrary().catch(() => {});
  }, 4000);
})();
