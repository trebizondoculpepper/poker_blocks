"""Cut a seamless, bar-aligned loop out of a generated track.

Usage:
    uv run --with librosa --with soundfile python make_loop.py IN.wav OUT.ogg \
        [--min-seconds 150] [--crossfade 0.05] [--beats-per-bar 4]

How it works:
1. Track beats; group them into bars (every `beats-per-bar` beats).
2. For every pair of bar starts (start, end) at least `min-seconds` apart, score how
   alike the music is just after `start` and just after `end` (chroma + MFCC over one
   bar). The best-matching pair gives the loop: playing past `end` would have sounded
   like going back to `start` anyway.
3. Render audio[start:end], crossfading the last `crossfade` seconds with the audio just
   before `start`, so the wrap from the end back to the start is continuous.
4. Write Ogg (Opus, 160 kbps) and a JSON sidecar with tempo, bar count and loop points.
"""
import argparse
import json
import pathlib
import subprocess
import tempfile

import librosa
import numpy as np
import soundfile as sf


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--min-seconds", type=float, default=150)
    parser.add_argument("--crossfade", type=float, default=0.05)
    parser.add_argument("--beats-per-bar", type=int, default=4)
    parser.add_argument("--skip-seconds", type=float, default=4.0, help="ignore the opening")
    args = parser.parse_args()

    audio, rate = sf.read(args.source, always_2d=True)  # (samples, channels)
    mono = audio.mean(axis=1)
    hop = 512
    tempo, beats = librosa.beat.beat_track(y=mono, sr=rate, hop_length=hop, units="frames")
    tempo = float(np.atleast_1d(tempo)[0])
    beat_samples = librosa.frames_to_samples(beats, hop_length=hop)

    # Choose the bar phase (which beat is "one") with the strongest onsets on downbeats.
    onset = librosa.onset.onset_strength(y=mono, sr=rate, hop_length=hop)
    phase = max(
        range(args.beats_per_bar),
        key=lambda p: onset[beats[p :: args.beats_per_bar]].mean(),
    )
    bars = beat_samples[phase :: args.beats_per_bar]
    bars = bars[bars > args.skip_seconds * rate]

    chroma = librosa.feature.chroma_cqt(y=mono, sr=rate, hop_length=hop)
    mfcc = librosa.feature.mfcc(y=mono, sr=rate, hop_length=hop, n_mfcc=20)
    frames = min(chroma.shape[1], mfcc.shape[1])
    features = np.vstack([chroma[:, :frames], librosa.util.normalize(mfcc[:, :frames], axis=1)])
    bar_frames = int(round(args.beats_per_bar * 60 / tempo * rate / hop))

    def window(sample: int) -> np.ndarray:
        frame = sample // hop
        return features[:, frame : frame + bar_frames]

    best = None
    for i, start in enumerate(bars):
        a = window(start)
        if a.shape[1] < bar_frames:
            break
        for end in bars[i + 1 :]:
            if (end - start) / rate < args.min_seconds:
                continue
            b = window(end)
            if b.shape[1] < bar_frames:
                break
            score = float(np.mean(np.sum(a * b, axis=0) / (np.linalg.norm(a, axis=0) * np.linalg.norm(b, axis=0) + 1e-9)))
            # Prefer longer loops slightly when matches are close.
            score += 0.0005 * (end - start) / rate
            if best is None or score > best[0]:
                best = (score, int(start), int(end))
    if best is None:
        raise SystemExit("No loop found: try a smaller --min-seconds")
    score, start, end = best

    fade = int(args.crossfade * rate)
    if start < fade:
        raise SystemExit("Loop starts too early for the crossfade")
    loop = audio[start:end].copy()
    ramp = np.linspace(0.0, 1.0, fade)[:, None]
    # Fade the loop's tail out while fading in the audio that leads into `start`, so
    # the sample after the last one is, in effect, the first one.
    loop[-fade:] = loop[-fade:] * (1 - ramp) + audio[start - fade : start] * ramp

    out = pathlib.Path(args.output)
    # Opus in an Ogg container (Treblo's own default). libsndfile's Ogg writer crashes on
    # long files and Homebrew ffmpeg has no libvorbis, so encode a WAV with libopus.
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / "loop.wav"
        sf.write(wav, np.clip(loop, -1, 1), rate, subtype="PCM_24")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
             "-c:a", "libopus", "-b:a", "160k", str(out)],
            check=True,
        )
    bars_in_loop = int(round((end - start) / rate / (args.beats_per_bar * 60 / tempo)))
    info = {
        "source": pathlib.Path(args.source).name,
        "tempo_bpm": round(tempo, 2),
        "beats_per_bar": args.beats_per_bar,
        "loop_start_seconds": round(start / rate, 4),
        "loop_end_seconds": round(end / rate, 4),
        "loop_seconds": round((end - start) / rate, 4),
        "bars": bars_in_loop,
        "match_score": round(score, 4),
        "crossfade_seconds": args.crossfade,
        "sample_rate": rate,
    }
    out.with_suffix(".json").write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps(info, indent=2))


if __name__ == "__main__":
    main()
