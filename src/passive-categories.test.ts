import { describe, expect, it } from "vite-plus/test";
import { soundEffects } from "./audio/sfx-registry";
import {
  blendColours,
  categoryPalette,
  categoryTraitsOf,
  scoringTints,
  passiveCategoryFacet,
  passiveCategoryTraitNames,
} from "./passive-categories";
import { createPassiveBlock, passiveDefinitions, passivePalette } from "./passives";

/** Gameplay rule evaluation: none of it may read a category trait (#81). */
const gameplaySources = import.meta.glob<string>(
  [
    "./event-rules.ts",
    "./passive-effects.ts",
    "./scoring.ts",
    "./game-run.ts",
    "./stage-rewards.ts",
    "./round.ts",
    "./dealer.ts",
    "./block-trait-behaviours.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

describe("the passive category facet", () => {
  it.each(passiveDefinitions.names())("%s composes exactly one category trait", (id) => {
    const definition = passiveDefinitions.get(id);
    expect(categoryTraitsOf(definition.categoryTrait)).toHaveLength(1);
    // The block carries the same one trait, and nothing else from the facet.
    expect(categoryTraitsOf(createPassiveBlock(id, "p.1").traits)).toEqual(
      categoryTraitsOf(definition.categoryTrait),
    );
  });

  it("shows its category's colours, with no per-passive palette (#81)", () => {
    for (const id of passiveDefinitions.names()) {
      expect(passiveDefinitions.get(id).palette, id).toBeUndefined();
    }
    expect(passivePalette(passiveDefinitions.get("scrapper"))).toEqual(
      passiveCategoryFacet.economyCategory.palette,
    );
  });

  it("tints a scoring passive by its operation, blending combined operations", () => {
    expect(passivePalette(passiveDefinitions.get("woodworker")).edge).toBe(scoringTints.additive);
    expect(passivePalette(passiveDefinitions.get("double-line")).edge).toBe(
      scoringTints.multiplicative,
    );
    // Porcelain stays the base for every scoring passive.
    expect(passivePalette(passiveDefinitions.get("double-line")).face).toBe(
      passiveCategoryFacet.scoringCategory.palette.face,
    );
    const both = categoryPalette({ scoringCategory: { operations: ["additive", "exponential"] } });
    expect(both.edge).toBe(blendColours([scoringTints.additive, scoringTints.exponential]));
    expect(blendColours(["#000000", "#ffffff"])).toBe("#808080");
  });

  it("gives every category a registered activation sound and a visual", () => {
    const ids = new Set(soundEffects.map(({ id }) => id));
    for (const { activation } of Object.values(passiveCategoryFacet)) {
      expect(ids.has(activation.sfx)).toBe(true);
      expect(activation.visual.length).toBeGreaterThan(0);
    }
  });

  it("refuses a passive with no category trait", () => {
    const definition = { ...passiveDefinitions.get("double-line"), palette: undefined };
    expect(() => passivePalette({ ...definition, categoryTrait: {} })).toThrow();
  });

  it("is never read by gameplay rule evaluation", () => {
    expect(Object.keys(gameplaySources).length).toBeGreaterThan(0);
    for (const [file, text] of Object.entries(gameplaySources)) {
      for (const name of [...passiveCategoryTraitNames, "scoringTints", "categoryPalette"])
        expect(text, file).not.toContain(name);
    }
  });
});
