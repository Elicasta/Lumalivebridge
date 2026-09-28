"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

for (const relative of [
  ["remote", "app.js"],
  ["app", "app.js"],
  ["device", "node-bridge.js"],
  ["device", "validator.js"],
  ["device", "protocol.js"]
]) {
  test(relative.join("/") + " parses cleanly", () => {
    const file = path.join(__dirname, "..", ...relative);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
