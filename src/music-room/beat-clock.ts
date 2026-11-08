import { easeInOutCubic } from "../easing";

/**
 * A shared beat clock whose tempo can change with an ease-in-out curve, like a tape
 * machine changing speed. Every playing loop follows it, so their beats stay aligned
 * through a tempo change.
 *
 * The clock is a list of segments. Within a segment the tempo eases from `from` to `to`
 * BPM over `seconds` (easeInOutCubic), then holds. Beat position is the exact integral of
 * tempo over time, so beats stay put however the tempo moves.
 */
export type BeatClock = {
  beatAt(time: number): number;
  timeOfBeat(beat: number): number;
  tempoAt(time: number): number;
  /** Ease from the tempo at `at` to `to` BPM over `seconds` (0 = jump, then hold). */
  ramp(at: number, seconds: number, to: number): void;
  /** From `at`, count from `beat` at a steady `tempo` (re-anchors the clock). */
  rebase(at: number, beat: number, tempo: number): void;
};

type Segment = { start: number; beat: number; from: number; to: number; seconds: number };

/** Integral of easeInOutCubic from 0 to p (p in 0..1); equals 0.5 at p = 1. */
export function easedArea(p: number): number {
  return p < 0.5 ? p ** 4 : p + (2 - 2 * p) ** 4 / 16 - 0.5;
}

export function createBeatClock(start: number, tempo: number): BeatClock {
  const segments: Segment[] = [{ start, beat: 0, from: tempo, to: tempo, seconds: 0 }];

  const segmentAt = (time: number): Segment => {
    for (let i = segments.length - 1; i >= 0; i--)
      if (time >= segments[i].start) return segments[i];
    return segments[0];
  };

  const tempoIn = (segment: Segment, elapsed: number): number =>
    segment.seconds === 0 || elapsed >= segment.seconds
      ? segment.to
      : segment.from +
        (segment.to - segment.from) * easeInOutCubic(Math.max(0, elapsed) / segment.seconds);

  /** Beats elapsed within a segment after `elapsed` seconds. */
  const beatsIn = (segment: Segment, elapsed: number): number => {
    const easing = Math.min(Math.max(0, elapsed), segment.seconds);
    const easedBeats =
      segment.seconds === 0
        ? 0
        : (segment.from * easing +
            (segment.to - segment.from) * segment.seconds * easedArea(easing / segment.seconds)) /
          60;
    return easedBeats + (Math.max(0, elapsed - segment.seconds) * segment.to) / 60;
  };

  const beatAt = (time: number): number => {
    const segment = segmentAt(time);
    return segment.beat + beatsIn(segment, time - segment.start);
  };

  const tempoAt = (time: number): number => {
    const segment = segmentAt(time);
    return tempoIn(segment, time - segment.start);
  };

  return {
    beatAt,
    tempoAt,
    timeOfBeat(beat) {
      // Find the segment holding this beat, then solve within it by bisection.
      let segment = segments[0];
      for (const candidate of segments) if (candidate.beat <= beat) segment = candidate;
      const target = beat - segment.beat;
      let lo = 0;
      let hi = 1;
      while (beatsIn(segment, hi) < target) hi *= 2;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (beatsIn(segment, mid) < target) lo = mid;
        else hi = mid;
      }
      return segment.start + hi;
    },
    rebase(at, beat, tempo) {
      while (segments.length > 1 && segments[segments.length - 1].start >= at) segments.pop();
      segments.push({ start: at, beat, from: tempo, to: tempo, seconds: 0 });
    },
    ramp(at, seconds, to) {
      const from = tempoAt(at);
      const beat = beatAt(at);
      while (segments.length > 1 && segments[segments.length - 1].start >= at) segments.pop();
      segments.push({ start: at, beat, from, to, seconds: Math.max(0, seconds) });
    },
  };
}
