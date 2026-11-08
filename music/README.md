# Music

Background music is generated with the [Treblo](https://treblo.com/developers/docs) API (formerly Sonauto), then cut into seamless loops and committed. Like the sound effects, nothing is generated at runtime.

- `tools/treblo.py` submits generation jobs from a JSON list, polls them and downloads the audio. It reads `TREBLO_API_KEY` from the environment or the git-ignored `.env`. Each v3 request costs 100 credits.
- `tools/make_loop.py` finds the best-matching pair of bar starts in a track, cuts a bar-aligned loop with a short crossfade at the wrap point, and writes Ogg (Opus, 160 kbps) plus a JSON sidecar with tempo, bar count and loop points. Run it with `uv run --with librosa --with soundfile python tools/make_loop.py IN.wav OUT.ogg`.
- `tools/loop_with_tempo.py` runs `make_loop.py`, measures the loop's tempo by onset autocorrelation, snaps it to a whole number of bars, and records `beats`, `bars` and the exact `tempo_bpm` in the sidecar. Every version is measured the same way.
- `tools/tempo.py` prints several tempo estimates for checking; `tools/match_variant.py` can time-stretch a version to a target tempo if that is ever needed.
- `loops/` holds chosen loops: `take2-loop` (main theme, 131.4 BPM, 83 bars), `stripped-sleaze-loop` (129.2 BPM, 64 bars) and `blaxploitation-horns-loop` (141.6 BPM, 77 bars). `take2-loop-seam-test.ogg` plays the main loop's wrap point.
- `auditions/` holds trial renders and is git-ignored until a take is chosen.

## Switching between versions

Versions keep their own natural tempos. When the game switches, it glides the playback speed from one tempo to the other, like a tape machine, while crossfading. A shared beat clock drives both loops, so the incoming loop enters on the same beat of the bar and both stay locked through the glide. This needs each loop to hold a whole number of bars and start on a downbeat, which `loop_with_tempo.py` guarantees.

Audition loops and switches at `/theme.html` on the dev server (`src/theme-room/`): pick a track to start, pick another to crossfade. Options: crossfade length, switching on the next bar, and a beat click for checking alignment by ear.
