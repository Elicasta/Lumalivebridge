"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

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
