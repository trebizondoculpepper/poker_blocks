import { readFileSync } from "node:fs";
import type * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { Dancer } from "../dance/dance-floor";
import type { Cell } from "../traits/attachable";
import {
  firstPlayPrompt,
  type FirstPlayPromptConfig,
  type FirstPlayTable,
} from "./first-play-prompt";

const origin: Cell = { x: 0, y: 0, z: 0 };
const config: FirstPlayPromptConfig = {
  colour: 0x65f4dd,
  glow: 0.8,
  armed: { beatSeconds: 0.5, scale: [1.04, 1.09], opacity: [0.3, 0.42] },
  release: { seconds: 0.5, growth: 0.6 },
};

/** A table whose state the test sets, recording what the trait puts on it. */
function table() {
  const state = {
    cell: origin as Cell | null,
    count: 0,
    candidate: null as Cell | null,
    busy: false,
    still: false,
  };
  const shown = new Set<THREE.Object3D>();
  // A dance floor the test drives by hand: it records who joined and moves them on demand.
  const dancers = new Set<Dancer>();
  const firstPlay: FirstPlayTable = {
    firstPlayCell: () => state.cell,
    fieldCount: () => state.count,
    candidateCell: () => state.candidate,
    busy: () => state.busy,
    reducedMotion: () => state.still,
    placeObject: (object) => void shown.add(object),
    removeObject: (object) => void shown.delete(object),
    cubeSize: 2.4,
    danceFloor: {
      join(dancer) {
        dancers.add(dancer);
        return () => dancers.delete(dancer);
      },
    },
  };
  const dance = (phase: number, energy: number) =>
    dancers.forEach((dancer) => dancer.dance({ phase, energy, tempo: 120 }));
  return { state, shown, dancers, dance, context: { services: { firstPlay } } };
}

const meshes = (shown: Set<THREE.Object3D>) => [...shown] as THREE.Mesh[];
const opacity = (mesh: THREE.Mesh) => (mesh.material as THREE.MeshBasicMaterial).opacity;

