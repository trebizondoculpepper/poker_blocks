import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { getMaterialDefinition, type MaterialDefinition } from "../../materials";
import { standardDeck } from "../../cards";
import { blockEffects } from "../../visual/block-effects";

const extraMaps: { own: THREE.Texture; shared: THREE.Texture } = {
  own: new THREE.Texture(),
  shared: Object.assign(new THREE.Texture(), { userData: { shared: true } }),
};

vi.mock("../../visual/block-appearance", () => ({
  createBlockAppearance: () => ({
    extras: [
      new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ map: extraMaps.own })),
      new THREE.Points(undefined, new THREE.PointsMaterial({ map: extraMaps.shared })),
    ],
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

describe("freeing a profiled block (#653 review)", () => {
  it("frees its own extra textures but leaves a shared one for its other users", async () => {
    const { tableBlock } = await import("./block-object");
    let own = 0;
    let shared = 0;
    extraMaps.own.addEventListener("dispose", () => void own++);
    extraMaps.shared.addEventListener("dispose", () => void shared++);
    tableBlock(standardDeck[0]!, getMaterialDefinition("paper")).dispose();
    expect(own).toBe(1);
    expect(shared).toBe(0);
  });
});

describe("every module-level shared texture is marked (#653 review)", () => {
  it("marks the bubble, facet and crystal environment textures (canvas-free ones testable here)", async () => {
    const { bubbleTexture } = await import("../../visual/rising-bubbles");
    const { facetTexture } = await import("../../visual/approximate-crystal");
    const { crystalV3Environment } = await import("../../visual/crystal-v3");
    for (const texture of [bubbleTexture(), facetTexture(), crystalV3Environment()])
      expect(texture.userData.shared).toBe(true);
  });
});
