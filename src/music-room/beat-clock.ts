/**
 * A shared beat clock whose tempo can glide linearly, like a tape machine changing speed.
 * Every playing loop follows it, so their beats stay aligned through a tempo change.
 *
 * The clock is a list of segments; within a segment the tempo moves linearly from
 * `from` to `to` BPM over `seconds`, then holds. Beat position is the integral of tempo.
 */
export type BeatClock = {
  beatAt(time: number): number;
  timeOfBeat(beat: number): number;
  tempoAt(time: number): number;
  /** Glide from the tempo at `at` to `to` BPM over `seconds`. */
  ramp(at: number, seconds: number, to: number): void;
};

type Segment = { start: number; beat: number; from: number; to: number; seconds: number };

export function createBeatClock(start: number, tempo: number): BeatClock {
  const segments: Segment[] = [{ start, beat: 0, from: tempo, to: tempo, seconds: 0 }];

  const segmentAt = (time: number): Segment => {
    for (let i = segments.length - 1; i >= 0; i--)
      if (time >= segments[i].start) return segments[i];
    return segments[0];
  };

  const tempoIn = (segment: Segment, elapsed: number): number =>
    elapsed >= segment.seconds || segment.seconds === 0
      ? segment.to
      : segment.from + ((segment.to - segment.from) * elapsed) / segment.seconds;

  /** Beats elapsed within a segment after `elapsed` seconds. */
  const beatsIn = (segment: Segment, elapsed: number): number => {
    const ramping = Math.min(elapsed, segment.seconds);
    const rampBeats = (ramping * (segment.from + tempoIn(segment, ramping))) / 2 / 60;
    return rampBeats + (Math.max(0, elapsed - segment.seconds) * segment.to) / 60;
  };

  const beatAt = (time: number): number => {
    const segment = segmentAt(time);
    return segment.beat + beatsIn(segment, time - segment.start);
  };

  return {
    beatAt,
    tempoAt(time) {
      const segment = segmentAt(time);
      return tempoIn(segment, time - segment.start);
    },
    timeOfBeat(beat) {
      // Find the segment holding this beat, then solve within it (search is exact enough).
      let segment = segments[0];
      for (const candidate of segments) if (candidate.beat <= beat) segment = candidate;
      let lo = 0;
      let hi = 1;
      while (beatsIn(segment, hi) < beat - segment.beat) hi *= 2;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (beatsIn(segment, mid) < beat - segment.beat) lo = mid;
        else hi = mid;
      }
      return segment.start + hi;
    },
    ramp(at, seconds, to) {
      const from = this.tempoAt(at);
      const beat = beatAt(at);
      while (segments.length > 1 && segments[segments.length - 1].start >= at) segments.pop();
      segments.push({ start: at, beat, from, to, seconds: Math.max(0, seconds) });
    },
  };
}
