"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const maxAPI = require("max-api");
const { parseText } = require("./parser");
const { validateCommand, validatePlan } = require("./validator");
const { createStore } = require("./song-store");
const { buildArrangement, locatePosition, findJumpTarget } = require("./arrangement");

const PORT = Number(process.env.LUMA_BRIDGE_PORT || 7878);
const HOST = "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const APP_DIR = path.join(os.homedir(), "Library", "Application Support", "LumaLiveBridge");
const LOG_FILE = path.join(APP_DIR, "audit.jsonl");
const TOKEN_FILE = path.join(APP_DIR, "token");
const DATA_DIR = path.join(APP_DIR, "library");
const pending = new Map();
const clients = new Set();

let latestState = null;
let activeArrangement = null;
let refreshInFlight = false;

fs.mkdirSync(APP_DIR, { recursive: true });
const store = createStore(DATA_DIR);

function songMap() {
  const map = {};
  for (const song of store.listSongs()) map[song.id] = song;
  return map;
}

function rebuildActiveArrangement() {
  const activeId = store.getActiveSetlistId();
  const setlist = activeId ? store.getSetlist(activeId) : null;
  if (!setlist) {
    activeArrangement = null;
    return null;
  }
  activeArrangement = buildArrangement(setlist, songMap());
  return activeArrangement;
}

function libraryPayload() {
  return {
    songs: store.listSongs(),
    setlists: store.listSetlists(),
    activeSetlistId: store.getActiveSetlistId(),
    arrangement: activeArrangement
  };
}

function enrichState(state) {
  if (!state) return state;
  return {
    ...state,
    liveContext: locatePosition(activeArrangement, state.currentSongTime),
    activeSetlistId: store.getActiveSetlistId()
  };
}

rebuildActiveArrangement();

function loadOrCreateToken() {
  if (process.env.LUMA_BRIDGE_TOKEN) return process.env.LUMA_BRIDGE_TOKEN;

  try {
    const saved = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (saved) return saved;
  } catch (_) {}

  const created = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(TOKEN_FILE, created + "\n", { mode: 0o600 });
  return created;
}

const TOKEN = loadOrCreateToken();

function writeAudit(event, payload = {}) {
  const record = {
    at: new Date().toISOString(),
    event,
    payload
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n");
  } catch (_) {}
  broadcast("audit", record);
}

function broadcast(type, data) {
  const message = "event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n";
  for (const res of clients) {
    try {
      res.write(message);
    } catch (_) {
      clients.delete(res);
    }
  }
}

function localUrls() {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const item of nets[name] || []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push("http://" + item.address + ":" + PORT + "/?token=" + TOKEN);
      }
    }
  }
  return urls;
}

function sendToMax(command, timeoutMs = 3500) {
  const requestId = crypto.randomUUID();
  const packet = { requestId, command };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Ableton did not answer in time"));
    }, timeoutMs);

    pending.set(requestId, { resolve, reject, timer });
    maxAPI.outlet("command_json", JSON.stringify(packet));
  });
}

async function refreshState() {
  try {
    const result = await sendToMax({ type: "get_state", args: {} }, 2500);
    if (result && result.state) {
      latestState = enrichState(result.state);
      broadcast("state", latestState);
    }
    return latestState;
  } catch (_) {
    return latestState;
  }
}

async function applyPlan(rawPlan) {
  const plan = validatePlan(rawPlan);
  const results = [];

  writeAudit("plan_apply_started", {
    planId: plan.id,
    title: plan.title,
    commandCount: plan.commands.length
  });

  for (let index = 0; index < plan.commands.length; index += 1) {
    const command = plan.commands[index];
    try {
      const result = await sendToMax(command);
      results.push({ index, ok: true, command, result });
      writeAudit("command_applied", { planId: plan.id, index, command });
    } catch (error) {
      const failure = {
        index,
        ok: false,
        command,
        error: error.message
      };
      results.push(failure);
      writeAudit("command_failed", { planId: plan.id, ...failure });
      break;
    }
  }

  await refreshState();

  return {
    ok: results.every((item) => item.ok),
    planId: plan.id,
    results,
    state: latestState
  };
}

