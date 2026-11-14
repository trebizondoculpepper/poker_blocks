import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import type { PrepassReference } from "./appearance-prepass";

/** A stub block appearance declaring a prepass (#970): no material is promoted. */
const declared: { prepasses?: PrepassReference[] } = {};
vi.mock("./block-appearance", async (original) => {
  const actual = await original<typeof import("./block-appearance")>();
  return {
    ...actual,
    createBlockAppearance: () => ({
      geometry: new THREE.BoxGeometry(),
      textures: [],
      materials: [new THREE.MeshStandardMaterial()],
      edgeColor: 0xffffff,
      edgeOpacity: 1,
      ...declared,
    }),
  };
});

describe("a material token's prepasses (#970)", () => {
  it("carries its block appearance's declared prepasses, for the rack or shop that shows it", async () => {
    await import("./material-token");
    const { passiveVisualBuilders } = await import("../passive-visual");
    declared.prepasses = [{ handler: "stub-rear", config: { size: 1 } }];
    const token = passiveVisualBuilders.get("materialBlock")({} as never, 1, { material: "wood" });
    expect(token.prepasses).toEqual([{ handler: "stub-rear", config: { size: 1 } }]);
    token.dispose();
    declared.prepasses = undefined;
    const plain = passiveVisualBuilders.get("materialBlock")({} as never, 1, { material: "wood" });
    expect(plain.prepasses).toEqual([]);
    plain.dispose();
  });
});
