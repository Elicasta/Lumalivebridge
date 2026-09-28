# Luma Live

Luma Live is an offline-first church show-control system for macOS with one local library, one LAN remote, and one private Ableton adapter.

## Canonical v0.4 architecture

```text
iPad / browser
      |
      | same-network LAN
      v
Luma Live.app
  ├─ Song Control
  ├─ Busk
  ├─ SQLite song library
  ├─ Setlists / services
  ├─ Arrangement engine
  ├─ Plain-language command planner
  └─ LAN remote host
      |
      | localhost only
      v
127.0.0.1:17878
      |
Luma Live.amxd
      |
Ableton LiveAPI
      |
Ableton Live
```

The Mac app is the only public LAN host. The Max for Live device no longer serves a competing public website or keeps a separate song library.

## Song Control

Song Control is Arrangement-first and includes:

- current song
- current section and next section
- previous / next song
- previous / next section
- section jump buttons
- song progress
- bar / beat
- Play / Stop
- metronome
- track volume
- track mute / solo
- current service order

Section jumps are currently immediate transport jumps. Quantized next-bar scheduling remains a separate live-safety layer.

## Busk

Busk is a separate page for spontaneous Session View material:

- pads
- vamps
- shout loops
- altar moments
- walk-in music
- Session scenes
- Stop All

Arrangement songs and spontaneous Session material stay intentionally separate.

## Library

SQLite is the single source of truth.

A song stores:

- title
- artist
- BPM
- key
- meter
- total length in bars
- sections

Example:

```text
Intro @ 1
Verse 1 @ 9
Chorus @ 25
Verse 2 @ 41
Bridge @ 57
Vamp @ 81
```

The active service is also persisted locally in SQLite.

## Setlists

Saved songs can be arranged into reusable service setlists. Loading a setlist:

1. makes it the active local service,
2. builds the Arrangement map,
3. creates namespaced `LL|SONG|` and `LL|SECTION|` locators in Ableton when the Max adapter is connected.

If Ableton is offline, the service still loads locally and can sync later.

## Plain language

The Mac app and remote share one local command planner.

Examples:

```text
set tempo to 72
click on
go to Chorus
set BGV volume to 45%
add Gratitude to Sunday AM after Hineh Ma Tov
set Bridge to bar 65 in Goodness of God
create song Gratitude at 68 bpm in B with Intro @ 1, Verse @ 9, Chorus @ 17
load Sunday AM
```

Commands are previewed before they are applied.

The planner currently supports a bounded set of explicit local-library and Ableton actions. It does not execute arbitrary shell commands.

## Network

The Mac app owns the LAN port.

It tries:

```text
7878 ... 7897
```

The full remote link includes a local token and is shown in **Settings**.

The Max adapter is private:

```text
http://127.0.0.1:17878
```

The iPad never connects directly to port 17878.

## Project layout

```text
app/            macOS desktop frontend
remote/         iPad / browser remote
src-tauri/      Tauri app, SQLite, LAN server, Arrangement engine, plain-language planner
device/         Max for Live Ableton adapter
test/           Node and browser syntax tests
```

## Development

```bash
npm install
npm test
cargo check --manifest-path src-tauri/Cargo.toml
npm run desktop:dev
```

Build:

```bash
npm run desktop:build
```

## Current boundary

Implemented in v0.4 integration:

- one Mac LAN authority
- localhost-only Max adapter
- SQLite songs / setlists / active service
- Arrangement song + section map
- namespaced Ableton locators
- Song Control
- separate Busk page
- track mixer controls
- unified Mac and iPad control surfaces
- local plain-language preview/apply flow

Still future work:

- automatic stem-folder import
- Guide speech section detection
- quantized next-bar section jumps
- stem persistence / file management
- MainStage, ProPresenter, LumaRig cue adapters
- migration helper for old bridge JSON libraries
