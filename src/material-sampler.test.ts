import { describe, expect, it } from "vite-plus/test";
import { sampleMaterials } from "./material-sampler";
import {
  blockMaterials,
  getMaterialDefinition,
  makeDevDeck,
  materialDefinitions,
  materialOf,
} from "./materials";
import { cellKey, faceNormal, faces } from "./traits/attachable";

describe("the dev1 materials sampler", () => {
  for (const seed of [1, 2, 3, 99]) {
    it(`places one block of each material in a connected structure (seed ${seed})`, () => {
      let n = seed;
      const random = () => (n = (n * 16807) % 2147483647) / 2147483647;
      const deck = makeDevDeck(seed);
      const { field, deck: rest } = sampleMaterials(deck, random);
      expect(field.map(({ block }) => materialOf(block)).sort()).toEqual(
        [...blockMaterials].sort(),
      );
      const keys = new Set(field.map(({ cell }) => cellKey(cell)));
      expect(keys.size).toBe(field.length);
      expect(field[0].cell).toEqual({ x: 0, y: 0, z: 0 });
      for (const { cell } of field.slice(1)) {
        const touching = faces.some((face) => {
          const o = faceNormal(face);
          return keys.has(cellKey({ x: cell.x + o.x, y: cell.y + o.y, z: cell.z + o.z }));
        });
        expect(touching).toBe(true);
      }
      expect(rest).toHaveLength(deck.length - field.length);
      expect(field.every(({ block }) => block.traits.selectable === undefined)).toBe(true);
    });
  }
});

describe("the transparent trait", () => {
  it("marks exactly the see-through materials", async () => {
    const { needsLandingHandover } = await import("./block-trait-behaviours");
    for (const card of makeDevDeck(7)) {
      expect(needsLandingHandover(card)).toBe(
        getMaterialDefinition(materialOf(card)).traits.transparent !== undefined,
      );
    }
    expect(
      materialDefinitions
        .filter(({ traits }) => "transparent" in traits)
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["fire", "ice", "prismatic"]);
  });
});
