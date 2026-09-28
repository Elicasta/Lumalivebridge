"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const files = [
  "app/app.js",
  "remote/app.js",
  "device/node-bridge.js",
  "device/live-api.js"
];

for (const relative of files) {
  test(relative + " parses cleanly", () => {
    const file = path.join(__dirname, "..", relative);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}


test("six-digit pairing surface is present", () => {
  const remoteHtml = fs.readFileSync(path.join(__dirname, "..", "remote", "index.html"), "utf8");
  const remoteJs = fs.readFileSync(path.join(__dirname, "..", "remote", "app.js"), "utf8");
  const lanRs = fs.readFileSync(path.join(__dirname, "..", "src-tauri", "src", "lan.rs"), "utf8");

  assert.match(remoteHtml, /pairingCodeInput/);
  assert.match(remoteJs, /\/api\/pair/);
  assert.match(lanRs, /route\("\/api\/pair", post\(pair\)\)/);
});
