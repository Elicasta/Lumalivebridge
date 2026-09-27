# Luma Live command language

Luma prefers explicit, previewable operations over creative guessing.

## Direct Ableton examples

```text
set tempo to 72
set time signature to 6/8
create audio track called Pad
create midi track called MainStage
rename track Click 2 to Click
create scene Chorus
rename scene 4 to Altar
launch scene Chorus
stop all
mute track BGV
unmute track BGV
solo track Click
set track Pad volume to 45%
```

## Build and save a reusable song

```text
Create a song called Gratitude at 72 BPM in 6/8 with Intro, Verse, Chorus, Bridge x2 and Outro
```

That produces:

- `set_tempo 72`
- `set_meter 6/8`
- Intro scene
- Verse scene
- Chorus scene
- Bridge 1 scene
- Bridge 2 scene
- Outro scene
- local `create_song` organizer command

The organizer command stores the reusable song at:

```text
~/Library/Application Support/LumaLiveBridge/library.json
```

### Section metadata

Repeats:

```text
Bridge x3
```

Bars can also be recorded in the reusable song model:

```text
Intro 4 bars, Verse 8 bars, Bridge 8 bars x2
```

Bars are metadata in v0.2. Scene length/clip construction will use them in a later layer.

## Load a saved song

```text
Load song Gratitude
```

The local `load_song` command reads the Song Library, then expands into validated Ableton commands for the saved tempo, meter, and section order.

The expanded commands still pass through `validator.js`.

## Church session builder

```text
Create a church session at 72 BPM
```

Creates the standard tracks:

1. GUIDE
2. CLICK
3. PAD
4. LOOPS
5. DRUMS
6. BASS
7. KEYS
8. GUITARS
9. BGV
10. TRACKS
11. MAINSTAGE
12. PROPRESENTER
13. LUMARIG

## Structured API

A trusted local client can call `POST /api/direct`:

```json
{
  "command": {
    "type": "set_tempo",
    "args": {
      "bpm": 72
    }
  }
}
```

Every direct command passes through `validator.js`.

There is no command for shell execution, arbitrary JavaScript, arbitrary Max messages, arbitrary LiveAPI paths, or arbitrary filesystem operations.

## Human numbering

Numeric references are one-based in natural language:

```text
launch scene 3
```

maps to Ableton scene index `2`.