maxAPI.addHandler("result_json", (payload) => {
  try {
    const result = typeof payload === "string" ? JSON.parse(payload) : payload;
    const slot = result && pending.get(result.requestId);
    if (!slot) return;

    clearTimeout(slot.timer);
    pending.delete(result.requestId);

    if (result.ok) slot.resolve(result);
    else slot.reject(new Error(result.error || "Ableton command failed"));
  } catch (error) {
    maxAPI.post("Luma Live Bridge result parse error: " + error.message);
  }
});

maxAPI.addHandler("state_json", (payload) => {
  try {
    latestState = enrichState(typeof payload === "string" ? JSON.parse(payload) : payload);
    broadcast("state", latestState);
  } catch (error) {
    maxAPI.post("Luma Live Bridge state parse error: " + error.message);
  }
});

function requireToken(req, url) {
  const header = req.headers["x-luma-token"];
  const query = url.searchParams.get("token");
  return header === TOKEN || query === TOKEN;
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Luma-Token"
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 65536) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[ext] || "application/octet-stream";
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  rel = rel.replace(/\\/g, "/");
  const root = path.resolve(PUBLIC_DIR);
  const file = path.resolve(root, "." + rel);
  const relative = path.relative(root, file);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": mime(file),
      "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=60"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Luma-Token",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
    });
    return res.end();
  }

  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, version: "0.1.0" });
  }

  if (url.pathname.startsWith("/api/") || url.pathname === "/events") {
    if (!requireToken(req, url)) {
      return json(res, 401, { ok: false, error: "Invalid or missing bridge token" });
    }
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      const state = (await refreshState()) || latestState;
      return json(res, 200, { ok: true, state });
    }

    if (req.method === "POST" && url.pathname === "/api/plan") {
      const body = await readJson(req);
      const plan = parseText(body.text);
      writeAudit("plan_created", {
        planId: plan.id,
        title: plan.title,
        text: plan.text,
        commandCount: plan.commands.length
      });
      return json(res, 200, { ok: true, plan });
    }

    if (req.method === "POST" && url.pathname === "/api/apply") {
      const body = await readJson(req);
      const result = await applyPlan(body.plan);
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === "POST" && url.pathname === "/api/direct") {
      const body = await readJson(req);
      const command = validateCommand(body.command);
      const plan = {
        id: "direct-" + crypto.randomUUID(),
        title: "Direct command",
        text: "",
        confidence: 1,
        commands: [command],
        notes: []
      };
      const result = await applyPlan(plan);
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === "GET" && url.pathname === "/api/library") {
      return json(res, 200, { ok: true, ...libraryPayload() });
    }

    if (req.method === "POST" && url.pathname === "/api/songs") {
      const body = await readJson(req);
      const song = store.saveSong(body.song || body);
      rebuildActiveArrangement();
      const library = libraryPayload();
      broadcast("library", library);
      writeAudit("song_saved", { songId: song.id, title: song.title });
      return json(res, 200, { ok: true, song, ...library });
    }

    const songDeleteMatch = url.pathname.match(/^\/api\/songs\/([^/]+)$/);
    if (req.method === "DELETE" && songDeleteMatch) {
      const songId = decodeURIComponent(songDeleteMatch[1]);
      for (const setlist of store.listSetlists()) {
        if (setlist.items.some((item) => item.songId === songId)) {
          throw new Error("Remove this song from setlists before deleting it");
        }
      }
      store.deleteSong(songId);
      rebuildActiveArrangement();
      const library = libraryPayload();
      broadcast("library", library);
      writeAudit("song_deleted", { songId });
      return json(res, 200, { ok: true, ...library });
    }

    if (req.method === "POST" && url.pathname === "/api/setlists") {
      const body = await readJson(req);
      const setlist = store.saveSetlist(body.setlist || body);
      if (store.getActiveSetlistId() === setlist.id) rebuildActiveArrangement();
      const library = libraryPayload();
      broadcast("library", library);
      writeAudit("setlist_saved", { setlistId: setlist.id, title: setlist.title });
      return json(res, 200, { ok: true, setlist, ...library });
    }

    const setlistDeleteMatch = url.pathname.match(/^\/api\/setlists\/([^/]+)$/);
    if (req.method === "DELETE" && setlistDeleteMatch) {
      const setlistId = decodeURIComponent(setlistDeleteMatch[1]);
      store.deleteSetlist(setlistId);
      rebuildActiveArrangement();
      const library = libraryPayload();
      broadcast("library", library);
      writeAudit("setlist_deleted", { setlistId });
      return json(res, 200, { ok: true, ...library });
    }

    const syncMatch = url.pathname.match(/^\/api\/setlists\/([^/]+)\/sync$/);
    if (req.method === "POST" && syncMatch) {
      const setlistId = decodeURIComponent(syncMatch[1]);
      const setlist = store.getSetlist(setlistId);
      if (!setlist) throw new Error("Setlist not found");
      const arrangement = buildArrangement(setlist, songMap());
      const commandResult = await sendToMax({
        type: "sync_cue_points",
        args: {
          replace: true,
          points: arrangement.markers.map((point) => ({
            time: point.time,
            name: point.name
          }))
        }
      }, 10000);
      store.setActiveSetlistId(setlist.id);
      activeArrangement = arrangement;
      await refreshState();
      const library = libraryPayload();
      broadcast("library", library);
      writeAudit("setlist_synced", {
        setlistId: setlist.id,
        title: setlist.title,
        markers: arrangement.markers.length
      });
      return json(res, 200, {
        ok: true,
        arrangement,
        sync: commandResult,
        state: latestState,
        ...library
      });
    }

    if (req.method === "GET" && url.pathname === "/api/arrangement") {
      return json(res, 200, { ok: true, arrangement: activeArrangement });
    }

    if (req.method === "POST" && url.pathname === "/api/jump") {
      const body = await readJson(req);
      const target = findJumpTarget(activeArrangement, String(body.songId || ""), body.sectionId ? String(body.sectionId) : null);
      await sendToMax({ type: "set_tempo", args: { bpm: target.song.bpm } });
      await sendToMax({
        type: "set_meter",
        args: {
          numerator: target.song.meter.numerator,
          denominator: target.song.meter.denominator
        }
      });
      await sendToMax({ type: "jump_to_time", args: { time: target.time } });
      await refreshState();
      writeAudit("arrangement_jump", {
        songId: target.song.songId,
        sectionId: target.section ? target.section.id : null,
        time: target.time
      });
      return json(res, 200, { ok: true, state: latestState });
    }

    if (req.method === "GET" && url.pathname === "/api/log") {
      let lines = [];
      try {
        lines = fs
          .readFileSync(LOG_FILE, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .slice(-100)
          .map((line) => JSON.parse(line));
      } catch (_) {}
      return json(res, 200, { ok: true, entries: lines });
    }

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      res.write("event: connected\ndata: {}\n\n");
      clients.add(res);
      if (latestState) {
        res.write("event: state\ndata: " + JSON.stringify(latestState) + "\n\n");
      }
      res.write("event: library\ndata: " + JSON.stringify(libraryPayload()) + "\n\n");
      req.on("close", () => clients.delete(res));
      return;
    }

    return serveStatic(req, res, url);
  } catch (error) {
    writeAudit("http_error", { path: url.pathname, error: error.message });
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  const urls = localUrls();
  const primary = urls[0] || "http://127.0.0.1:" + PORT + "/?token=" + TOKEN;
  maxAPI.post("Luma Live Bridge running: " + primary);
  maxAPI.outlet("status", "running");
  maxAPI.outlet("remote_url", primary);
  writeAudit("bridge_started", { port: PORT });
  setTimeout(() => refreshState(), 700);
  setInterval(async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await refreshState();
    } finally {
      refreshInFlight = false;
    }
  }, 750);
});

process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
