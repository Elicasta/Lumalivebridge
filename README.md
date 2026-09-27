# Luma Live Bridge

Luma Live Bridge is a local-first Ableton Live 12 command layer and reusable session organizer.

It gives you a Mac/iPad command surface where you can describe a session in plain English, preview the exact structured operations, then apply the approved plan to Ableton through Max for Live and LiveAPI.

## v0.2

The bridge now has two brains:

1. **Ableton execution**
   - tracks
   - scenes
   - tempo
   - meter
   - clips
   - mute / solo / volume
   - scene launch
   - stop all

2. **Local session organization**
   - reusable Song Library stored on the Mac
   - song tempo + meter
   - reusable section order
   - section repeats
   - reload a saved song into a later Ableton Set
   - LAN UI for browsing and loading saved songs

The organizer state is stored at:

```text
~/Library/Application Support/LumaLiveBridge/library.json
```

No cloud account is required.

## Plain-language example

Type:

```text
Create a song called Gratitude at 72 BPM in 6/8 with Intro, Verse, Chorus, Bridge x2 and Outro
```

Luma previews a plan that:

1. sets Ableton to 72 BPM
2. sets the meter to 6/8
3. creates Intro
4. creates Verse
5. creates Chorus
6. creates Bridge 1
7. creates Bridge 2
8. creates Outro
9. saves Gratitude to the local Song Library

Nothing changes until **Apply to Ableton** is pressed.

Later:

```text
Load song Gratitude
```

Luma reads the saved song from the local library and rebuilds its tempo, meter, and section scenes in the current Ableton Set.

## Architecture

```text
Mac / iPad PWA
      |
      | HTTP + SSE on local LAN
      v
node-bridge.js
      |
      +--> parser.js
      |      plain language -> reviewed command plan
      |
      +--> validator.js
      |      allowlisted command schema
      |
      +--> session-store.js
      |      local reusable song library
      |
      +--> local organizer commands
      |      create_song / load_song
      |
      +--> Ableton commands
             |
             v
        live-api.js
             |
             v
        Ableton Live 12
```

Local organizer commands never get forwarded into LiveAPI. They are handled by the bridge and can only expand into the same validated Ableton command allowlist.

## Supported commands

### Ableton

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

### Organizer

- create/save reusable song
- load reusable song

More organizer operations will build on this same local model: arrangements, setlists, track templates, Planning Center import, and the ChatGPT relay.

## Install on macOS

### 1. Clone

```bash
git clone https://github.com/Elicasta/Lumalivebridge.git
cd Lumalivebridge
```

### 2. Install

```bash
chmod +x scripts/install-macos.sh
./scripts/install-macos.sh
```

The installer symlinks the repo's `device/` folder into Ableton's User Library. A normal git update changes the bridge source without copying it again.

### 3. Create the Max for Live device once

Ableton requires the final `.amxd` to be saved from Max for Live.

1. Open Ableton Live 12.
2. Create a MIDI track.
3. Drag a blank **Max MIDI Effect** onto it.
4. Choose **Edit in Max**.
5. Delete the blank patch contents.
6. Open `device/LumaLiveBridge.maxpat`.
7. Copy its objects into the blank Max MIDI Effect patcher.
8. Save as **Luma Live Bridge.amxd** in the Luma Live Bridge User Library folder.

### 4. Load it

Drop **Luma Live Bridge.amxd** on one MIDI track.

The device prints a LAN URL similar to:

```text
http://192.168.1.20:7878/?token=...
```

Open that exact URL on the Mac or iPad.

## Updating

```bash
./scripts/update-macos.sh
```

The PWA cache is versioned, so a bridge update will replace the previous cached interface instead of leaving an old iPad UI behind.

## Local API

Authenticated with the launch token:

- `GET /api/state`
- `GET /api/library`
- `POST /api/plan`
- `POST /api/apply`
- `POST /api/direct`
- `GET /api/log`
- `GET /events`

## Safety model

The browser cannot submit arbitrary JavaScript, shell commands, Max code, LiveAPI paths, or filesystem paths.

Plain language is translated to allowlisted structured commands first. The user sees that plan before execution.

Local organizer commands are routed separately from Ableton commands. Loading a saved song can only expand into validated commands such as `set_tempo`, `set_meter`, and `create_scene`.

## Development

No third-party npm packages are required.

```bash
npm test
```

Tests cover:

- plain-language parsing
- validation
- section repeat parsing
- persistent song storage
- reload expansion back into Ableton commands

## Next organizer layer

The next contained build is:

```text
Song Library
    ↓
Arrangement
    ↓
Setlist
    ↓
Build Ableton Session
```

That is where a song can keep its normal arrangement while a specific Sunday uses a different section order.
