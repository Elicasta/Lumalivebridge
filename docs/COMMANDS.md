# Luma Live plain-language commands

The plain-language bar belongs to Luma Live.app. Commands are parsed into an explicit allowlisted action set; arbitrary shell commands, arbitrary JavaScript, and arbitrary LiveAPI paths are not accepted.

## Live commands

Examples:

```text
play
stop
next section
previous section
next song
previous song
go to bridge
set tempo to 72
set meter to 6/8
click on
click off
mute BGV
unmute BGV
solo Keys
set Guide volume to 35%
panic
```

## Setlist commands

```text
load Sunday AM
sync Sunday AM
add Gratitude to Sunday AM
add Gratitude to Sunday AM after Hineh Ma Tov
```

## Song editing

When a synced song is current:

```text
make Bridge start at bar 65
```

## Song creation

```text
create a song called Gratitude at 68 bpm in 4/4 with Intro 8 bars, Verse 8 bars, Chorus 8 bars, Bridge x2 8 bars, Vamp 8 bars
```

Repeated section syntax such as `Bridge x2` expands into reusable section entries. When no section length is supplied, the local builder currently assumes eight bars.

## Church session setup

```text
create a church session at 72 bpm
```

The current standard Ableton track layout is:

1. CLICK
2. GUIDE
3. LOOPS
4. DRUMS
5. BASS
6. KEYS
7. GUITARS
8. BGV
9. TRACKS
10. MAINSTAGE
11. PROPRESENTER
12. LUMARIG

## API path

The iPad remote sends plain-language text to:

```text
POST /api/command
```

Luma Live.app performs the parsing and database operations. Ableton-specific actions are forwarded privately to `127.0.0.1:17878`.
