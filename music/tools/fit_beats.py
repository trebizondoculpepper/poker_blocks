"""Fit an exact beat grid to a seamless loop and record its tempo and downbeat.

Usage: uv run --with librosa --with soundfile python fit_beats.py LOOP.ogg [LOOP.ogg ...]
       [--write] [--prefer 125] [--near BPM]

A seamless loop holds a whole number of bars, so its tempo must be one of
N * 60 / loop_seconds for N a multiple of 4. For every such N between 60 and 240 BPM,
slide a beat grid across the loop's onset envelope (a measure of note attacks over time)
and score how well the grid lands on attacks, with a gentle preference for tempos near
`--prefer`. The best grid gives the tempo and the time of the first beat.

The downbeat is the beat of the bar (1 to 4) whose grid points carry the most
low-frequency attack energy (kick and bass), and `first_beat_seconds` is moved to it.

With --write, the sidecar JSON gets `beats`, `bars`, `tempo_bpm` and
`first_beat_seconds`; the music room starts each loop's beat 1 at that offset.
"""
import argparse
import json
import pathlib
import subprocess
import tempfile

import librosa
import numpy as np


def envelope(y: np.ndarray, sr: int, hop: int, low: bool) -> np.ndarray:
    if low:
        spectrum = np.abs(librosa.stft(y, hop_length=hop))
        freqs = librosa.fft_frequencies(sr=sr)
        return librosa.onset.onset_strength(S=librosa.amplitude_to_db(spectrum[freqs < 200]), sr=sr, hop_length=hop)
    return librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)


def grid_score(onset: np.ndarray, fps: float, period: float, phase: float, length: float) -> float:
    times = np.arange(phase, length, period)
    frames = np.clip(np.round(times * fps).astype(int), 0, len(onset) - 1)
    # Take the local maximum within +/-2 frames, to tolerate small timing jitter.
    near = np.max([onset[np.clip(frames + d, 0, len(onset) - 1)] for d in range(-2, 3)], axis=0)
    return float(near.mean())


def fit(path: pathlib.Path, prefer: float, near: float | None = None) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / "a.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", "22050", str(wav)], check=True)
        y, sr = librosa.load(wav, sr=None)
    hop = 128
    fps = sr / hop
    length = len(y) / sr
    onset = envelope(y, sr, hop, low=False)
    onset = (onset - onset.mean()) / (onset.std() + 1e-9)
    low = envelope(y, sr, hop, low=True)
    low = (low - low.mean()) / (low.std() + 1e-9)

    candidates = []
    for beats in range(4, 400, 4):
        bpm = beats * 60 / length
        if not 60 <= bpm <= 240:
            continue
        period = length / beats
        phases = np.arange(0, period, 1 / fps)
        scores = [grid_score(onset, fps, period, phase, length) for phase in phases]
        best = int(np.argmax(scores))
        prior = np.exp(-0.5 * (np.log2(bpm / prefer) / 0.5) ** 2)
        candidates.append((scores[best] * (0.5 + 0.5 * prior), scores[best], beats, bpm, float(phases[best])))
    candidates.sort(reverse=True)
    if near is not None:
        # The listener knows the tempo: take the candidate closest to it.
        candidates.sort(key=lambda c: abs(c[3] - near))
    _, raw, beats, bpm, phase = candidates[0]
    period = length / beats

    # Downbeat: the beat-of-bar with the strongest low-frequency attacks.
    bar_scores = [grid_score(low, fps, period * 4, phase + k * period, length) for k in range(4)]
    downbeat = int(np.argmax(bar_scores))
    first_beat = (phase + downbeat * period) % (period * 4)
    return {
        "beats": beats,
        "bars": beats // 4,
        "tempo_bpm": round(bpm, 4),
        "first_beat_seconds": round(first_beat, 4),
        "grid_score": round(raw, 3),
        "runner_up": [(round(c[3], 1), round(c[1], 3)) for c in candidates[1:4]],
        "downbeat_scores": [round(s, 3) for s in bar_scores],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("loops", nargs="+")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--prefer", type=float, default=125)
    parser.add_argument("--near", type=float, help="use the grid nearest this BPM")
    args = parser.parse_args()
    for name in args.loops:
        path = pathlib.Path(name)
        sidecar = path.with_suffix(".json")
        info = json.loads(sidecar.read_text())
        result = fit(path, args.prefer, args.near)
        print(
            f"{path.stem:34s} was {info.get('tempo_bpm', 0):7.2f} BPM, now {result['tempo_bpm']:7.2f} "
            f"({result['bars']} bars), first beat {result['first_beat_seconds']:.3f}s, "
            f"score {result['grid_score']}, next {result['runner_up']}"
        )
        if args.write:
            info.update({k: result[k] for k in ("beats", "bars", "tempo_bpm", "first_beat_seconds")})
            sidecar.write_text(json.dumps(info, indent=2) + "\n")


if __name__ == "__main__":
    main()