describe("first-play prompt trait (#203)", () => {
  it("pulses in the first play's cell while idle, and hides while something else is going on", () => {
    const behaviour = firstPlayPrompt();
    const { state, shown, context } = table();
    behaviour.enter!(context, config);
    behaviour.update!(context, config, 0.1);
    expect(shown.size).toBe(1);
    state.busy = true;
    behaviour.update!(context, config, 0.1);
    expect(shown.size).toBe(0);
    state.busy = false;
    state.cell = null;
    behaviour.update!(context, config, 0.1);
    expect(shown.size).toBe(0);
  });

  it("arms while a dragged block is over its cell: larger and brighter (only brighter when still)", () => {
    const behaviour = firstPlayPrompt();
    const { state, shown, context } = table();
    behaviour.enter!(context, config);
    state.busy = true;
    state.candidate = { ...origin };
    behaviour.update!(context, config, 0.1);
    const [ghost] = meshes(shown);
    expect(ghost!.scale.x).toBeGreaterThanOrEqual(1.04);
    expect(opacity(ghost!)).toBeGreaterThanOrEqual(0.3);
    state.still = true;
    behaviour.update!(context, config, 0.1);
    expect(ghost!.scale.x).toBe(1);
  });

  it("answers the first play with an outline that grows, fades and is removed", () => {
    const behaviour = firstPlayPrompt();
    const { state, shown, context } = table();
    behaviour.enter!(context, config);
    behaviour.update!(context, config, 0.1);
    // The block is played: the field has one block and there is no first play to invite.
    state.count = 1;
    state.cell = null;
    behaviour.update!(context, config, 0.1);
    const [burst] = meshes(shown);
    expect(burst).toBeDefined();
    behaviour.update!(context, config, 0.15);
    expect(burst!.scale.x).toBeGreaterThan(1);
    expect(opacity(burst!)).toBeLessThan(0.42);
    behaviour.update!(context, config, 1);
    expect(shown.size).toBe(0);
  });

  it("plays no release when the field was never empty while it was shown", () => {
    const behaviour = firstPlayPrompt();
    const { state, shown, context } = table();
    state.count = 3;
    state.cell = null;
    behaviour.enter!(context, config);
    state.count = 4;
    behaviour.update!(context, config, 0.1);
    expect(shown.size).toBe(0);
  });

  it("takes everything it placed away when its scene leaves", () => {
    const behaviour = firstPlayPrompt();
    const { state, shown, context } = table();
    behaviour.enter!(context, config);
    behaviour.update!(context, config, 0.1);
    state.count = 1;
    state.cell = null;
    behaviour.update!(context, config, 0.05);
    behaviour.exit!(context, config);
    expect(shown.size).toBe(0);
  });

  it("dances: grows through its cycle and drops back to base size at the start (#256)", () => {
    const behaviour = firstPlayPrompt();
    const { shown, dancers, dance, context } = table();
    const dancing = { ...config, dance: { cycle: "bar", shape: "saw", offset: 0, swell: 0.12 } };
    behaviour.enter!(context, dancing);
    expect([...dancers].map(({ cycle, offset }) => [cycle, offset])).toEqual([["bar", 0]]);
    behaviour.update!(context, dancing, 0.016);
    const [ghost] = meshes(shown);
    const glow = opacity(ghost!);
    // Halfway through the bar, then just before the downbeat: steadily larger.
    dance(0.5, 1);
    behaviour.update!(context, dancing, 0.016);
    expect(ghost!.scale.x).toBeCloseTo(1.06);
    dance(0.99, 1);
    behaviour.update!(context, dancing, 0.016);
    expect(ghost!.scale.x).toBeCloseTo(1.1188);
    // On the downbeat: back to its base size at once.
    dance(0, 1);
    behaviour.update!(context, dancing, 0.016);
    expect(ghost!.scale.x).toBe(1);
    // The dance moves only its size: the glow stays steady.
    expect(opacity(ghost!)).toBeCloseTo(glow, 1);
    // With no music (energy 0) it never grows.
    dance(0.9, 0);
    behaviour.update!(context, dancing, 0.016);
    expect(ghost!.scale.x).toBe(1);
    behaviour.exit!(context, dancing);
    expect(dancers.size).toBe(0);
  });

  it("pulses in a windowed sine on the beat and rests flat between beats", () => {
    const behaviour = firstPlayPrompt();
    const { shown, dance, context } = table();
    const pulsing = {
      ...config,
      dance: { cycle: "beat", shape: "sine", offset: 0, swell: 0.12, window: 0.4 },
    };
    behaviour.enter!(context, pulsing);
    behaviour.update!(context, pulsing, 0.016);
    const [ghost] = meshes(shown);
    const scaleAt = (phase: number) => {
      dance(phase, 1);
      behaviour.update!(context, pulsing, 0.016);
      return ghost!.scale.x;
    };
    // Peaks on the beat, eases either side within the window, and is flat outside it.
    expect(scaleAt(0)).toBeCloseTo(1.12);
    expect(scaleAt(0.1)).toBeCloseTo(1.06);
    expect(scaleAt(0.9)).toBeCloseTo(1.06);
    expect(scaleAt(0.3)).toBeCloseTo(1);
    expect(scaleAt(0.5)).toBeCloseTo(1);
    behaviour.exit!(context, pulsing);
  });

  it("glows steadily while idle: no pulse and no flash, music or not", () => {
    const behaviour = firstPlayPrompt();
    const { shown, dance, context } = table();
    const dancing = { ...config, dance: { cycle: "bar", shape: "saw", offset: 0, swell: 0.12 } };
    behaviour.enter!(context, dancing);
    behaviour.update!(context, dancing, 0.016);
    const [ghost] = meshes(shown);
    const glows = [];
    for (const [phase, energy, seconds] of [
      [0, 1, 0.3],
      [0.5, 1, 0.7],
      [0.9, 0, 1.1],
    ] as const) {
      dance(phase, energy);
      behaviour.update!(context, dancing, seconds);
      glows.push(opacity(ghost!));
    }
    expect(glows).toEqual([0.18 * 0.8, 0.18 * 0.8, 0.18 * 0.8]);
    behaviour.exit!(context, dancing);
  });

  it("doesn't dance when its configuration has no dance", () => {
    const behaviour = firstPlayPrompt();
    const { dancers, context } = table();
    behaviour.enter!(context, config);
    expect(dancers.size).toBe(0);
  });

  it("guardrail: the ghost's behaviour lives only in this trait", () => {
    for (const file of ["../field-view.ts", "../game-run-controller.ts", "../main.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/showPrompt|promptEntered|promptFirstPlay|pulseSeconds/);
    }
  });
});
