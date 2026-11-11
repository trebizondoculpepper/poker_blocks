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

### Beat data audit (#257)

Every loop's sidecar records `beats`, `bars`, `tempo_bpm` and `first_beat_seconds`, so beat 1 lands on a real downbeat; `src/audio/music-sidecars.test.ts` checks every loop has them. They were fitted offline with `music/tools/fit_beats.py` (librosa, via `uv run --with librosa --with soundfile`): it slides whole-bar beat grids across each loop's onset envelope and puts beat 1 on the beat with the most kick and bass energy. The game never analyses audio.

Fifteen loops had a clear fit and only gained their beat offset. For the ten where the fit preferred a different pulse, the owner asked for reasonable defaults, to audition and adjust later. The rule used: keep the current tempo when the alternative is about three-quarters of it (a swing or triplet feel), since it is already a normal dance pulse and changing it would also change the tape-style glide between tracks; halve a tempo that is in double time. Each of these keeps a `review` entry (the **Suspect** badge) naming the alternative, until it is checked by ear.

| Loop                       | Before (BPM) | After (BPM)                    | First beat (s) | Alternative |
| -------------------------- | ------------ | ------------------------------ | -------------- | ----------- |
| blaxploitation-horns       | 194.9        | **97.5** (halved: double time) | 0.099          | 194.9       |
| stripped-sleaze            | 129.2        | 129.2                          | 1.173          | 96.9        |
| style-ambient-lounge       | 127.4        | 127.4                          | 0.750          | 94.9        |
| style-circus-band          | 131.9        | 131.9                          | 1.812          | 98.3        |
| style-mariachi             | 132.0        | 132.0                          | 0.950          | 99.0        |
| style-noir                 | 129.6        | 129.6                          | 1.482          | 96.7        |
| style-psychedelic-freakout | 148.7        | 148.7                          | 1.022          | 112.2       |
| style-snes-16bit           | 139.4        | 139.4                          | 0.692          | 99.9        |
| style-spaghetti-western    | 125.3        | 125.3                          | 0.377          | 106.7       |
| take2                      | 131.4        | 131.4                          | 1.509          | 98.2        |

To retune one: `uv run --with librosa --with soundfile python music/tools/fit_beats.py music/loops/<loop>.ogg --near <BPM> --write`, then remove its `review` entry once it sounds right.

If the beat tracker reads a track at half time (as with big-band, about 69 BPM), double its `beats` and `tempo_bpm` in the sidecar, so tape-style tempo glides stay small.

## In the game

`src/audio/music-player.ts` plays these loops in the game with the same switching as the room (on the bar, beat-matched, logarithmic crossfade, then an eased tempo change). `src/audio/music-plan.ts` decides what plays where:

- **Title screen:** blaxploitation-horns or stripped-sleaze, at random.
- **Settings:** style-ambient-lounge, reserved for this screen.
- **Boss stages:** solitaire-boss, reserved for bosses.
- **Other stages:** a random loop from everything else, avoiding an immediate repeat.

Music starts on the player's first click or key press (browsers block audio before that) and follows the settings' volume and mute.
