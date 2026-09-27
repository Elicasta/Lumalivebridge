# Luma Live

Luma Live is an offline-first church show-control system for macOS.

The Mac app owns the permanent local song library, saved setlists, and same-network remote server. Ableton Live remains the playback engine and connects through the existing Max for Live bridge.

## v0.3 direction

The product is now split into clear layers:

```text
Luma Live.app
  ├─ SQLite song library
  ├─ saved setlists
  ├─ built-in LAN server
  ├─ desktop UI
  └─ iPad/iPhone remote
          |
          | local network only
          v
      Remote PWA

Ableton Live
  └─ Luma Live Bridge.amxd
```

Core library and setlist work does not require internet access.

## Desktop app

The macOS application is built with Tauri and lives in:

```text
src-tauri/
```

The desktop interface lives in:

```text
app/
```

The same-network remote is bundled from:

```text
remote/
```

Run locally:

```bash
npm install
npm run desktop:dev
```

Build an app and DMG:

```bash
npm run desktop:build
```

## Offline storage

Songs and setlists are stored in SQLite in the macOS application data directory.

The exact database path is shown inside **Settings → Local Database**.

The app can open, browse songs, edit songs, build setlists, and serve its iPad remote without an internet connection.

## Same-network remote

When Luma Live launches, it starts a local server.

It tries port `7878` first and automatically moves through `7897` if that port is already in use.

The Mac app shows a copyable address such as:

```text
http://192.168.1.42:7879/
```

The full copied URL includes the local access token. Open it on an iPad or iPhone connected to the same network.

If the internet goes down but the local Wi-Fi/Ethernet network remains up, the remote still works.

## Song Library

A saved song contains:

- title
- artist
- BPM
- key
- meter
- total length in bars
- reusable sections

Example:

```text
Intro @ 1
Verse 1 @ 9
Chorus @ 25
Verse 2 @ 41
Bridge @ 57
Vamp @ 81
```

The sections stay with the song every time it is used in a setlist.

## Setlist Builder

Saved songs can be placed into a service setlist, reordered, and reused.

This is the permanent layer that will feed the Ableton Arrangement sync rather than rebuilding every song by hand each week.

## Ableton bridge

The previous bridge implementation remains under:

```text
device/
```

That layer already contains the LiveAPI command bridge, command validator, browser remote, and the v0.2 Arrangement locator work.

The next integration step is to make the Tauri app the only LAN-facing server and connect it privately to the Max for Live device over localhost.

That will give the final shape:

```text
iPad
  ↓
Luma Live.app
  ↓
Ableton bridge
  ↓
Ableton Live
```

The iPad will no longer communicate directly with Max.

## Existing Arrangement sync work

The v0.2 bridge already includes:

- reusable song metadata
- setlists
- namespaced `LL|` song and section locators
- current song / current section detection
- exact section jump targets
- repeated-song-safe setlist instances

See:

- [Desktop architecture](docs/DESKTOP.md)
- [Song Library and Arrangement Sync](docs/SONG-LIBRARY.md)

## Tests

Node bridge tests:

```bash
npm test
```

macOS desktop compile check:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

GitHub Actions runs both on the relevant changes.

## Current boundary

v0.3 establishes the offline Mac app, local database, song/setlist editor, and built-in LAN remote.

Audio stem import and the private desktop-to-Ableton connection are the next implementation layers. We are intentionally not writing raw Ableton `.als` XML for routine service builds.
