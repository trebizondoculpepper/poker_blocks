import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { BeatPosition, BeatSignal } from "../audio/beat-signal";
import { beatShapes } from "./beat-shapes";
import { createDanceFloor, type DanceMove } from "./dance-floor";

function signal(position: Partial<BeatPosition> | null): BeatSignal {
  const full: BeatPosition | null = position
    ? {
        beat: 0,
        beatPhase: 0,
        bar: 0,
        barPhase: 0,
        beatsPerBar: 4,
        tempo: 120,
        energy: 1,
        ...position,
      }
    : null;
  return { position: () => full, on: () => () => {}, update: () => {} };
}

describe("dance floor (#256)", () => {
  it("gives each dancer its phase through its own cycle, with its offset", () => {
    const floor = createDanceFloor(signal({ beat: 6.5 }), () => false);
    const moves: Record<string, DanceMove> = {};
    for (const cycle of ["halfBeat", "beat", "bar", "twoBars", "fourBars"])
      floor.join({ cycle, dance: (move) => (moves[cycle] = move) });
    let early: DanceMove | undefined;
    floor.join({ cycle: "beat", offset: -0.25, dance: (move) => (early = move) });
    floor.update();
    expect(moves.halfBeat!.phase).toBeCloseTo(0);
    expect(moves.beat!.phase).toBeCloseTo(0.5);
    expect(moves.bar!.phase).toBeCloseTo(6.5 / 4 - 1);
    expect(moves.twoBars!.phase).toBeCloseTo(6.5 / 8);
    expect(moves.fourBars!.phase).toBeCloseTo(6.5 / 16);
    expect(early!.phase).toBeCloseTo(0.25);
    expect(moves.beat!.energy).toBe(1);
  });

  it("stills every dancer with no music or with reduced motion", () => {
    for (const [beat, reduced] of [
      [signal(null), false],
      [signal({ beat: 1.5 }), true],
    ] as const) {
      const floor = createDanceFloor(beat, () => reduced);
      let move: DanceMove | undefined;
      floor.join({ cycle: "beat", dance: (next) => (move = next) });
      floor.update();
      expect(move!.energy).toBe(0);
    }
  });

  it("lets a dancer leave, and refuses an unknown cycle", () => {
    const floor = createDanceFloor(signal({ beat: 1 }), () => false);
    let calls = 0;
    const leave = floor.join({ cycle: "beat", dance: () => calls++ });
    floor.update();
    leave();
    floor.update();
    expect(calls).toBe(1);
    expect(() => floor.join({ cycle: "polka", dance: () => {} })).toThrow();
  });

  it("shapes: every shape stays within 0 to 1; sine and bounce join up across the cycle", () => {
    for (const name of beatShapes.names()) {
      const shape = beatShapes.get(name);
      for (let phase = 0; phase < 1; phase += 0.01) {
        expect(shape(phase)).toBeGreaterThanOrEqual(0);
        expect(shape(phase)).toBeLessThanOrEqual(1);
      }
    }
    for (const name of ["sine", "bounce"])
      expect(beatShapes.get(name)(0)).toBeCloseTo(beatShapes.get(name)(0.9999), 2);
    expect(beatShapes.get("pulse")(0)).toBe(1);
    expect(beatShapes.get("bounce")(0.5)).toBeCloseTo(1);
    // The sawtooth climbs steadily and is back at 0 on the cycle's start.
    expect(beatShapes.get("saw")(0)).toBe(0);
    expect(beatShapes.get("saw")(0.5)).toBe(0.5);
  });

  it("guardrail: the floor and shapes never name a dancer", () => {
    for (const file of ["./dance-floor.ts", "./beat-shapes.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/ghost|prompt|passive|block|material/i);
    }
  });
});
