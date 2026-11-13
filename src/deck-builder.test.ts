import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { buildDeck, DeckBuilderError, normalisedWeights } from "./deck-builder";
import { makeDevDeck, makeUniformDeck, materialOf } from "./materials";

const ids = (cards: readonly { id: string }[]) => cards.map(({ id }) => id);
const materials = (cards: readonly Parameters<typeof materialOf>[0][]) => cards.map(materialOf);

describe("deck builders (#827)", () => {
  it("rebuilds exactly the decks the old balanced and uniform factories dealt", () => {
    for (const seed of [1, 42, 123456, 2 ** 31 - 2])
      for (const pool of ["gameplay", "registered"]) {
        const built = buildDeck(
          [{ operation: "standardTemplates" }, { operation: "assignBalanced", config: { pool } }],
          seed,
        );
        const old = makeDevDeck(seed, pool);
        expect(ids(built)).toEqual(ids(old));
        expect(materials(built)).toEqual(materials(old));
      }
    const uniform = buildDeck(
      [
        { operation: "standardTemplates" },
        { operation: "assignUniform", config: { material: "steel" } },
      ],
      9,
    );
    expect(materials(uniform)).toEqual(materials(makeUniformDeck("steel")));
  });

  it("samples weighted materials independently and reproducibly", () => {
    const steps = [
      { operation: "standardTemplates" },
      { operation: "standardTemplates" },
      { operation: "standardTemplates" },
      { operation: "standardTemplates" },
      {
        operation: "assignWeighted",
        config: {
          weights: [
            { material: "paper", weight: 70 },
            { material: "wood", weight: 15 },
            { material: "gold", weight: 5 },
            { material: "steel", weight: 5 },
            { material: "prismatic", weight: 5 },
          ],
        },
      },
    ];
    // Four template passes give duplicate IDs: rejected, never published.
    expect(() => buildDeck(steps, 7)).toThrow(/duplicate/);
    const one = [steps[0]!, steps[4]!];
    const deck = buildDeck(one, 7);
    expect(materials(deck)).toEqual(materials(buildDeck(one, 7)));
    const paper = materials(deck).filter((kind) => kind === "paper").length;
    expect(paper).toBeGreaterThan(25);
    expect(paper).toBeLessThan(48);
    expect(
      normalisedWeights([
        { material: "paper", weight: 3 },
        { material: "wood", weight: 1 },
      ]),
    ).toEqual([
      { material: "paper", share: 0.75 },
      { material: "wood", share: 0.25 },
    ]);
  });

  it("shuffles the same instances, and order of operations matters", () => {
    const shuffled = buildDeck([{ operation: "standardTemplates" }, { operation: "shuffle" }], 5);
    expect(new Set(shuffled)).toEqual(new Set(standardDeck));
    expect(ids(shuffled)).not.toEqual(ids(standardDeck));
    const assignThenShuffle = buildDeck(
      [
        { operation: "standardTemplates" },
        { operation: "assignBalanced", config: { pool: "gameplay" } },
        { operation: "shuffle" },
      ],
      5,
    );
    const shuffleThenAssign = buildDeck(
      [
        { operation: "standardTemplates" },
        { operation: "shuffle" },
        { operation: "assignBalanced", config: { pool: "gameplay" } },
      ],
      5,
    );
    expect(ids(assignThenShuffle)).not.toEqual(ids(shuffleThenAssign));
  });

  it("rejects unknown operations, bad weights and empty inputs", () => {
    expect(() => buildDeck([{ operation: "conjure" }], 1)).toThrow(DeckBuilderError);
    expect(() =>
      buildDeck([{ operation: "assignUniform", config: { material: "wood" } }], 1),
    ).toThrow(/needs cards/);
    const weighted = (weights: unknown) =>
      buildDeck(
        [{ operation: "standardTemplates" }, { operation: "assignWeighted", config: { weights } }],
        1,
      );
    expect(() => weighted([{ material: "wood", weight: -1 }])).toThrow(/nonnegative/);
    expect(() => weighted([{ material: "wood", weight: 0 }])).toThrow(/positive sum/);
    expect(() => weighted([{ material: "wood", weight: Number.NaN }])).toThrow(DeckBuilderError);
  });
});
