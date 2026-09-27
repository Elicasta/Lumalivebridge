# Luma Live Bridge

Luma Live Bridge is a local-first control layer for Ableton Live 12.

It gives you a browser/iPad command surface that can turn plain-English requests into a reviewed command plan, then apply approved changes to Ableton through Max for Live and LiveAPI.

## v0.1 goals

- Text command box with Preview -> Apply
- Local LAN remote for iPad/iPhone
- No cloud account and no external npm dependencies
- Allowlisted Ableton commands only
- Audit log
- Session state readback
- Scene launch and emergency Stop All
- Safe extension points for MainStage, LumaRig, ProPresenter, Planning Center, and a future ChatGPT relay

## Supported commands

v0.1 implements:

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
- mute/unmute track
- solo/unsolo track

Example:

> Create a song called Gratitude at 68 BPM with Intro, Verse, Chorus, Bridge, Build and Altar.

The remote produces a plan first. Nothing changes in Ableton until you press **Apply**.

## Architecture

```text
Browser / iPad PWA
        |
        | HTTP + SSE on your LAN
        v
node-bridge.js (Node for Max)
        |
        | allowlisted JSON commands
        v
live-api.js (Max JS + LiveAPI)
        |
        v
Ableton Live 12
```

## Install on macOS

### 1. Clone the repo

```bash
git clone https://github.com/Elicasta/Lumalivebridge.git
cd Lumalivebridge
```

### 2. Run the installer

```bash
chmod +x scripts/install-macos.sh
./scripts/install-macos.sh
```

This copies the self-contained device source into:

```text
~/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/Luma Live Bridge/
```

### 3. Create the Max for Live device once

Ableton requires the final `.amxd` to be saved from a Max for Live editor.

1. Open Ableton Live 12.
2. Create a MIDI track.
3. Drag a blank **Max MIDI Effect** onto it.
4. Choose **Edit in Max**.
5. In the Max-for-Live patcher, select all and delete the blank objects.
6. Open `LumaLiveBridge.maxpat` from the installed Luma Live Bridge folder.
7. Copy all objects from that patch.
8. Paste them into the blank Max MIDI Effect patcher.
9. Save the device as **Luma Live Bridge.amxd** in the same Luma Live Bridge folder.

That one-time step makes it a real Max for Live device. After that it appears in Ableton's Browser.

### 4. Load the device

Drop **Luma Live Bridge.amxd** on one MIDI track in the Set.

The Max console/device will print a LAN URL similar to:

```text
http://192.168.1.20:7878/?token=...
```

Open that exact URL on your iPad or Mac browser.

The token changes each launch unless you set `LUMA_BRIDGE_TOKEN`. API calls without the token are rejected.

## Development

No third-party npm packages are required.

```bash
npm test
```

Tests cover the command parser and validator without requiring Ableton or Max.

## Safety model

The browser cannot send arbitrary JavaScript, Max code, LiveAPI paths, shell commands, or file-system operations.

It can only request command types defined in `device/protocol.js` and accepted by `device/validator.js`.

A natural-language request is parsed into that allowlist, shown as a preview, and only sent to Live after confirmation.

## Local API

With the bridge running:

- `GET /api/state`
- `POST /api/plan` with `{"text":"set tempo to 72"}`
- `POST /api/apply` with a previewed plan
- `POST /api/direct` with one validated structured command
- `GET /api/log`
- `GET /events` for Server-Sent Events

API routes require the launch token.

## Current limitation

ChatGPT in the cloud cannot directly reach `localhost` or your private LAN. The bridge is intentionally local-first.

The next layer will be an authenticated relay/plugin that can send the same allowlisted command schema to this bridge. The local execution layer does not need to change when that is added.
