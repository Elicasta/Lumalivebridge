(() => {
  "use strict";

  const invoke = window.__TAURI__.core.invoke;
  const $ = (id) => document.getElementById(id);

  const state = {
    songs: [],
    setlists: [],
    runtime: null,
    editingSongId: null,
    editingSetlistId: null,
    draftItems: []
  };

  const titles = {
    live: ["SERVICE", "Live"],
    songs: ["LIBRARY", "Songs"],
    setlists: ["SERVICES", "Setlists"],
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
    return crypto.randomUUID ? crypto.randomUUID() : "item-" + Date.now() + "-" + Math.random();
  }

  function go(page) {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
    document.querySelectorAll(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
    $("pageEyebrow").textContent = titles[page][0];
    $("pageTitle").textContent = titles[page][1];
  }

  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => go(item.dataset.page)));
  document.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", () => go(item.dataset.go)));

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
  }

  function renderSongs() {
    $("songCount").textContent = state.songs.length;
    $("liveSongCount").textContent = state.songs.length;

    const list = $("songList");
    list.innerHTML = "";
    state.songs.forEach((song) => {
      const button = document.createElement("button");
      button.className = "data-row";
      button.innerHTML =
        '<span><b>' + escapeHtml(song.title) + '</b><small>' +
        escapeHtml([song.artist, song.bpm + " BPM", song.key].filter(Boolean).join(" · ")) +
        '</small></span><span class="arrow">›</span>';
      button.addEventListener("click", () => editSong(song));
      list.appendChild(button);
    });
    if (!state.songs.length) list.innerHTML = '<div class="empty">Your song library is empty.</div>';

    $("songPicker").innerHTML = state.songs.length
      ? state.songs.map((song) => '<option value="' + escapeHtml(song.id) + '">' + escapeHtml(song.title) + '</option>').join("")
      : '<option value="">No songs saved</option>';
  }

  async function saveSong() {
    showError("");
    try {
      const song = await invoke("save_song", { song: songPayload() });
      await loadLibrary();
      editSong(song);
    } catch (error) {
      showError(error);
    }
  }

  function resetSetlistEditor() {
    state.editingSetlistId = null;
    state.draftItems = [];
    $("setlistEditorTitle").textContent = "New Setlist";
    $("setlistTitle").value = "";
    $("setlistGap").value = "4";
    $("deleteSetlist").hidden = true;
    renderDraft();
  }

  function editSetlist(setlist) {
    state.editingSetlistId = setlist.id;
    state.draftItems = setlist.items.map((item) => ({ ...item }));
    $("setlistEditorTitle").textContent = setlist.title;
    $("setlistTitle").value = setlist.title;
    $("setlistGap").value = setlist.gapBars;
    $("deleteSetlist").hidden = false;
    renderDraft();
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
        '<span class="item-copy"><b>' + escapeHtml(song ? song.title : item.songId) + '</b><small>' +
        escapeHtml(song ? song.bpm + " BPM" + (song.key ? " · " + song.key : "") : "Missing song") +
        '</small></span>' +
        '<div class="mini-actions"><button data-up>↑</button><button data-down>↓</button><button data-remove>×</button></div>';

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

  function setlistPayload() {
    return {
      id: state.editingSetlistId,
      title: $("setlistTitle").value.trim(),
      gapBars: Number($("setlistGap").value),
      items: state.draftItems.map((item) => ({ id: item.id, songId: item.songId }))
    };
  }

  function renderSetlists() {
    $("setlistCount").textContent = state.setlists.length;
    $("liveSetlistCount").textContent = state.setlists.length;

    const list = $("setlistList");
    list.innerHTML = "";
    state.setlists.forEach((setlist) => {
      const button = document.createElement("button");
      button.className = "data-row";
      button.innerHTML =
        '<span><b>' + escapeHtml(setlist.title) + '</b><small>' + setlist.items.length +
        ' song' + (setlist.items.length === 1 ? "" : "s") + '</small></span><span class="arrow">›</span>';
      button.addEventListener("click", () => editSetlist(setlist));
      list.appendChild(button);
    });
    if (!state.setlists.length) list.innerHTML = '<div class="empty">No saved setlists yet.</div>';

    const recent = $("recentSetlists");
    recent.innerHTML = "";
    state.setlists.slice(0, 5).forEach((setlist) => {
      const button = document.createElement("button");
      button.className = "data-row";
      button.innerHTML =
        '<span><b>' + escapeHtml(setlist.title) + '</b><small>' + setlist.items.length + ' songs</small></span><span class="arrow">›</span>';
      button.addEventListener("click", () => {
        editSetlist(setlist);
        go("setlists");
      });
      recent.appendChild(button);
    });
    if (!state.setlists.length) recent.innerHTML = '<div class="empty">Your first saved service will appear here.</div>';
  }

  async function saveSetlist() {
    showError("");
    try {
      const setlist = await invoke("save_setlist", { setlist: setlistPayload() });
      await loadLibrary();
      editSetlist(setlist);
    } catch (error) {
      showError(error);
    }
  }

  function renderRuntime() {
    const runtime = state.runtime;
    if (!runtime) return;

    $("databasePath").textContent = runtime.databasePath || "Unavailable";
    $("serverDot").className = "dot " + (runtime.serverRunning ? "ready" : "waiting");
    $("serverStatus").textContent = runtime.serverRunning ? "LAN remote ready" : "Starting local server";

    const links = runtime.localUrls || [];
    $("liveRemoteUrl").textContent = links.length ? links[0].replace(/\?token=.*/, "") : "No LAN address yet";

    const host = $("remoteLinks");
    host.innerHTML = "";
    links.forEach((url) => {
      const item = document.createElement("div");
      item.className = "remote-link";
      item.innerHTML = '<code>' + escapeHtml(url.replace(/\?token=.*/, "")) + '</code><button>Copy Link</button>';
      item.querySelector("button").addEventListener("click", async () => {
        await navigator.clipboard.writeText(url);
        item.querySelector("button").textContent = "Copied";
        setTimeout(() => item.querySelector("button").textContent = "Copy Link", 1200);
      });
      host.appendChild(item);
    });
    if (!links.length) host.innerHTML = '<div class="empty">Connect this Mac to the same network as the iPad.</div>';
  }

  async function loadLibrary() {
    const payload = await invoke("get_library");
    state.songs = payload.songs || [];
    state.setlists = payload.setlists || [];
    renderSongs();
    renderSetlists();
    renderDraft();
  }

  async function loadRuntime() {
    state.runtime = await invoke("get_runtime_info");
    renderRuntime();
  }

  $("newSong").addEventListener("click", resetSongEditor);
  $("saveSong").addEventListener("click", saveSong);
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
    state.draftItems.push({ id: uid(), songId });
    renderDraft();
  });
  $("saveSetlist").addEventListener("click", saveSetlist);
  $("deleteSetlist").addEventListener("click", async () => {
    if (!state.editingSetlistId || !confirm("Delete this setlist?")) return;
    try {
      await invoke("delete_setlist", { id: state.editingSetlistId });
      resetSetlistEditor();
      await loadLibrary();
    } catch (error) {
      showError(error);
    }
  });

  resetSongEditor();
  resetSetlistEditor();

  Promise.all([loadLibrary(), loadRuntime()]).catch((error) => showError(error));
  setInterval(() => loadRuntime().catch(() => {}), 2000);
})();