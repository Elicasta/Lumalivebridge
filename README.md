# Luma Live

Luma Live is one offline-first church show-control application for macOS, Ableton Live, and an iPad/browser remote.

The desktop app is the single source of truth for songs, sections, setlists, the active service, and the LAN remote. Max for Live is now a private Ableton adapter instead of a second app.

## Canonical architecture

```text
iPad / browser
      |
      | same-network HTTP
      v
Luma Live.app :7878–7897
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

## Luma Live 1.0 workspaces

### Live

Live is the timeline-first Arrangement performance workspace. It uses the same service map and Ableton state as the builder, with a compact service/library rail, MD transport, section strip, real Arrangement clip lanes, live playhead, cue markers, and persistent mixer.

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

Each saved song owns a portable package under `~/Music/Luma Live/Library/Songs/` with its Ableton Project, original stems, reference audio/grid data, cue assets, and exports.

### Build

Build is a service-specific ordered timeline of reusable songs. Songs can be dragged to reorder, transposed per service instance, and connected by Gap, Segue, Hold, Vamp, or Mashup transitions.

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

Only the Mac app listens publicly. It tries port `7878` first and falls back through `7897` if a port is already occupied.

The Settings page shows the actual tokenized URL to copy to an iPad on the same Wi-Fi or Ethernet network.

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

## 1.0 runtime gates

The automated gate covers Node syntax/runtime tests, Rust checks and unit tests, macOS compilation, ad-hoc signing with the required 4096-byte code-signing page size, launch smoke testing, and DMG packaging.

The final show-safety gate is real Ableton hardware/runtime validation on the target Mac:

- Max adapter reconnect after Ableton closes/reopens
- Arrangement audio and MIDI creation with real media
- stopped and playing section jumps in 4/4, 3/4, and 6/8
- repeated-song instances
- volume, mute, solo, Session clips/scenes, Capture MIDI, Session Record, Undo/Redo
- Hold and Vamp behavior across a full service
- Track Editor selected-clip reference linking and warp-marker writes

A failed service build preflights destination tracks before clearing the existing Luma Arrangement and removes partial Luma-owned clips, locators, loop/timeline state, and bulk mode if a write fails.


## Portable song packages and service builds

Luma Live keeps reusable song media outside the SQLite database under:

```text
~/Music/Luma Live/
├── Library/
│   ├── Songs/
│   │   └── <song-id>/
│   │       ├── <Song Name>.als
│   │       ├── song.json
│   │       ├── Audio/
│   │       ├── Cues/
│   │       └── Exports/
│   └── _Incoming/
├── Services/
│   └── <service name>/
│       └── build-<timestamp>/
│           ├── service.json
│           ├── <Service Name>.als
│           └── Songs/
├── Templates/
│   ├── Church Standard.als
│   ├── TRACKS.txt
│   └── Busk/
├── Backups/
└── Cache/
```

Saving a song in Luma Live scaffolds its package folder. Commonly named stems such as Click,
Guide, Drums, Bass, Keys, Guitar, and BGV are mapped to the standard Ableton tracks. A service
build collects copies of the song packages into a timestamped snapshot so a future library edit
does not silently change an already prepared service.

The service manifest stores absolute song/section timing, collected stems, song-specific cue
assets, and transition metadata. When the current Max adapter is connected, Luma can clear its
own prior Arrangement clips, create required tracks, place collected stems at their calculated
song starts, create Lighting/MIDI cue clips, and sync LL locators.

### Service transitions

Each setlist item owns the transition after that song:

- **Default Gap** uses the setlist-wide gap.
- **Gap** adds an explicit number of silent bars.
- **Segue** starts the next song on the exact next downbeat with no gap.
- **Hold** stops at the song boundary and parks playback at the next song, with a silent guard bar.
- **Vamp** loops a selected song section until the operator releases it by navigating onward.
- **Mashup** overlaps the next song by a chosen number of bars.

Mashup overlap currently requires matching BPM and meter. Different-tempo overlaps should be
warped or pre-rendered before building so one global Ableton transport tempo never has two
conflicting requirements.

Timing is stored in Ableton quarter-note beat units. Section bar positions are converted using
the song's time-signature denominator, so meters such as 6/8 retain correct local bar/beat math.
