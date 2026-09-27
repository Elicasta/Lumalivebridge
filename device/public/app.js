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

  let currentPlan = null;
  let currentState = null;

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
      set_track_solo: () => (a.value ? "Solo " : "Unsolo ") + ref(a.track)
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
      row.innerHTML = '<span class="num">' + String(index + 1).padStart(2, "0") + '</span><span>' +
        escapeHtml(labelCommand(command)) + "</span>";
      planList.appendChild(row);
    });
    planNotes.innerHTML = (plan.notes || []).map((note) => "<div>• " + escapeHtml(note) + "</div>").join("");
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

    const scene = state.activeSceneIndex == null
      ? null
      : (state.scenes || []).find((item) => item.index === state.activeSceneIndex);
    activeScene.textContent = scene ? scene.name : "--";

    sceneGrid.innerHTML = "";
    (state.scenes || []).forEach((item) => {
      const button = document.createElement("button");
      button.className = "scene-button" + (item.index === state.activeSceneIndex ? " active" : "");
      button.innerHTML = '<span class="scene-number">' + item.number + '</span><span>' + escapeHtml(item.name) + "</span>";
      button.addEventListener("click", () => direct({
        type: "fire_scene",
        args: { scene: { index: item.index } }
      }));
      sceneGrid.appendChild(button);
    });
  }

  async function refresh() {
    try {
      const data = await api("/api/state");
      renderState(data.state);
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
    } catch (error) {
      showError(error.message);
    }
  }

  previewBtn.addEventListener("click", async () => {
    showError("");
    previewBtn.disabled = true;
    try {
      const data = await api("/api/plan", {
        method: "POST",
        body: JSON.stringify({ text: commandInput.value })
      });
      renderPlan(data.plan);
    } catch (error) {
      showError(error.message);
    } finally {
      previewBtn.disabled = false;
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
    events.onerror = () => setStatus(false);
  } else {
    showError("Missing bridge token. Open the exact URL printed by Luma Live Bridge.");
  }

  refresh();
})();
