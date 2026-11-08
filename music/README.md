# Music

Background music is generated with the [Treblo](https://treblo.com/developers/docs) API (formerly Sonauto), then cut into seamless loops and committed. Like the sound effects, nothing is generated at runtime.

- `tools/treblo.py` submits generation jobs from a JSON list, polls them and downloads the audio. It reads `TREBLO_API_KEY` from the environment or the git-ignored `.env`. Each v3 request costs 100 credits.
- `tools/make_loop.py` finds the best-matching pair of bar starts in a track, cuts a bar-aligned loop with a short crossfade at the wrap point, and writes Ogg (Opus, 160 kbps) plus a JSON sidecar with tempo, bar count and loop points. Run it with `uv run --with librosa --with soundfile python tools/make_loop.py IN.wav OUT.ogg`.
- `loops/` holds chosen loops. `take2-loop.ogg` (2:32, 84 bars, ~132.5 BPM) is the current main theme; `take2-loop-long.ogg` (3:18, 110 bars) is a longer alternative; `take2-loop-seam-test.ogg` plays the loop's wrap point for checking.
- `auditions/` holds trial renders and is git-ignored until a take is chosen.

Section variants for crossfading in the game must share the main theme's tempo and bar grid. Cover-mode renders so far did not keep the tempo, so variants will need a higher `reference_scale` and time-stretching to the theme's tempo before they are aligned and looped.
