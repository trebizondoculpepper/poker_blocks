import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "./cards";
import type { PrepassReference } from "./visual/appearance-prepass";

/**
 * A stub appearance that declares a prepass (#969): no material is promoted, the real block views
 * mount it, and the test sees what they require of their host.
 */
const declared: { prepasses?: PrepassReference[] } = {};
vi.mock("./visual/block-appearance", async (original) => {
  const actual = await original<typeof import("./visual/block-appearance")>();
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

async function views() {
  const { createBlockViews } = await import("./rendered-blocks");
  const log: string[] = [];
  const prepasses = {
    require(references: readonly PrepassReference[]) {
      log.push(`require ${references.map(({ handler }) => handler).join()}`);
      return () => void log.push(`release ${references.map(({ handler }) => handler).join()}`);
    },
  };
  const parents = { board: new THREE.Group(), hand: new THREE.Group() };
  return { blocks: createBlockViews(parents, prepasses), log };
}

describe("block views and their appearances' prepasses (#969)", () => {
  it("requires a mounted block's declared prepasses from its host, and lets go on dispose", async () => {
    declared.prepasses = [{ handler: "stub-rear", config: { size: 1 } }];
    const { blocks, log } = await views();
    const shown = blocks.create(standardDeck[0]!, 1, "board");
    expect(log).toEqual(["require stub-rear"]);
    blocks.dispose(shown);
    expect(log).toEqual(["require stub-rear", "release stub-rear"]);
  });

  it("requires nothing for an appearance that declares none, and lets go of everything at once", async () => {
    declared.prepasses = undefined;
    const { blocks, log } = await views();
    blocks.create(standardDeck[0]!, 1, "hand");
    expect(log).toEqual([]);
    declared.prepasses = [{ handler: "stub-rear" }];
    blocks.create(standardDeck[1]!, 1, "hand");
    blocks.create(standardDeck[2]!, 1, "board");
    blocks.disposeAll();
    expect(log).toEqual([
      "require stub-rear",
      "require stub-rear",
      "release stub-rear",
      "release stub-rear",
    ]);
  });
});
