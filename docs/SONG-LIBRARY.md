# Song Library and Arrangement Sync

Luma Live.app owns the permanent song and setlist model in SQLite.

## Song model

A song contains:

- title
- artist
- BPM
- key
- meter
- total length in bars
- reusable sections with local start bars

Example:

```json
{
  "title": "Goodness of God",
  "bpm": 63,
  "key": "Ab",
  "meter": { "numerator": 4, "denominator": 4 },
  "lengthBars": 96,
  "sections": [
    { "name": "Intro", "startBar": 1 },
    { "name": "Verse 1", "startBar": 9 },
    { "name": "Chorus", "startBar": 25 },
    { "name": "Bridge", "startBar": 57 },
    { "name": "Vamp", "startBar": 81 }
  ]
}
```

The exact SQLite file path is shown in the Mac app under **Settings → Local Database**.

## Arrangement map

A setlist is converted into sequential Arrangement placements. Every placement keeps the setlist item ID as an `instanceId`, so the same song can appear more than once without ambiguous jumps.

Meter denominator is respected when converting bars to Ableton timeline beats.

## Locator namespace

Luma owns only locators prefixed with `LL|`.

```text
LL|SONG|goodness-of-god|Goodness of God
LL|SECTION|goodness-of-god|chorus|Chorus
```

Sync removes/replaces only Luma locators. Existing non-Luma locators are not intentionally deleted. If a user locator occupies the exact same time, the Max adapter skips the Luma locator rather than overwriting it.

## Live flow

1. Build reusable songs in **Library**.
2. Build a service under **Setlists**.
3. Press **Sync to Ableton**.
4. Luma sends namespaced song/section locators through the localhost Max adapter.
5. Song Control derives the current song and section from the Ableton playhead.
6. Section and song buttons resolve against the exact setlist instance.
7. Track volume, mute, solo, transport, and click stay on the Song Control page.
8. Session View remains separate under **Busk**.

## Current boundary

Arrangement Sync currently covers metadata, navigation, locator sync, current-position context, BPM/meter changes on jumps, and live controls.

It does not yet import/place audio stems. Section jumps are immediate rather than next-bar quantized.
