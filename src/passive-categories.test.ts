import { describe, expect, it } from "vite-plus/test";
import {
  categoryTraitsOf,
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

  it("supplies the default colours unless a passive overrides them", () => {
    const definition = passiveDefinitions.get("double-line");
    const plain = { ...definition, palette: undefined };
    expect(passivePalette(plain)).toEqual(passiveCategoryFacet.scoringCategory.palette);
    expect(passivePalette(definition)).toEqual(definition.palette);
  });

  it("refuses a passive with no category trait", () => {
    const definition = { ...passiveDefinitions.get("double-line"), palette: undefined };
    expect(() => passivePalette({ ...definition, categoryTrait: {} })).toThrow();
  });

  it("is never read by gameplay rule evaluation", () => {
    expect(Object.keys(gameplaySources).length).toBeGreaterThan(0);
    for (const [file, text] of Object.entries(gameplaySources)) {
      for (const name of passiveCategoryTraitNames) expect(text, file).not.toContain(name);
    }
  });
});
