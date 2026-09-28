# Luma Live

Luma Live is one offline-first church show-control application for macOS, Ableton Live, and an iPad/browser remote.

The desktop app is the single source of truth for songs, sections, setlists, the active service, and the LAN remote. Max for Live is now a private Ableton adapter instead of a second app.

## Canonical architecture

```text
iPad / browser
      |
      | same-network HTTP
      v
Luma Live.app :7878
  ├─ Song Control
  ├─ Busk
  ├─ SQLite song library
  ├─ Setlists / active service
  ├─ Arrangement engine
  ├─ Plain-language command layer
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

There is no second Max-hosted iPad site and no second Max-owned song library.

## v0.4.1 pages

### Song Control

Song Control is the main Arrangement performance page.

It includes:

- current song
- current section and next section
- previous / next song
- previous / next section
- reusable section buttons
- bar / beat and song progress
- Play / Stop
- metronome
- BPM and meter
- track volume
- track mute / solo
- active service order
- plain-language commands

### Busk

Busk is intentionally separate from Song Control.

It exposes Session View scenes for spontaneous moments such as:

- pads
- vamps
- prayer
- shout loops
- altar
- walk-in music
- other live clips

Busk also includes **Stop All**.

### Library

Songs live permanently in the desktop SQLite database.

A song contains:

- title
- artist
- BPM
- key
- meter
- total length in bars
- named sections with start bars

Example:

```text
Intro @ 1
Verse 1 @ 9
Chorus @ 25
Verse 2 @ 41
Bridge @ 57
Vamp @ 81
```

Stems and cue assets are planned additions to this same canonical song record. They are not imported automatically yet.

### Setlists

A setlist is a service-specific ordered list of reusable songs.

A service can be made active even when Ableton is offline. Luma stores that choice locally, builds the Arrangement map immediately, and syncs namespaced Ableton locators whenever the Max adapter is available.

When a setlist is synced to Ableton, Luma sends:

```text
LL|SONG|<songId>|<title>
LL|SECTION|<songId>|<sectionId>|<sectionName>
```

Repeated appearances of the same song remain distinct through the setlist item's `instanceId`.

## Plain-language control

The command bar is available from Song Control on both the Mac and remote.

By default, pressing **Enter** or **Preview** performs a dry run first. Luma resolves the requested song, section, setlist, track, meter, or destination without changing Ableton or SQLite, then shows exactly what it intends to do. **Apply** runs that previewed command. **Run Now** remains available for fast live use when you intentionally want to skip confirmation.

Examples currently supported include:

```text
next section
previous section
next song
go to bridge
set tempo to 72
set meter to 6/8
click on
click off
mute guide
unmute guide
solo keys
set BGV volume to 45%
load Sunday AM
add Gratitude to Sunday AM after Hineh Ma Tov
make Bridge start at bar 65
set Bridge to bar 65 in Goodness of God
panic
```

Song creation is also local:

```text
create a song called Gratitude at 68 bpm in 4/4 with Intro 8 bars, Verse 8 bars, Chorus 8 bars, Bridge x2 8 bars, Vamp 8 bars
```

And the standard church track layout can be created in Ableton with an explicit session command.

The command grammar is intentionally allowlisted. It does not run arbitrary shell commands or arbitrary code.

## One local database

The desktop app owns SQLite.

The exact path is displayed under **Settings → Local Database**.

On first launch with an empty SQLite library, v0.4 can import legacy Luma data from:

```text
~/Library/Application Support/LumaLiveBridge/library/
~/Library/Application Support/LumaLiveBridge/library.json
```

This migration does not overwrite a non-empty canonical SQLite library.

## Network ownership

### Public LAN host

Only the Mac app listens publicly:

```text
0.0.0.0:7878
```

The Settings page shows the tokenized URL to copy to an iPad on the same Wi-Fi or Ethernet network.

### Private Ableton adapter

The Max device listens only on:

```text
127.0.0.1:17878
```

It exposes only the private state/command adapter needed by Luma Live.app.

## Arrangement timing

Arrangement positions are calculated from song meter, including the denominator.

For example, a 6/8 bar occupies three quarter-note beats in Ableton's timeline while the UI reports denominator-relative beats within the bar.

## Development

Desktop app:

```bash
npm install
npm run desktop:dev
```

Tests:

```bash
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

Build:

```bash
npm run desktop:build
```

The macOS CI build re-signs the development app with a 4096-byte code-signing page size, verifies the signature, launches the built executable for a smoke test, and only then creates the DMG.

## Current boundaries

The unified architecture is implemented in the `feature/unified-luma-live` branch, but the following still require real Ableton/macOS runtime validation before being treated as finished:

- the new app → localhost Max → LiveAPI path
- LiveAPI locator creation/deletion on the user's actual Ableton version
- track volume state and fader writes
- transport / metronome writes
- repeated-song section navigation during a real service
- behavior when Ableton closes/reopens while Luma Live stays open

Also not implemented yet:

- next-bar quantized section jumps
- WAV/stem folder import
- MultiTracks folder import
- Guide speech section detection
- Bonjour / mDNS discovery
- QR pairing
- native iPad app
- Apple Developer signing/notarization
- cloud sync

Current section jumps are immediate transport jumps. Luma does not pretend they are musically quantized yet.
