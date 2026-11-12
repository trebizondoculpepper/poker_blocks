import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { getMaterialDefinition, type MaterialDefinition } from "../../materials";
import { standardDeck } from "../../cards";
import { blockEffects } from "../../visual/block-effects";

vi.mock("../../visual/block-appearance", () => ({
  createBlockAppearance: () => ({
    geometry: new THREE.BoxGeometry(1, 1, 1),
    textures: [],
    materials: [new THREE.MeshStandardMaterial()],
    edgeColor: 0,
    edgeOpacity: 1,
  }),
}));

describe("a profiled table block includes its look's ongoing effects (#653 review)", () => {
  it("adds them beside the block, advances them every frame and frees them", async () => {
    const { tableBlock } = await import("./block-object");
    const updates: number[] = [];
    let disposed = 0;
    const emitted = new THREE.Object3D();
    blockEffects.register("profilerTestPuff", () => ({
      object: emitted,
      update: (delta) => void updates.push(delta),
      dispose: () => void disposed++,
    }));
    const base = getMaterialDefinition("paper");
    const definition: MaterialDefinition = {
      ...base,
      appearance: { ...base.appearance, effects: [{ effect: "profilerTestPuff" }] },
    };
    const block = tableBlock(standardDeck[0]!, definition);
    const scene = new THREE.Scene();
    scene.add(block.object);
    block.update?.(0.016);
    block.update?.(0.016);
    expect(emitted.parent).toBe(scene);
    expect(updates).toEqual([0.016, 0.016]);
    block.dispose();
    expect(emitted.parent).toBeNull();
    expect(disposed).toBe(1);
  });
});
