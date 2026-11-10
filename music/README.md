# Music

Background music is generated with the [Treblo](https://treblo.com/developers/docs) API (formerly Sonauto), then cut into seamless loops and committed. Like the sound effects, nothing is generated at runtime.

- `tools/treblo.py` submits generation jobs from a JSON list, polls them and downloads the audio. It reads `TREBLO_API_KEY` from the environment or the git-ignored `.env`. Each v3 request costs 100 credits.
- `tools/make_loop.py` finds the best-matching pair of bar starts in a track, cuts a bar-aligned loop with a short crossfade at the wrap point, and writes Ogg (Opus, 160 kbps) plus a JSON sidecar with tempo, bar count and loop points. Run it with `uv run --with librosa --with soundfile python tools/make_loop.py IN.wav OUT.ogg`.
- `tools/loop_with_tempo.py` runs `make_loop.py`, measures the loop's tempo by onset autocorrelation, snaps it to a whole number of bars, and records `beats`, `bars` and the exact `tempo_bpm` in the sidecar. Every version is measured the same way.
- `tools/tempo.py` prints several tempo estimates for checking; `tools/match_variant.py` can time-stretch a version to a target tempo if that is ever needed.
- `loops/` holds chosen loops: `take2-loop` (main theme, 131.4 BPM, 83 bars), `stripped-sleaze-loop` (129.2 BPM, 64 bars) and `blaxploitation-horns-loop` (141.6 BPM, 77 bars). `take2-loop-seam-test.ogg` plays the main loop's wrap point.
- `loops/solitaire-*` are the seven earlier Solitaire arrangements (jazz-funk, electro-funk, boss, big-band, bluegrass, musical, chiptune), cut into seamless loops; their full recordings are kept in `sources/solitaire/`.
- `auditions/` holds trial renders and is git-ignored until a take is chosen.

## Switching between versions

Versions keep their own natural tempos. When the game switches, it glides the playback speed from one tempo to the other, like a tape machine, while crossfading. A shared beat clock drives both loops, so the incoming loop enters on the same beat of the bar and both stay locked through the glide. This needs each loop to hold a whole number of bars and start on a downbeat, which `loop_with_tempo.py` guarantees.

Audition loops and switches at `/music.html` on the dev server (`src/music-room/`): pick a track to start, pick another to crossfade. Options: crossfade length, switching on the next bar, and a beat click for checking alignment by ear. The crossfade is logarithmic: each track's level moves evenly in decibels between silence (-60 dB) and full, which sounds steadier than a linear fade.

A loop whose beat grid is in doubt carries a `review` entry in its sidecar: `{ "reason", "candidate_bpm", "issue" }`. The music room shows it as a **Suspect** badge with the tempo the offline beat fit prefers, and hovering shows the reason. Once its tempo is settled by ear (#257), the sidecar is rewritten and the `review` entry removed, so the badge goes.

If the beat tracker reads a track at half time (as with big-band, about 69 BPM), double its `beats` and `tempo_bpm` in the sidecar, so tape-style tempo glides stay small.

## In the game

`src/audio/music-player.ts` plays these loops in the game with the same switching as the room (on the bar, beat-matched, logarithmic crossfade, then an eased tempo change). `src/audio/music-plan.ts` decides what plays where:

- **Title screen:** blaxploitation-horns or stripped-sleaze, at random.
- **Settings:** style-ambient-lounge, reserved for this screen.
- **Boss stages:** solitaire-boss, reserved for bosses.
- **Other stages:** a random loop from everything else, avoiding an immediate repeat.

Music starts on the player's first click or key press (browsers block audio before that) and follows the settings' volume and mute.
