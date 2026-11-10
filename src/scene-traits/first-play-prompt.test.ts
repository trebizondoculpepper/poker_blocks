import { readFileSync } from "node:fs";
import type * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import type { Cell } from "../traits/attachable";
import {
  firstPlayPrompt,
  type FirstPlayPromptConfig,
  type FirstPlayTable,
} from "./first-play-prompt";

const origin: Cell = { x: 0, y: 0, z: 0 };
const config: FirstPlayPromptConfig = {
  colour: 0x65f4dd,
  pulseSeconds: 1.8,
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
  const firstPlay: FirstPlayTable = {
    firstPlayCell: () => state.cell,
    fieldCount: () => state.count,
    candidateCell: () => state.candidate,
    busy: () => state.busy,
    reducedMotion: () => state.still,
    placeObject: (object) => void shown.add(object),
    removeObject: (object) => void shown.delete(object),
    cubeSize: 2.4,
  };
  return { state, shown, context: { services: { firstPlay } } };
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

  it("guardrail: the ghost's behaviour lives only in this trait", () => {
    for (const file of ["../field-view.ts", "../run-controller.ts", "../main.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/showPrompt|promptEntered|promptFirstPlay|pulseSeconds/);
    }
  });
});
