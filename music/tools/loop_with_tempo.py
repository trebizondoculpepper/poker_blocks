"""Cut a loop from a track at its own natural tempo and record that tempo.

Usage: uv run --with librosa --with soundfile python loop_with_tempo.py IN OUT.ogg [--min-seconds 90]

Versions of the theme do not have to share a tempo: when the game switches between
them it ramps playback speed, like a tape machine, from one tempo to the other. So each
loop is left unstretched, and its sidecar JSON records `tempo_bpm` measured the same
way for every version (onset autocorrelation, see match_variant.precise_tempo).
"""
import json, pathlib, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from match_variant import coarse_tempo, precise_tempo  # noqa: E402

source, out = sys.argv[1], pathlib.Path(sys.argv[2])
extra = sys.argv[3:]
with tempfile.TemporaryDirectory() as tmp:
    wav = pathlib.Path(tmp) / "source.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", source, str(wav)], check=True)
    subprocess.run([sys.executable, str(HERE / "make_loop.py"), str(wav), str(out), *extra], check=True, stdout=subprocess.DEVNULL)
    # Measure on the finished loop so the recorded tempo is the loop's own.
    loop_wav = pathlib.Path(tmp) / "loop.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(out), str(loop_wav)], check=True)
    info = json.loads(out.with_suffix(".json").read_text())
    tempo = precise_tempo(loop_wav, coarse_tempo(loop_wav))
# A seamless loop holds a whole number of bars. Snap the beat count to whole bars and
# derive the tempo from it, so a beat clock stays aligned across every wrap.
beats = 4 * round(info["loop_seconds"] * tempo / 60 / 4)
info.update(
    source=pathlib.Path(source).name,
    beat_tracker_bpm=info.pop("tempo_bpm"),
    measured_tempo_bpm=round(tempo, 2),
    beats=beats,
    bars=beats // 4,
    tempo_bpm=round(beats * 60 / info["loop_seconds"], 4),
)
out.with_suffix(".json").write_text(json.dumps(info, indent=2) + "\n")
print(f"{out.stem}: {info['tempo_bpm']:.2f} BPM ({beats} beats), {info['loop_seconds']}s, {info['bars']} bars, match {info['match_score']}")
