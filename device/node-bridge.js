"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const maxAPI = require("max-api");
const { validateCommand } = require("./validator");

const PORT = Number(process.env.LUMA_BRIDGE_PORT || 17878);
const HOST = "127.0.0.1";
const APP_DIR = path.join(os.homedir(), "Library", "Application Support", "LumaLiveBridge");
const LOG_FILE = path.join(APP_DIR, "audit.jsonl");
const pending = new Map();

let latestState = null;

fs.mkdirSync(APP_DIR, { recursive: true });

function writeAudit(event, payload = {}) {
  const record = { at: new Date().toISOString(), event, payload };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n");
  } catch (_) {}
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
    if (result && result.state) latestState = result.state;
    return latestState;
  } catch (error) {
    writeAudit("state_refresh_failed", { error: error.message });
    return latestState;
  }
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
    maxAPI.post("Luma Live bridge result parse error: " + error.message);
  }
});

maxAPI.addHandler("state_json", (payload) => {
  try {
    latestState = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch (error) {
    maxAPI.post("Luma Live bridge state parse error: " + error.message);
  }
});

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "http://127.0.0.1:7878"
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + HOST + ":" + PORT);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "http://127.0.0.1:7878",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        product: "luma-live-ableton-adapter",
        version: "1.0.0",
        capabilities: [
          "arrangement-audio",
          "arrangement-overview",
          "transpose",
          "bulk-build",
          "extended-busk",
          "session-overview",
          "reference-editor",
          "detail-clip",
          "warp-editor"
        ],
        host: HOST,
        port: PORT
      });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const state = (await refreshState()) || latestState || {};
      return json(res, 200, { ok: true, state });
    }

    if (req.method === "POST" && url.pathname === "/api/direct") {
      const body = await readJson(req);
      const command = validateCommand(body.command);
      const result = await sendToMax(command, command.type === "sync_cue_points" ? 10000 : 3500);

      // Volume faders can generate a rapid stream of writes. The LiveAPI side
      // pushes state after every command and the desktop polls state separately,
      // so avoid an extra full snapshot for each slider movement.
      if (command.type !== "set_track_volume") {
        await refreshState();
      }

      writeAudit("command_applied", { command });
      return json(res, 200, {
        ok: true,
        result,
        state: latestState || {}
      });
    }

    return json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    writeAudit("bridge_error", { path: url.pathname, error: error.message });
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  maxAPI.post("Luma Live Ableton adapter: http://" + HOST + ":" + PORT);
  maxAPI.outlet("status", "running");
  maxAPI.outlet("remote_url", "http://" + HOST + ":" + PORT);
  writeAudit("bridge_started", { host: HOST, port: PORT });
  setTimeout(() => refreshState(), 600);
});

server.on("error", (error) => {
  maxAPI.post("Luma Live Ableton adapter failed: " + error.message);
  maxAPI.outlet("status", "error");
  writeAudit("bridge_server_error", { error: error.message });
});

process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
