(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const incoming = params.get("token");
  if (incoming) localStorage.setItem("lumaBridgeToken", incoming);
  const token = incoming || localStorage.getItem("lumaBridgeToken") || "";

  const el = (id) => document.getElementById(id);
  const status = el("status");
  const tempo = el("tempo");
  const meter = el("meter");
  const activeScene = el("activeScene");
  const commandInput = el("commandInput");
  const previewBtn = el("previewBtn");
  const clearBtn = el("clearBtn");
  const stopAll = el("stopAll");
  const errorBox = el("error");
  const planCard = el("planCard");
  const planTitle = el("planTitle");
  const confidence = el("confidence");
  const planList = el("planList");
  const planNotes = el("planNotes");
  const cancelBtn = el("cancelBtn");
  const applyBtn = el("applyBtn");
  const sceneGrid = el("sceneGrid");
  const refreshBtn = el("refreshBtn");
  const libraryList = el("libraryList");
  const libraryEmpty = el("libraryEmpty");

  let currentPlan = null;
  let currentState = null;
  let currentLibrary = null;

  function showError(message) {
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  }

  function setStatus(online) {
    status.textContent = online ? "CONNECTED" : "OFFLINE";
    status.className = "status " + (online ? "online" : "offline");
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

  function refLabel(value) {
    if (!value) return "unknown";
    if (value.name) return value.name;
    if (value.id) return value.id;
    if (value.index != null) return "#" + (Number(value.index) + 1);
    return "unknown";
  }

  function labelCommand(command) {
    const a = command.args || {};
    const labels = {
      set_tempo: () => "Set tempo to " + a.bpm + " BPM",
      set_meter: () => "Set meter to " + a.numerator + "/" + a.denominator,
      create_track: () => "Create " + a.kind + " track · " + a.name,
      rename_track: () => "Rename track " + refLabel(a.track) + " → " + a.name,
      create_scene: () => "Create scene · " + a.name,
      rename_scene: () => "Rename scene " + refLabel(a.scene) + " → " + a.name,
      fire_scene: () => "Launch scene · " + refLabel(a.scene),
      stop_all_clips: () => "Stop all clips",
      create_midi_clip: () => "Create MIDI clip on " + refLabel(a.track) + " / " + refLabel(a.scene),
      duplicate_clip: () => "Duplicate clip on " + refLabel(a.track),
      set_clip_loop: () => (a.enabled ? "Enable" : "Disable") + " clip loop",
      set_track_volume: () => "Set " + refLabel(a.track) + " volume to " + Math.round(a.value * 100) + "%",
      set_track_mute: () => (a.value ? "Mute " : "Unmute ") + refLabel(a.track),
      set_track_solo: () => (a.value ? "Solo " : "Unsolo ") + refLabel(a.track),
      create_song: () => "Save reusable song · " + a.title,
      load_song: () => "Load saved song · " + refLabel(a.song)
    };
    return labels[command.type] ? labels[command.type]() : command.type;
  }

  function renderPlan(plan) {
    currentPlan = plan;
    planTitle.textContent = plan.title;
    confidence.textContent = Math.round((plan.confidence || 0) * 100) + "%";
    planList.innerHTML = "";
    plan.commands.forEach((command, index) => {
      const row = document.createElement("div");
      row.className = "plan-row";
      row.innerHTML =
        '<span class="num">' +
        String(index + 1).padStart(2, "0") +
        '</span><span>' +
        escapeHtml(labelCommand(command)) +
        "</span>";
      planList.appendChild(row);
    });
    planNotes.innerHTML = (plan.notes || [])
      .map((note) => "<div>• " + escapeHtml(note) + "</div>")
      .join("");
    planCard.hidden = false;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderState(state) {
    if (!state) return;
    currentState = state;
    tempo.textContent = Number.isFinite(state.tempo) ? Math.round(state.tempo * 10) / 10 : "--";
    meter.textContent = state.meter ? state.meter.numerator + "/" + state.meter.denominator : "--";

    const scene =
      state.activeSceneIndex == null
        ? null
        : (state.scenes || []).find((item) => item.index === state.activeSceneIndex);
    activeScene.textContent = scene ? scene.name : "--";

    sceneGrid.innerHTML = "";
    (state.scenes || []).forEach((item) => {
      const button = document.createElement("button");
      button.className = "scene-button" + (item.index === state.activeSceneIndex ? " active" : "");
      button.innerHTML =
        '<span class="scene-number">' +
        item.number +
        '</span><span>' +
        escapeHtml(item.name) +
        "</span>";
      button.addEventListener("click", () =>
        direct({
          type: "fire_scene",
          args: { scene: { index: item.index } }
        })
      );
      sceneGrid.appendChild(button);
    });
  }

  function songMeta(song) {
    const values = [];
    if (song.bpm != null) values.push(song.bpm + " BPM");
    if (song.meter) values.push(song.meter.numerator + "/" + song.meter.denominator);
    const count = (song.sections || []).reduce(
      (total, section) => total + Math.max(1, Number(section.repeat) || 1),
      0
    );
    values.push(count + (count === 1 ? " scene" : " scenes"));
    return values.join(" · ");
  }

  function renderLibrary(library) {
    currentLibrary = library || { songs: [] };
    const songs = currentLibrary.songs || [];
    libraryList.innerHTML = "";
    libraryEmpty.hidden = songs.length > 0;

    songs.forEach((song) => {
      const row = document.createElement("div");
      row.className = "library-row";

      const info = document.createElement("div");
      info.className = "library-info";

      const title = document.createElement("strong");
      title.textContent = song.title;

      const meta = document.createElement("span");
      meta.textContent = songMeta(song);

      info.append(title, meta);

      const load = document.createElement("button");
      load.type = "button";
      load.className = "ghost small";
      load.textContent = "Load";
      load.addEventListener("click", async () => {
        commandInput.value = "Load song " + song.title;
        await previewCommand(commandInput.value);
        commandInput.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      row.append(info, load);
      libraryList.appendChild(row);
    });
  }

  async function previewCommand(text) {
    showError("");
    previewBtn.disabled = true;
    try {
      const data = await api("/api/plan", {
        method: "POST",
        body: JSON.stringify({ text })
      });
      renderPlan(data.plan);
      return data.plan;
    } catch (error) {
      showError(error.message);
      return null;
    } finally {
      previewBtn.disabled = false;
    }
  }

  async function refresh() {
    try {
      const [stateData, libraryData] = await Promise.all([
        api("/api/state"),
        api("/api/library")
      ]);
      renderState(stateData.state);
      renderLibrary(libraryData.library);
      setStatus(true);
    } catch (error) {
      setStatus(false);
      showError(error.message);
    }
  }

  async function direct(command) {
    showError("");
    try {
      const data = await api("/api/direct", {
        method: "POST",
        body: JSON.stringify({ command })
      });
      if (data.state) renderState(data.state);
      if (data.library) renderLibrary(data.library);
    } catch (error) {
      showError(error.message);
    }
  }

  previewBtn.addEventListener("click", () => previewCommand(commandInput.value));

  commandInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      previewCommand(commandInput.value);
    }
  });

  applyBtn.addEventListener("click", async () => {
    if (!currentPlan) return;
    showError("");
    applyBtn.disabled = true;
    applyBtn.textContent = "Applying…";
    try {
      const data = await api("/api/apply", {
        method: "POST",
        body: JSON.stringify({ plan: currentPlan })
      });
      if (data.state) renderState(data.state);
      if (data.library) renderLibrary(data.library);
      planCard.hidden = true;
      currentPlan = null;
    } catch (error) {
      showError(error.message);
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = "Apply to Ableton";
    }
  });

  cancelBtn.addEventListener("click", () => {
    currentPlan = null;
    planCard.hidden = true;
  });

  clearBtn.addEventListener("click", () => {
    commandInput.value = "";
    showError("");
    commandInput.focus();
  });

  stopAll.addEventListener("click", () => direct({ type: "stop_all_clips", args: {} }));
  refreshBtn.addEventListener("click", refresh);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  if (token) {
    const events = new EventSource("/events?token=" + encodeURIComponent(token));
    events.addEventListener("connected", () => setStatus(true));
    events.addEventListener("state", (event) => {
      try {
        renderState(JSON.parse(event.data));
        setStatus(true);
      } catch (_) {}
    });
    events.addEventListener("library", (event) => {
      try {
        renderLibrary(JSON.parse(event.data));
      } catch (_) {}
    });
    events.onerror = () => setStatus(false);
  } else {
    showError("Missing bridge token. Open the exact URL printed by Luma Live Bridge.");
  }

  refresh();
})();
