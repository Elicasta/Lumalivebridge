(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const incoming = params.get("token");
  if (incoming) localStorage.setItem("lumaLiveToken", incoming);
  const token = incoming || localStorage.getItem("lumaLiveToken") || "";

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function setStatus(online) {
    $("status").textContent = online ? "CONNECTED" : "OFFLINE";
    $("status").className = "status " + (online ? "online" : "offline");
  }

  function error(message) {
    $("error").textContent = message || "";
    $("error").hidden = !message;
  }

  async function api(path) {
    if (!token) throw new Error("Open the remote using the full link shown in Luma Live on the Mac.");
    const response = await fetch(path, {
      headers: { "X-Luma-Token": token },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Luma Live request failed");
    return data;
  }

  function row(title, meta) {
    return '<div class="row"><span><b>' + escapeHtml(title) + '</b><small>' +
      escapeHtml(meta || "") + '</small></span></div>';
  }

  function render(payload) {
    const songs = payload.songs || [];
    const setlists = payload.setlists || [];

    $("songCount").textContent = songs.length;
    $("setlistCount").textContent = setlists.length;
    $("liveSetlistCount").textContent = setlists.length;

    $("songList").innerHTML = songs.length
      ? songs.map((song) => row(song.title, [song.artist, song.bpm + " BPM", song.key].filter(Boolean).join(" · "))).join("")
      : '<div class="empty">No songs saved yet.</div>';

    const setlistHtml = setlists.length
      ? setlists.map((setlist) => row(setlist.title, setlist.items.length + " songs")).join("")
      : '<div class="empty">No setlists saved yet.</div>';

    $("setlistList").innerHTML = setlistHtml;
    $("liveSetlists").innerHTML = setlistHtml;
  }

  async function refresh() {
    try {
      render(await api("/api/library"));
      setStatus(true);
      error("");
    } catch (err) {
      setStatus(false);
      error(err.message || String(err));
    }
  }

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.dataset.page === button.dataset.tab));
    });
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  refresh();
  setInterval(refresh, 2500);
})();