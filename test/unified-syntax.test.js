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


test("restored Perform and Busk remote surface is present", () => {
  const remoteHtml = fs.readFileSync(path.join(__dirname, "..", "remote", "index.html"), "utf8");
  const remoteJs = fs.readFileSync(path.join(__dirname, "..", "remote", "app.js"), "utf8");

  assert.match(remoteHtml, /data-tab="perform"/);
  assert.match(remoteHtml, /data-tab="busk"/);
  assert.match(remoteHtml, /id="buskGrid"/);
  assert.match(remoteHtml, /id="sectionGrid"/);
  assert.match(remoteJs, /fire_clip/);
  assert.match(remoteJs, /stop_track/);
  assert.match(remoteJs, /\/api\/jump/);
});


test("iPad Perform can load a service directly", () => {
  const remoteHtml = fs.readFileSync(path.join(__dirname, "..", "remote", "index.html"), "utf8");
  const remoteJs = fs.readFileSync(path.join(__dirname, "..", "remote", "app.js"), "utf8");
  const remoteCss = fs.readFileSync(path.join(__dirname, "..", "remote", "styles.css"), "utf8");

  assert.match(remoteHtml, /id="serviceSelect"/);
  assert.match(remoteHtml, /id="serviceLoadBtn"/);
  assert.match(remoteJs, /syncSetlist/);
  assert.match(remoteJs, /performSceneSignature/);
  assert.match(remoteCss, /overflow-anchor:none/);
});


test("desktop song workflow exposes package files and full Busk controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");

  assert.match(html, /id="attachSongProject"/);
  assert.match(html, /id="importSongStems"/);
  assert.match(html, /id="saveSongCopy"/);
  assert.match(html, /id="desktopBuskGrid"/);
  assert.match(html, /id="runSystemCheck"/);

  assert.match(js, /attach_song_project/);
  assert.match(js, /import_song_stems/);
  assert.match(js, /transposeSemitones/);
  assert.match(js, /fire_clip/);
  assert.match(js, /stop_track/);
});

test("new song creation is protected from silent overwrite", () => {
  const db = fs.readFileSync(path.join(__dirname, "..", "src-tauri", "src", "db.rs"), "utf8");
  assert.match(db, /candidate = format!\("\{\}-\{\}", base, suffix\)/);
  assert.match(db, /new_song_with_same_title_gets_a_unique_id/);
});

test("desktop recurring poll does not recursively rescan song packages", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
  assert.match(js, /async function loadPackageStatuses/);
  assert.match(js, /setInterval\(\(\) => loadLibrary/);
  const libraryStart = js.indexOf("async function loadLibrary");
  const packageStart = js.indexOf("async function loadPackageStatuses", libraryStart);
  const libraryFn = js.slice(libraryStart, packageStart);
  assert.doesNotMatch(libraryFn, /get_song_package_statuses/);
});


test("desktop Busk keeps transport and per-track mixer controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");

  assert.match(html, /id="desktopBuskSync"/);
  assert.match(html, /id="desktopBuskClick"/);
  assert.match(html, /id="desktopBuskPlay"/);
  assert.match(html, /id="desktopBuskStop"/);
  assert.match(html, /id="desktopStopAll"/);

  assert.match(js, /busk-mini-toggle mute/);
  assert.match(js, /busk-mini-toggle solo/);
  assert.match(js, /set_track_mute/);
  assert.match(js, /set_track_solo/);
  assert.match(js, /clip\.color/);
});


test("extended Busk buttons are wired", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");

  for (const id of [
    "desktopPrevScene","desktopNextScene","desktopTapTempo","desktopCaptureMidi",
    "desktopSessionRecord","desktopUndo","desktopRedo","desktopClearClip",
    "desktopDuplicateClip","desktopDoubleClip","desktopSwing"
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(js, new RegExp(id));
  }

  for (const command of [
    "prev_scene","next_scene","tap_tempo","capture_midi","session_record",
    "undo","redo","clear_selected_clip","duplicate_selected_clip",
    "double_selected_clip","set_swing"
  ]) {
    assert.match(js, new RegExp(command));
  }
});


test("Track Editor exposes waveform Tap 1 and Ableton reference controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "app", "index.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");

  for (const id of [
    "referenceWaveform",
    "useAbletonReference",
    "importReferenceTrack",
    "analyzeReferenceTrack",
    "tapDownbeat",
    "saveReferenceAlignment",
    "applyReferenceWarp"
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }

  assert.match(js, /use_selected_ableton_reference/);
  assert.match(js, /analyze_reference_track/);
  assert.match(js, /capture_detail_clip_position/);
  assert.match(js, /apply_reference_warp/);
  assert.match(js, /data-section-name/);
});


test("service build preflights tracks before clearing and scrubs partial writes on failure", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src-tauri", "src", "main.rs"), "utf8");
  const buildStart = main.indexOf("async fn build_service");
  const buildEnd = main.indexOf("\nfn main()", buildStart);
  const build = main.slice(buildStart, buildEnd);

  const preflight = build.indexOf('bridge::send("ensure_track"');
  const clear = build.indexOf('bridge::send("clear_luma_arrangement"');
  assert.ok(preflight >= 0, "service build must preflight destination tracks");
  assert.ok(clear > preflight, "current Luma Arrangement must not be cleared before track preflight");

  const clearCalls = build.match(/bridge::send\("clear_luma_arrangement"/g) || [];
  assert.ok(clearCalls.length >= 2, "failed writes must attempt to remove partial Luma clips");
  assert.match(build, /"sync_cue_points"[\s\S]*Vec::<Value>::new\(\)/);
  assert.match(build, /"configure_service_timeline"[\s\S]*Vec::<Value>::new\(\)/);
});
