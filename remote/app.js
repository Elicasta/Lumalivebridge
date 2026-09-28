(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const incoming = params.get("token");
  if (incoming) {
    localStorage.setItem("lumaLiveToken", incoming);
    try { history.replaceState({}, "", location.pathname); } catch (_) {}
  }
  let token = incoming || localStorage.getItem("lumaLiveToken") || "";

  const $ = (id) => document.getElementById(id);
  const state = {
    live: {},
    songs: [],
    setlists: [],
    activeSetlistId: null,
    arrangement: null,
    pendingCommandText: null,
    sectionSignature: "",
    mixerSignature: "",
    buskSignature: ""
  };
  const volumeTimers = new Map();

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      showNotice.timer = setTimeout(() => $("notice").hidden = true, 2400);
    }
  }

  function setStatus(macOnline, bridgeOnline) {
    $("status").textContent = macOnline ? "MAC CONNECTED" : "MAC OFFLINE";
    $("status").className = "status " + (macOnline ? "online" : "offline");
    $("bridgeStatus").textContent = bridgeOnline ? "ABLETON CONNECTED" : "ABLETON OFFLINE";
    $("bridgeStatus").className = "status " + (bridgeOnline ? "bridge-online" : "bridge-offline");
  }

  function setPairingVisible(visible) {
    $("pairingScreen").hidden = !visible;
    $("remoteShell").classList.toggle("pairing-locked", visible);
    if (visible) setTimeout(() => $("pairingCodeInput").focus(), 80);
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
      if (!response.ok) throw new Error(data.error || "Pairing failed");
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
    if (!token) throw new Error("Pair this iPad with Luma Live first.");
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
    renderPerform();
  }

  function currentPlacement() {
    const ctx = state.live && state.live.liveContext;
    if (!ctx || !state.arrangement) return null;
    return (state.arrangement.songs || []).find(song => song.instanceId === ctx.instanceId) || null;
  }

  function placementByInstance(id) {
    if (!state.arrangement) return null;
    return (state.arrangement.songs || []).find(song => song.instanceId === id) || null;
  }

  function activeScene() {
    const scenes = Array.isArray(state.live.scenes) ? state.live.scenes : [];
    return scenes.find(scene => Number(scene.index) === Number(state.live.activeSceneIndex)) || null;
  }

  function sceneLabel(scene, fallbackIndex) {
    return scene && String(scene.name || "").trim()
      ? scene.name
      : "Scene " + ((scene && Number.isFinite(Number(scene.number))) ? scene.number : fallbackIndex + 1);
  }

  function liveColor(value, fallback = "#23272d") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    const rgb = n & 0xFFFFFF;
    return "#" + rgb.toString(16).padStart(6, "0");
  }

  function readableText(hex) {
    const clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return "#f3f4f5";
    const r = parseInt(clean.slice(0,2),16);
    const g = parseInt(clean.slice(2,4),16);
    const b = parseInt(clean.slice(4,6),16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 155 ? "#101214" : "#ffffff";
  }

  async function direct(command) {
    const data = await api("/api/direct", { method: "POST", body: { command } });
    if (data.state) {
      state.live = data.state;
      renderAll();
    }
    return data;
  }

  async function jumpTo(song, sectionId) {
    if (!song) return;
    showError("");
    try {
      const data = await api("/api/jump", {
        method: "POST",
        body: {
          instanceId: song.instanceId,
          songId: song.songId,
          sectionId: sectionId || null
        }
      });
      if (data.state) state.live = data.state;
      renderAll();
      const ctx = state.live.liveContext;
      if (sectionId && (!ctx || ctx.sectionId !== sectionId)) {
        await new Promise(resolve => setTimeout(resolve, 120));
        await refreshState();
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
    let index = ctx && ctx.sectionId ? sections.findIndex(section => section.id === ctx.sectionId) : -1;
    if (direction > 0 && index < 0) index = -1;
    const target = sections[index + direction];
    if (target) await jumpTo(placement, target.id);
  }

  function renderCurrentScene() {
    const scene = activeScene();
    const tempo = Number.isFinite(Number(state.live.tempo)) ? Number(state.live.tempo) : null;
    $("currentScene").textContent = scene ? sceneLabel(scene, scene.index) : "No active scene";
    $("sceneMeta").textContent = [
      state.live.isPlaying ? "Playing" : "Stopped",
      tempo != null ? Math.round(tempo * 10) / 10 + " BPM" : null,
      scene ? sceneLabel(scene, scene.index) : null
    ].filter(Boolean).join(" · ");
    $("tempo").textContent = tempo != null ? Math.round(tempo * 10) / 10 : "--";
    if (document.activeElement !== $("tempoInput") && tempo != null) $("tempoInput").value = String(Math.round(tempo * 10) / 10);
    $("tempoHint").textContent = scene && scene.tempoEnabled && Number(scene.tempo) > 0
      ? "Current row is assigned " + Math.round(Number(scene.tempo) * 10) / 10 + " BPM in Ableton."
      : "Current Live tempo.";
    $("playBtn").classList.toggle("active", !!state.live.isPlaying);
  }

  function renderPerformScenes() {
    const scenes = Array.isArray(state.live.scenes) ? state.live.scenes : [];
    $("sceneCount").textContent = scenes.length + " scene" + (scenes.length === 1 ? "" : "s");
    const host = $("performScenes");
    host.innerHTML = "";

    scenes.forEach((scene, index) => {
      const button = document.createElement("button");
      const active = Number(scene.index) === Number(state.live.activeSceneIndex);
      button.className = "perform-scene" + (active ? " active" : "");
      button.innerHTML =
        '<span>' + String((scene.number || index + 1)).padStart(2, "0") + '</span>' +
        '<strong>' + escapeHtml(sceneLabel(scene, index)) + '</strong>' +
        '<small>' + (scene.tempoEnabled && Number(scene.tempo) > 0 ? Math.round(Number(scene.tempo) * 10) / 10 + " BPM" : "") + '</small>';
      button.addEventListener("click", () => direct({
        type: "fire_scene",
        args: { scene: { index: Number(scene.index) } }
      }).catch(error => showError(error.message)));
      host.appendChild(button);
    });

    if (!scenes.length) host.innerHTML = '<div class="empty">No Session View scenes available.</div>';
  }

  function renderArrangement() {
    const ctx = state.live && state.live.liveContext;
    const placement = currentPlacement();
    const arrangement = state.arrangement;
    const sections = placement ? placement.sections || [] : [];

    if (!ctx || !placement) {
      $("currentSong").textContent = state.activeSetlistId ? "Waiting for playhead" : "No service loaded";
      $("songMeta").textContent = state.activeSetlistId
        ? "Move Ableton into a synced song or choose a song below."
        : "Load a setlist from the Mac app to enable song sections.";
      $("songPosition").textContent = "—";
      $("currentSection").textContent = "—";
      $("nextSection").textContent = "—";
      $("previousSectionBtn").disabled = true;
      $("nextSectionBtn").disabled = !sections.length;
      $("previousSongBtn").disabled = true;
      $("nextSongBtn").disabled = !(arrangement && arrangement.songs && arrangement.songs.length);
    } else {
      $("currentSong").textContent = ctx.songTitle;
      $("songMeta").textContent = [
        ctx.bpm ? ctx.bpm + " BPM" : null,
        ctx.key || null,
        ctx.meter ? ctx.meter.numerator + "/" + ctx.meter.denominator : null,
        Number.isFinite(ctx.currentBar) ? "Bar " + ctx.currentBar + "." + (ctx.beatInBar || 1) : null
      ].filter(Boolean).join(" · ");
      $("songPosition").textContent = arrangement ? "Song " + (ctx.songIndex + 1) + " / " + arrangement.songs.length : "—";
      $("currentSection").textContent = ctx.sectionName || "COUNT / PRE-ROLL";
      $("nextSection").textContent = ctx.nextSectionName || "END";
      $("previousSongBtn").disabled = !ctx.previousSong;
      $("nextSongBtn").disabled = !ctx.nextSong;

      const currentIndex = ctx.sectionId ? sections.findIndex(section => section.id === ctx.sectionId) : -1;
      $("previousSectionBtn").disabled = currentIndex <= 0;
      $("nextSectionBtn").disabled = sections.length === 0 || currentIndex >= sections.length - 1;
    }

    const signature = placement
      ? placement.instanceId + "|" + sections.map(section => section.id + ":" + section.name + ":" + section.localStartBar).join("|")
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

    $("sectionGrid").querySelectorAll(".section-btn").forEach(button => {
      button.classList.toggle("active", !!ctx && button.dataset.sectionId === ctx.sectionId);
    });
  }

  function renderMixer() {
    const tracks = Array.isArray(state.live.tracks) ? state.live.tracks : [];
    const signature = tracks.map(track => track.index + ":" + track.name).join("|");
    if (signature !== state.mixerSignature) {
      state.mixerSignature = signature;
      $("trackMixer").innerHTML = "";
      tracks.forEach(track => {
        const row = document.createElement("div");
        row.className = "mixer-row";
        row.dataset.trackIndex = track.index;
        row.innerHTML =
          '<span class="track-num">' + String(track.number || track.index + 1).padStart(2,"0") + '</span>' +
          '<strong class="track-name">' + escapeHtml(track.name) + '</strong>' +
          '<input class="track-volume" type="range" min="0" max="1" step="0.01" value="' + (Number.isFinite(Number(track.volume)) ? Number(track.volume) : 0.85) + '">' +
          '<span class="volume-value">--</span>' +
          '<button class="track-toggle mute">M</button>' +
          '<button class="track-toggle solo">S</button>';

        const slider = row.querySelector(".track-volume");
        slider.addEventListener("input", () => {
          row.querySelector(".volume-value").textContent = Math.round(Number(slider.value) * 100) + "%";
          clearTimeout(volumeTimers.get(track.index));
          volumeTimers.set(track.index, setTimeout(() => {
            direct({
              type: "set_track_volume",
              args: { track: { index: Number(track.index) }, value: Number(slider.value) }
            }).catch(() => {});
          }, 80));
        });
        row.querySelector(".mute").addEventListener("click", () => direct({
          type: "set_track_mute",
          args: { track: { index: Number(track.index) }, value: !track.mute }
        }).catch(error => showError(error.message)));
        row.querySelector(".solo").addEventListener("click", () => direct({
          type: "set_track_solo",
          args: { track: { index: Number(track.index) }, value: !track.solo }
        }).catch(error => showError(error.message)));
        $("trackMixer").appendChild(row);
      });
    }

    tracks.forEach(track => {
      const row = $("trackMixer").querySelector('[data-track-index="' + track.index + '"]');
      if (!row) return;
      const slider = row.querySelector(".track-volume");
      if (document.activeElement !== slider && Number.isFinite(Number(track.volume))) slider.value = Number(track.volume);
      row.querySelector(".volume-value").textContent = Math.round(Number(slider.value) * 100) + "%";
      row.querySelector(".mute").classList.toggle("active", !!track.mute);
      row.querySelector(".solo").classList.toggle("active", !!track.solo);
    });

    if (!tracks.length) $("trackMixer").innerHTML = '<div class="empty">Track controls appear when Ableton is connected.</div>';
  }

  function renderBusk() {
    const session = state.live && state.live.session;
    const tracks = session && Array.isArray(session.tracks) ? session.tracks : [];
    const scenes = session && Array.isArray(session.scenes) ? session.scenes : [];
    $("buskMeta").textContent = [
      (session && Number.isFinite(Number(session.trackCount)) ? session.trackCount : tracks.length) + " tracks",
      (session && Number.isFinite(Number(session.sceneCount)) ? session.sceneCount : scenes.length) + " scenes",
      Number.isFinite(Number(state.live.tempo)) ? Math.round(Number(state.live.tempo) * 10) / 10 + " BPM" : "-- BPM"
    ].join(" · ");

    const signature = JSON.stringify({
      tracks: tracks.map(t => [t.index,t.name,t.color,t.playingSlotIndex,t.firedSlotIndex,(t.clips||[]).map(c=>[c.sceneIndex,c.hasClip,c.name,c.color,c.isRecording])]),
      scenes: scenes.map(s => [s.index,s.name,s.tempoEnabled,s.tempo,s.isTriggered])
    });
    if (signature === state.buskSignature) return;
    state.buskSignature = signature;

    const host = $("buskGrid");
    host.innerHTML = "";
    if (!tracks.length || !scenes.length) {
      host.innerHTML = '<div class="empty">No Session View grid is available yet. Tap Sync after Ableton finishes loading.</div>';
      return;
    }

    const grid = document.createElement("div");
    grid.className = "session-matrix";
    grid.style.gridTemplateColumns = "150px 54px repeat(" + tracks.length + ", minmax(128px, 1fr))";

    const corner = document.createElement("div");
    corner.className = "matrix-label";
    corner.textContent = "SCENES";
    grid.appendChild(corner);
    const trackLabel = document.createElement("div");
    trackLabel.className = "matrix-label";
    trackLabel.textContent = "";
    grid.appendChild(trackLabel);

    tracks.forEach((track, index) => {
      const header = document.createElement("div");
      header.className = "track-header";
      header.style.borderTopColor = liveColor(track.color);
      header.innerHTML = '<span>' + (index + 1) + '</span><strong>' + escapeHtml(track.name) + '</strong>';
      grid.appendChild(header);
    });

    scenes.forEach((scene, sceneIndex) => {
      const info = document.createElement("div");
      info.className = "scene-info" + (Number(scene.index) === Number(state.live.activeSceneIndex) ? " active" : "");
      info.innerHTML =
        '<strong>' + escapeHtml(sceneLabel(scene, sceneIndex)) + '</strong>' +
        '<small>' + (sceneIndex + 1) + (scene.tempoEnabled && Number(scene.tempo) > 0 ? " · " + Math.round(Number(scene.tempo) * 10) / 10 + " BPM" : "") + '</small>';
      grid.appendChild(info);

      const launch = document.createElement("button");
      launch.className = "scene-launch";
      launch.textContent = "▶";
      launch.addEventListener("click", () => direct({
        type: "fire_scene",
        args: { scene: { index: Number(scene.index) } }
      }).catch(error => showError(error.message)));
      grid.appendChild(launch);

      tracks.forEach(track => {
        const clip = (track.clips || []).find(item => Number(item.sceneIndex) === Number(scene.index));
        const cell = document.createElement("button");
        const hasClip = !!(clip && clip.hasClip);
        const playing = Number(track.playingSlotIndex) === Number(scene.index);
        const fired = Number(track.firedSlotIndex) === Number(scene.index);
        cell.className = "clip-cell" + (hasClip ? " has-clip" : "") + (playing ? " playing" : "") + (fired ? " fired" : "");
        if (hasClip) {
          const bg = liveColor(clip.color, liveColor(track.color));
          cell.style.background = bg;
          cell.style.color = readableText(bg);
          cell.innerHTML = '<strong>' + escapeHtml(clip.name || "Clip") + '</strong>' + (playing ? '<span>▶</span>' : clip.isRecording ? '<span>●</span>' : '');
          cell.addEventListener("click", () => direct({
            type: "fire_clip",
            args: { trackIndex: Number(track.index), sceneIndex: Number(scene.index) }
          }).catch(error => showError(error.message)));
        } else {
          cell.innerHTML = '<span class="empty-dot">■</span>';
          cell.disabled = true;
        }
        grid.appendChild(cell);
      });
    });

    const stopLabel = document.createElement("div");
    stopLabel.className = "matrix-label stop-label";
    stopLabel.textContent = "TRACK STOP";
    grid.appendChild(stopLabel);
    grid.appendChild(document.createElement("div"));

    tracks.forEach(track => {
      const stop = document.createElement("button");
      stop.className = "track-stop";
      stop.textContent = "■ STOP";
      stop.addEventListener("click", () => direct({
        type: "stop_track",
        args: { trackIndex: Number(track.index) }
      }).catch(error => showError(error.message)));
      grid.appendChild(stop);
    });

    host.appendChild(grid);
  }

  function renderPerform() {
    renderCurrentScene();
    renderPerformScenes();
    renderArrangement();
    renderMixer();
  }

  function renderAll() {
    setStatus(true, !!state.live.bridgeConnected);
    renderPerform();
    renderBusk();
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
      const data = await api("/api/command/preview", { method: "POST", body: { text: value } });
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
      const data = await api("/api/command", { method: "POST", body: { text: value } });
      if (data.state) state.live = data.state;
      if (data.library) setLibrary(data.library);
      renderAll();
      showNotice(data.result && data.result.summary ? data.result.summary : "Command completed.");
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
      renderAll();
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
      setStatus(true, !!data.bridgeConnected || !!state.live.bridgeConnected);
    } catch (error) {
      setStatus(false, false);
      showError(error.message);
    }
  }

  document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === button));
      document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.dataset.page === button.dataset.tab));
    });
  });

  $("playBtn").addEventListener("click", () => direct({ type: "start_playback", args: {} }).catch(error => showError(error.message)));
  $("stopBtn").addEventListener("click", () => direct({ type: "stop_playback", args: {} }).catch(error => showError(error.message)));
  $("stopAllBtn").addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }).catch(error => showError(error.message)));
  $("refreshBtn").addEventListener("click", () => Promise.all([refreshLibrary(), refreshState()]));
  $("tempoOverrideBtn").addEventListener("click", () => {
    const bpm = Number($("tempoInput").value);
    if (!Number.isFinite(bpm) || bpm < 20 || bpm > 999) return showError("Tempo must be between 20 and 999 BPM.");
    direct({ type: "set_tempo", args: { bpm } }).catch(error => showError(error.message));
  });
  $("previousSceneBtn").addEventListener("click", () => {
    const scenes = state.live.scenes || [];
    const current = scenes.findIndex(scene => Number(scene.index) === Number(state.live.activeSceneIndex));
    const target = scenes[Math.max(0, current > 0 ? current - 1 : 0)];
    if (target) direct({ type: "fire_scene", args: { scene: { index: Number(target.index) } } }).catch(error => showError(error.message));
  });
  $("nextSceneBtn").addEventListener("click", () => {
    const scenes = state.live.scenes || [];
    const current = scenes.findIndex(scene => Number(scene.index) === Number(state.live.activeSceneIndex));
    const target = scenes[Math.min(scenes.length - 1, current >= 0 ? current + 1 : 0)];
    if (target) direct({ type: "fire_scene", args: { scene: { index: Number(target.index) } } }).catch(error => showError(error.message));
  });

  $("previousSectionBtn").addEventListener("click", () => jumpAdjacentSection(-1));
  $("nextSectionBtn").addEventListener("click", () => jumpAdjacentSection(1));
  $("previousSongBtn").addEventListener("click", () => jumpAdjacentSong(-1));
  $("nextSongBtn").addEventListener("click", () => jumpAdjacentSong(1));

  $("buskSyncBtn").addEventListener("click", () => refreshState());
  $("buskStopAllBtn").addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }).catch(error => showError(error.message)));

  $("commandPreviewBtn").addEventListener("click", () => previewPlainCommand($("commandInput").value));
  $("commandBtn").addEventListener("click", () => runPlainCommand($("commandInput").value));
  $("commandApplyBtn").addEventListener("click", () => state.pendingCommandText && runPlainCommand(state.pendingCommandText));
  $("commandCancelBtn").addEventListener("click", clearCommandPreview);
  $("commandInput").addEventListener("input", clearCommandPreview);
  $("commandInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      previewPlainCommand($("commandInput").value);
    }
  });

  $("pairingConnectBtn").addEventListener("click", pairDevice);
  $("pairingCodeInput").addEventListener("input", () => {
    const digits = $("pairingCodeInput").value.replace(/\D/g, "").slice(0, 6);
    $("pairingCodeInput").value = digits;
    pairingError("");
    if (digits.length === 6) pairDevice();
  });
  $("pairingCodeInput").addEventListener("keydown", event => {
    if (event.key === "Enter") pairDevice();
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  if (!token) {
    setStatus(false, false);
    setPairingVisible(true);
  } else {
    setPairingVisible(false);
    Promise.all([refreshLibrary(), refreshState()]).catch(() => {});
  }

  setInterval(() => { if (token) refreshState().catch(() => {}); }, 700);
  setInterval(() => { if (token) refreshLibrary().catch(() => {}); }, 5000);
})();