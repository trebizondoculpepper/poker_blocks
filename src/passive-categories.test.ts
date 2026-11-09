import { describe, expect, it } from "vite-plus/test";
import { passiveCategories } from "./passive-categories";
import { createPassiveBlock, passiveDefinitions, passivePalette } from "./passives";

/** Gameplay rule evaluation: none of it may read a passive's category (#81). */
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

describe("passive categories", () => {
  it("gives every passive one primary category that has defaults", () => {
    for (const id of passiveDefinitions.names()) {
      expect(passiveCategories).toHaveProperty(passiveDefinitions.get(id).category);
    }
  });

  it("supplies the default colours unless a passive overrides them", () => {
    const definition = passiveDefinitions.get("double-line");
    const plain = { ...definition, palette: undefined };
    expect(passivePalette(plain)).toEqual(passiveCategories.scoring.palette);
    expect(passivePalette(definition)).toEqual(definition.palette);
    expect(createPassiveBlock("double-line", "p.1").traits.appearance?.palette).toEqual(
      definition.palette,
    );
  });

  it("is never read by gameplay rule evaluation", () => {
    expect(Object.keys(gameplaySources).length).toBeGreaterThan(0);
    for (const [file, text] of Object.entries(gameplaySources)) {
      expect(text.match(/\bcategor(y|ies)\b/gi), file).toBeNull();
    }
  });

  it("does not reach the passive's runtime traits", () => {
    const block = createPassiveBlock("scrapper", "p.2");
    expect(JSON.stringify(block.traits)).not.toMatch(/categor/i);
  });
});
