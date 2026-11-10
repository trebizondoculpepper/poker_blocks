import { describe, expect, it } from "vite-plus/test";
import { createBeatClock } from "./beat-clock";
import { createBeatSignal } from "./beat-signal";
import type { MusicPosition } from "./music-player";

/** A fake music source: a beat clock read at a time the test moves. */
function music(tempo = 120) {
  const clock = createBeatClock(0, tempo);
  const state = { time: 0, playing: true, beatsPerBar: 4 };
  const read = (): MusicPosition | null =>
    state.playing
      ? {
          beat: clock.beatAt(state.time),
          beatsPerBar: state.beatsPerBar,
          tempo: clock.tempoAt(state.time),
        }
      : null;
  return { clock, state, read };
}

/** Advance the fake time and the signal together, in frames of `frame` seconds. */
function run(
  signal: ReturnType<typeof createBeatSignal>,
  state: { time: number },
  seconds: number,
  frame = 1 / 60,
) {
  for (let t = 0; t < seconds - 1e-9; t += frame) {
    state.time += frame;
    signal.update(frame);
  }
}

describe("beat signal (#255)", () => {
  it("gives the beat and bar phase from the music's position", () => {
    const { state, read } = music(120);
    const signal = createBeatSignal(read);
    run(signal, state, 1.25);
    const position = signal.position()!;
    // 120 BPM: 2 beats a second, so 1.25 s is beat 2.5, in bar 0.
    expect(position.beat).toBeCloseTo(2.5, 1);
    expect(position.beatPhase).toBeCloseTo(0.5, 1);
    expect(position.bar).toBe(0);
    expect(position.barPhase).toBeCloseTo(2.5 / 4, 1);
    expect(position.tempo).toBeCloseTo(120);
  });

  it("fires one beat event per beat and one bar event per bar", () => {
    const { state, read } = music(120);
    const signal = createBeatSignal(read);
    const beats: number[] = [];
    const bars: number[] = [];
    signal.on("beat", (beat) => beats.push(beat));
    signal.on("bar", (bar) => bars.push(bar));
    run(signal, state, 4.1);
    expect(beats).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bars).toEqual([1, 2]);
  });

  it("stays continuous through a tempo ramp, with no beat skipped or repeated", () => {
    const { clock, state, read } = music(120);
    clock.ramp(1, 2, 180);
    const signal = createBeatSignal(read);
    const beats: number[] = [];
    signal.on("beat", (beat) => beats.push(beat));
    let previous = 0;
    for (let i = 0; i < 300; i++) {
      state.time += 1 / 60;
      signal.update(1 / 60);
      const beat = signal.position()!.beat;
      expect(beat).toBeGreaterThanOrEqual(previous);
      previous = beat;
    }
    expect(beats).toEqual(Array.from({ length: beats.length }, (_, i) => i + 1));
    expect(signal.position()!.tempo).toBeCloseTo(180, 0);
  });

  it("fires once for a long frame, never a burst", () => {
    const { state, read } = music(120);
    const signal = createBeatSignal(read);
    const beats: number[] = [];
    signal.on("beat", (beat) => beats.push(beat));
    run(signal, state, 0.1);
    state.time += 1.6;
    signal.update(1.6);
    expect(beats).toEqual([3]);
  });

  it("uses the track's bar length", () => {
    const { state, read } = music(120);
    state.beatsPerBar = 3;
    const signal = createBeatSignal(read);
    const bars: number[] = [];
    signal.on("bar", (bar) => bars.push(bar));
    run(signal, state, 3.1);
    expect(bars).toEqual([1, 2]);
    expect(signal.position()!.barPhase).toBeCloseTo((6.2 % 3) / 3, 1);
  });

  it("eases energy up while music plays and down when it stops, then has no position", () => {
    const { state, read } = music(120);
    const signal = createBeatSignal(read);
    run(signal, state, 0.1);
    const rising = signal.position()!.energy;
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(1);
    run(signal, state, 3);
    expect(signal.position()!.energy).toBe(1);
    state.playing = false;
    run(signal, state, 0.1);
    expect(signal.position()!.energy).toBeLessThan(1);
    run(signal, state, 4);
    expect(signal.position()).toBeNull();
  });

  it("has no position before any music, and unsubscribes", () => {
    const { state, read } = music(120);
    state.playing = false;
    const signal = createBeatSignal(read);
    signal.update(1 / 60);
    expect(signal.position()).toBeNull();
    state.playing = true;
    const beats: number[] = [];
    const off = signal.on("beat", (beat) => beats.push(beat));
    run(signal, state, 0.6);
    off();
    run(signal, state, 1);
    expect(beats).toEqual([1]);
  });
});
