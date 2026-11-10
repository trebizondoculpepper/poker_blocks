/**
 * The beat signal (#255): where the music is, as a continuous phase that anything can follow,
 * plus beat and bar events for one-off reactions. Presentation only: rules and scoring never
 * see it.
 *
 * Each frame it reads the music's position (from each loop's registered tempo and beat offset,
 * via the shared beat clock; nothing analyses audio) and derives:
 * - `beat`: continuous beats since the first downbeat;
 * - `beatPhase`: 0 to 1 through the current beat; `barPhase`: 0 to 1 through the current bar;
 * - `bar`: whole bars since the first downbeat;
 * - `tempo`: BPM now;
 * - `energy`: 0 to 1, easing up while music plays and down when it stops, so movement driven by
 *   the beat settles instead of freezing. Muted music keeps its energy: its clock still runs.
 *
 * Events fire when a frame crosses a beat or a bar line, once per frame however many it
 * crossed (a long frame never fires a burst). A listener is told the beat or bar it reached.
 */
import type { MusicPosition } from "./music-player";

export type BeatPosition = {
  beat: number;
  beatPhase: number;
  bar: number;
  barPhase: number;
  beatsPerBar: number;
  tempo: number;
  energy: number;
};

export type BeatEvent = "beat" | "bar";

export type BeatSignal = {
  /** The latest position, or null when no music has played (or it has fully settled). */
  position(): BeatPosition | null;
  /** Call `listener` each time the music reaches a beat or a bar line; returns an unsubscribe. */
  on(event: BeatEvent, listener: (count: number) => void): () => void;
  /** Read the music and advance by one frame of `seconds`. */
  update(seconds: number): void;
};

/** Seconds for energy to rise or fall most of the way (an exponential time constant). */
const energySeconds = 0.35;

export function createBeatSignal(read: () => MusicPosition | null): BeatSignal {
  const listeners: Record<BeatEvent, Set<(count: number) => void>> = {
    beat: new Set(),
    bar: new Set(),
  };
  let latest: Omit<BeatPosition, "energy"> | null = null;
  let energy = 0;

  const emit = (event: BeatEvent, count: number) =>
    [...listeners[event]].forEach((listener) => listener(count));

  return {
    position() {
      if (!latest || energy <= 0) return null;
      return { ...latest, energy };
    },
    on(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    update(seconds) {
      const now = read();
      const target = now ? 1 : 0;
      energy += (target - energy) * (1 - Math.exp(-Math.max(0, seconds) / energySeconds));
      if (Math.abs(energy - target) < 0.001) energy = target;
      if (!now) return;
      const { beat, beatsPerBar, tempo } = now;
      const bar = Math.floor(beat / beatsPerBar);
      // Only a forward step crosses a line; a track change re-anchors without firing.
      if (latest && beat > latest.beat && beat - latest.beat < beatsPerBar * 2) {
        if (Math.floor(beat) > Math.floor(latest.beat)) emit("beat", Math.floor(beat));
        if (bar > latest.bar) emit("bar", bar);
      }
      const phase = (value: number) => value - Math.floor(value);
      latest = {
        beat,
        beatPhase: phase(beat),
        bar,
        barPhase: phase(beat / beatsPerBar),
        beatsPerBar,
        tempo,
      };
    },
  };
}
