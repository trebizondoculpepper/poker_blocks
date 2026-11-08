"""Make a style variant loop that shares the main theme's tempo and bar grid.

Usage:
    uv run --with librosa --with soundfile python match_variant.py \
        MAIN_LOOP.json VARIANT_AUDIO OUT.ogg [--min-seconds 90]

1. Beat trackers often lock onto half, double or 3/4 time, so take a coarse reading
   and pick the multiple (x0.5, x0.75, x1, x4/3, x2) nearest the main theme's tempo.
2. Measure that tempo precisely, and the main loop's the same way, by onset
   autocorrelation at an 8-beat lag.
3. Time-stretch (pitch preserved, ffmpeg atempo) to exactly the main tempo.
4. Cut a bar-aligned loop with a crossfaded wrap (make_loop.py).

The game can then crossfade between any two variants at a bar line and stay in time.
"""
import argparse
import json
import pathlib
import subprocess
import sys
import tempfile

import librosa
import numpy as np

HERE = pathlib.Path(__file__).parent


def precise_tempo(path: pathlib.Path, near: float) -> float:
    """Tempo from the onset envelope's autocorrelation at an 8-beat lag, interpolated.

    A long lag gives sub-percent precision; `near` picks which multiple to look for.
    The opening and ending sixths are ignored.
    """
    sr, hop, beats = 22050, 64, 8
    y, _ = librosa.load(path, sr=sr, mono=True)
    y = y[len(y) // 6 : len(y) - len(y) // 6]
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset = onset - onset.mean()
    ac = np.correlate(onset, onset, "full")[len(onset) - 1 :]
    fps = sr / hop
    lag0 = beats * 60 / near * fps
    lo, hi = int(lag0 * 0.9), int(lag0 * 1.1)
    k = lo + int(np.argmax(ac[lo:hi]))
    a, b, c = ac[k - 1], ac[k], ac[k + 1]
    k = k + 0.5 * (a - c) / (a - 2 * b + c)
    return float(beats * 60 * fps / k)


def coarse_tempo(path: pathlib.Path) -> float:
    y, sr = librosa.load(path, sr=22050, mono=True)
    return float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=sr)[0])[0])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("main_loop_json")
    parser.add_argument("variant")
    parser.add_argument("output")
    parser.add_argument("--min-seconds", type=float, default=90)
    args = parser.parse_args()

    main_info = json.loads(pathlib.Path(args.main_loop_json).read_text())
    main_audio = pathlib.Path(args.main_loop_json).with_suffix(".ogg")
    out = pathlib.Path(args.output)

    with tempfile.TemporaryDirectory() as tmp:
        main_wav = pathlib.Path(tmp) / "main.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(main_audio), str(main_wav)], check=True)
        # Measure the main loop and the variant the same way, so method bias cancels.
        target = precise_tempo(main_wav, float(main_info["tempo_bpm"]))
        source = pathlib.Path(tmp) / "source.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", args.variant, str(source)], check=True)
        coarse = coarse_tempo(source)
        reading = min((coarse * k for k in (0.5, 0.75, 1, 4 / 3, 2)), key=lambda bpm: abs(bpm - target))
        measured = precise_tempo(source, reading)
        factor = target / measured
        stretched = pathlib.Path(tmp) / "stretched.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-filter:a", f"atempo={factor:.6f}", str(stretched)],
            check=True,
        )
        check = precise_tempo(stretched, target)
        subprocess.run(
            [sys.executable, str(HERE / "make_loop.py"), str(stretched), str(out), "--min-seconds", str(args.min_seconds)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
    info = json.loads(out.with_suffix(".json").read_text())
    info.update(
        source=pathlib.Path(args.variant).name,
        coarse_bpm=round(coarse, 2),
        measured_bpm=round(measured, 2),
        stretch_factor=round(factor, 4),
        tempo_after_stretch=round(check, 2),
        target_bpm=round(target, 2),
    )
    out.with_suffix(".json").write_text(json.dumps(info, indent=2) + "\n")
    print(
        f"{out.stem}: coarse {coarse:.1f}, measured {measured:.2f}, stretch x{factor:.4f}, "
        f"now {check:.2f} (target {target:.2f}); loop {info['loop_seconds']}s, {info['bars']} bars, match {info['match_score']}"
    )


if __name__ == "__main__":
    main()
