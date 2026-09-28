"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const maxAPI = require("max-api");
const { validateCommand, validatePlan } = require("./validator");

const PORT = Number(process.env.LUMA_BRIDGE_PORT || 17878);
const HOST = "127.0.0.1";
const APP_DIR = path.join(os.homedir(), "Library", "Application Support", "LumaLiveBridge");
const LOG_FILE = path.join(APP_DIR, "audit.jsonl");
const pending = new Map();

let latestState = null;
let refreshInFlight = false;

fs.mkdirSync(APP_DIR, { recursive: true });

function writeAudit(event, payload = {}) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({
      at: new Date().toISOString(),
      event,
      payload
    }) + "\n");
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
  } catch (_) {
    return latestState;
  }
}

async function applyPlan(rawPlan) {
  const plan = validatePlan(rawPlan);
  const results = [];

  for (let index = 0; index < plan.commands.length; index += 1) {
    const command = plan.commands[index];
    try {
      const result = await sendToMax(command);
      results.push({ index, ok: true, command, result });
    } catch (error) {
      results.push({ index, ok: false, command, error: error.message });
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
    maxAPI.post("Luma Live adapter result parse error: " + error.message);
  }
});

maxAPI.addHandler("state_json", (payload) => {
  try {
    latestState = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch (error) {
    maxAPI.post("Luma Live adapter state parse error: " + error.message);
  }
});

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
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
  const url = new URL(req.url, "http://127.0.0.1:" + PORT);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        product: "luma-live-ableton-adapter",
        port: PORT,
        public: false
      });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const state = (await refreshState()) || latestState;
      return json(res, 200, { ok: true, state });
    }

    if (req.method === "POST" && url.pathname === "/api/direct") {
      const body = await readJson(req);
      const command = validateCommand(body.command);
      const result = await applyPlan({
        id: "direct-" + crypto.randomUUID(),
        title: "Direct command",
        text: "",
        confidence: 1,
        commands: [command],
        notes: []
      });
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === "POST" && url.pathname === "/api/apply") {
      const body = await readJson(req);
      const result = await applyPlan(body.plan);
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.method === "GET" && url.pathname === "/api/log") {
      let entries = [];
      try {
        entries = fs.readFileSync(LOG_FILE, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .slice(-100)
          .map((line) => JSON.parse(line));
      } catch (_) {}
      return json(res, 200, { ok: true, entries });
    }

    return json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    writeAudit("adapter_http_error", { path: url.pathname, error: error.message });
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  const address = "http://" + HOST + ":" + PORT;
  maxAPI.post("Luma Live Ableton adapter ready: " + address);
  maxAPI.outlet("status", "running");
  maxAPI.outlet("remote_url", address);
  writeAudit("adapter_started", { port: PORT, host: HOST });
  setTimeout(() => refreshState(), 500);
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
