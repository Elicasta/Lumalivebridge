# Luma Live command language

v0.1 deliberately prefers explicit commands over creative guessing.

## Natural-language examples

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

## Song builder

```text
Create a song called Gratitude at 68 BPM with Intro, Verse, Chorus, Bridge, Build and Altar
```

This becomes one tempo change plus one appended scene for each section.

## Church-session builder

```text
Create a church session at 72 BPM
```

This creates the standard tracks:

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

A trusted local client can call `POST /api/direct` with:

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

Every direct command still passes through `validator.js`.

There is no command for shell execution, arbitrary JavaScript, arbitrary Max messages, arbitrary LiveAPI paths, or file-system operations.

## Human numbering

When text uses numeric references, Luma treats them as one-based:

```text
launch scene 3
```

maps to Live scene index `2`.
