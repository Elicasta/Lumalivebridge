# Song Library and Arrangement Sync

Luma Live v0.2 treats Ableton as the playback engine and Luma Live as the reusable song/setlist layer.

## Song model

A saved song contains:

- title and artist
- BPM
- key
- meter
- total length in bars
- named sections with local start bars

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

Songs are stored locally under:

```text
~/Library/Application Support/LumaLiveBridge/library/songs/
```

Setlists live beside them under `library/setlists/`.

## Ableton locator namespace

When a setlist is synced, Luma Live creates only locators prefixed with `LL|`.

Song markers:

```text
LL|SONG|goodness-of-god|Goodness of God
```

Section markers:

```text
LL|SECTION|goodness-of-god|chorus|Chorus
```

On the next sync, Luma Live removes and recreates only its own `LL|` locators. Existing non-Luma locators are left alone. If a user locator already occupies the exact same time, Luma Live skips that marker rather than deleting the user's locator.

## Setlist flow

1. Open the Luma Live remote.
2. Save songs in **Songs**.
3. Open **Setlist**, add songs, and reorder them.
4. Set the gap between songs.
5. Press **Sync to Ableton**.
6. Ableton receives namespaced song and section locators.
7. The **Live** page follows the Ableton playhead and derives:
   - current song
   - current section
   - next section
8. Tapping a section on the remote jumps to that exact section in that exact setlist song instance.

The setlist supports repeated songs because each placement has its own instance ID.

## Current v0.2 boundary

Arrangement Sync currently handles the navigation layer: song boundaries, section locators, current-song tracking, section jumps, BPM, and meter on jumps.

It does **not yet place audio stems into Arrangement View**. Audio import is the next layer. Keeping that separate prevents brittle direct editing of `.als` XML and lets Ableton remain responsible for its own session file format.
