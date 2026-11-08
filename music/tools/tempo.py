"""Estimate a track's tempo several ways, to catch half-, double- and 3/4-time misreads.

Usage: uv run --with librosa --with soundfile python tempo.py FILE [FILE...]
Prints: default beat-tracker tempo, tempo with a 132.5 BPM prior, and the top
autocorrelation tempogram peaks.
"""
import subprocess, sys, tempfile, pathlib
import librosa, numpy as np

for path in sys.argv[1:]:
    with tempfile.TemporaryDirectory() as tmp:
        wav = pathlib.Path(tmp) / "a.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "22050", str(wav)], check=True)
        y, sr = librosa.load(wav, sr=None, duration=150)
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    t_default = float(np.atleast_1d(librosa.beat.beat_track(onset_envelope=onset, sr=sr)[0])[0])
    t_prior = float(np.atleast_1d(librosa.beat.beat_track(onset_envelope=onset, sr=sr, start_bpm=132.5)[0])[0])
    gram = librosa.feature.tempogram(onset_envelope=onset, sr=sr).mean(axis=1)
    bpms = librosa.tempo_frequencies(len(gram), sr=sr)
    ok = (bpms > 60) & (bpms < 200)
    peaks = [i for i in range(1, len(gram) - 1) if ok[i] and gram[i] > gram[i - 1] and gram[i] > gram[i + 1]]
    top = sorted(peaks, key=lambda i: -gram[i])[:3]
    print(f"{pathlib.Path(path).stem:34s} default {t_default:6.1f}  prior132 {t_prior:6.1f}  peaks " +
          ", ".join(f"{bpms[i]:.1f}" for i in top))
