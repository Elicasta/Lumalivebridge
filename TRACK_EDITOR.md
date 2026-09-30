# Luma Live Track Editor

The Track Editor is the musical-grid layer between a source audio file and Ableton.

## Two source modes

### Use Selected Ableton Clip

Select an Arrangement or Session audio clip in Ableton so it becomes Live's Detail Clip, then choose **Use Selected Ableton Clip** in Luma.

Luma stores the source file path and analyzes that same file. It does not copy the audio merely to draw a waveform.

### Import Audio

Choose a WAV, AIFF, FLAC, MP3, M4A, or AAC file. Luma copies it into the song package under:

`Reference/Original/`

On macOS, non-WAV files are converted only to a temporary analysis WAV. The original file is not rewritten.

## Alignment workflow

1. **Analyze** generates a lightweight waveform cache and tempo/downbeat suggestions.
2. **Use Detected** applies the suggestions as an editable starting point.
3. For recordings that drift, play the selected Ableton clip and press **Tap 1** on successive measure downbeats.
4. Each Tap 1 point becomes a sample-time-to-musical-beat anchor.
5. **Save Grid** stores BPM, meter, first downbeat, and anchors in `Reference/reference.json`.
6. **Warp Selected Ableton Clip** writes the saved grid to the current Ableton Detail Clip.

The original audio file remains untouched. Luma changes Ableton clip warp metadata.

## Sections

Click anywhere on the waveform, then choose Intro, Verse, Pre-Chorus, Chorus, Bridge, Vamp, or Outro.

Luma converts the clicked time to a local song bar using the saved grid and updates the normal song section list. Repeated labels are numbered automatically.

## Service builds

A song can be built from either:

- an Ableton Project plus original stems, or
- one aligned reference/rehearsal track.

Reference-only songs are placed on the `REFERENCE` Arrangement lane. The saved warp grid travels with the service snapshot and is applied to the newly created reference clip.

A reference-only song must have a saved grid before **Build Service + Ableton** succeeds.

## Real-Ableton validation gate

Automated tests cover:

- waveform extraction
- alignment persistence
- UI wiring
- service placement data
- Max adapter command translation

Before show use, verify on the target Mac:

1. Detail Clip file-path discovery.
2. Tap 1 sample-position capture.
3. Actual LiveAPI warp-marker write.
4. Audio quality after warping and/or key transpose.
5. CPU/stutter behavior with a real service.

Settings → **Run Full Check** should report both the service-build API and Track Editor / Warp API as READY.
