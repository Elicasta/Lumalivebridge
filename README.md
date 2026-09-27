# Luma Live Bridge

Luma Live Bridge is a local-first church show-control layer for Ableton Live 12.

It keeps Ableton as the audio engine while Luma Live owns the reusable **Song Library**, **Setlist Builder**, section navigation, iPad remote, and safe command bridge.

## v0.2

The current build adds an Arrangement-first workflow:

- reusable Song Library
- song BPM, key, meter, total bars, and named sections
- reusable saved setlists
- reorderable service setlists
- namespaced Ableton locators for songs and sections
- current song / current section / next section derived from the Ableton playhead
- big section-jump buttons on the remote
- exact song-instance navigation even when a song appears twice in a setlist
- local persistence under `~/Library/Application Support/LumaLiveBridge/library/`
- existing command preview/apply surface preserved
- legacy Session View scene launcher preserved

## Architecture

```text
Browser / iPad PWA
        |
        | HTTP + SSE on church LAN
        v
node-bridge.js (Node for Max)
        |
        | validated JSON commands
        v
live-api.js (Max JS + LiveAPI)
        |
        v
Ableton Live 12
```

The new reusable-song layer lives beside the bridge:

```text
Song Library
     |
     v
Setlist Builder
     |
     v
Arrangement Planner
     |
     +--> Ableton LL| locators
     +--> Remote current-song/current-section state
```

## Ableton locator namespace

Luma Live only owns locators beginning with:

```text
LL|
```

Examples:

```text
LL|SONG|goodness-of-god|Goodness of God
LL|SECTION|goodness-of-god|chorus|Chorus
```

A setlist sync replaces only Luma-owned locators. If a normal Ableton locator already exists at the exact same time, Luma Live skips that locator instead of deleting or renaming the user's marker.

## Typical church workflow

1. Open the church Ableton master set.
2. Load the **Luma Live Bridge** Max for Live device.
3. Open the printed LAN URL on the Mac or iPad.
4. Go to **Songs** and save reusable song metadata.
5. Enter sections as:
   ```text
   Intro @ 1
   Verse 1 @ 9
   Chorus @ 25
   Bridge @ 57
   Vamp @ 81
   ```
6. Go to **Setlist**, add songs in service order, and reorder them.
7. Press **Sync to Ableton**.
8. Use **Live** during service. The remote follows the Ableton playhead automatically.

## Current v0.2 boundary

v0.2 syncs the **navigation layer** into Ableton:

- song boundaries
- section locators
- current song/section state
- section jumps
- BPM and meter when manually jumping to a song or section

It does not yet place WAV stems into Arrangement View.

That is intentional. The next layer will import stems through Ableton-facing operations instead of directly rewriting `.als` XML.

See [docs/SONG-LIBRARY.md](docs/SONG-LIBRARY.md).

## Existing bridge commands

The original allowlisted command system remains available:

- create MIDI/audio track
- rename track
- create scene
- rename scene
- set tempo
- set time signature
- launch scene
- stop all clips
- create MIDI clip
- duplicate clip slot
- set clip loop
- set track volume
- mute/unmute
- solo/unsolo

Every natural-language command is previewed before execution.

## Install on macOS

Clone the repo:

```bash
git clone https://github.com/Elicasta/Lumalivebridge.git
cd Lumalivebridge
```

Run:

```bash
chmod +x scripts/install-macos.sh
./scripts/install-macos.sh
```

The installer symlinks the repo's `device/` directory into the Ableton User Library. That means future `git pull` updates change the bridge source without another copy/install pass.

### Create the Max for Live device once

Ableton requires the final `.amxd` to be saved from Max for Live:

1. Create a MIDI track in Ableton.
2. Add a blank **Max MIDI Effect**.
3. Choose **Edit in Max**.
4. Replace the blank patch with `device/LumaLiveBridge.maxpat`.
5. Save it as **Luma Live Bridge.amxd** in the linked Luma Live Bridge folder.

Drop that device on one MIDI track in the church set.

The Max console prints a URL similar to:

```text
http://192.168.1.20:7878/?token=...
```

Open that exact URL on the iPad or Mac.

## Updating

```bash
./scripts/update-macos.sh
```

Reload the Max for Live device after pulling if Max has not reloaded the JavaScript automatically.

## Development

No third-party npm packages are required.

```bash
npm test
```

Tests cover:

- parser
- command validator
- song normalization/persistence
- setlist persistence
- arrangement planning
- current song/section mapping
- repeated-song-safe jump targets

## Safety

The browser cannot run arbitrary JavaScript, shell commands, Max code, or arbitrary LiveAPI paths.

The bridge only accepts command types defined in `device/protocol.js` and validated in `device/validator.js`.

Song/setlist storage is local to the Mac. No cloud account is required.
