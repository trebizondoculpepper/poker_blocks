/**
 * The dance floor (#256): things that move with the music join it as dancers. A dancer says
 * which cycle it follows and implements `dance`, which is called every frame with its phase
 * through that cycle and how present the music is. What dancing changes is the dancer's own
 * business: usually its appearance, sometimes more. The floor never asks what a dancer is.
 *
 * The phase comes from the beat signal (src/audio/beat-signal.ts), which follows each loop's
 * registered tempo and beat offset. With no music, or with reduced motion, `energy` is 0 and
 * a dancer should rest (each shape is scaled by energy, so most dancers do this for free).
 */
import type { BeatSignal } from "../audio/beat-signal";
import { Registry } from "../core/registry";

/** A cycle a dancer can follow, by its length in beats; a bar's length comes from the track. */
export const danceCycles = new Registry<(beatsPerBar: number) => number>("dance cycle");
danceCycles.register("halfBeat", () => 0.5);
danceCycles.register("beat", () => 1);
danceCycles.register("bar", (beatsPerBar) => beatsPerBar);
danceCycles.register("twoBars", (beatsPerBar) => beatsPerBar * 2);
danceCycles.register("fourBars", (beatsPerBar) => beatsPerBar * 4);

export type DanceMove = {
  /** 0 to 1 through the dancer's cycle, with its `offset` applied. */
  phase: number;
  /** 0 to 1: how present the music is (0 with no music, or with reduced motion). */
  energy: number;
  /** The music's tempo, for dancers whose moves depend on it. */
  tempo: number;
};

export type Dancer = {
  /** The cycle followed: a registered `danceCycles` name. */
  readonly cycle: string;
  /**
   * Beats to shift the cycle by. Negative peaks a little early, which reads as on the beat;
   * different offsets make a group ripple instead of moving together.
   */
  readonly offset?: number;
  dance(move: DanceMove): void;
};

export type DanceFloor = {
  /** Join the floor; returns a function that leaves it. */
  join(dancer: Dancer): () => void;
  /** Call every dancer once, after the beat signal has advanced this frame. */
  update(): void;
};

export function createDanceFloor(beat: BeatSignal, reducedMotion: () => boolean): DanceFloor {
  const dancers = new Set<Dancer>();
  return {
    join(dancer) {
      danceCycles.get(dancer.cycle);
      dancers.add(dancer);
      return () => dancers.delete(dancer);
    },
    update() {
      const position = beat.position();
      const energy = position && !reducedMotion() ? position.energy : 0;
      for (const dancer of dancers) {
        const length = danceCycles.get(dancer.cycle)(position?.beatsPerBar ?? 4);
        const at = ((position?.beat ?? 0) + (dancer.offset ?? 0)) / length;
        dancer.dance({ phase: at - Math.floor(at), energy, tempo: position?.tempo ?? 0 });
      }
    },
  };
}
