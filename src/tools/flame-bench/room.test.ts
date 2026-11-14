import { describe, expect, it } from "vite-plus/test";
import { gameModeFor } from "../../game-modes";
import { getMaterialDefinition, type BlockMaterial } from "../../materials";
import "../../visual/fire-core";
import { createEffectTuning } from "../../visual/tunable-effects";
import { materialPreset, tunedDefinition } from "./presets";

const benchConfig = () =>
  gameModeFor("dev21").scenes.find(({ id }) => id === "dev21/flame-bench")?.traits.devFlameBench;

describe("the Flame Bench (#1025)", () => {
  it("is a developer mode whose every preview has tunable contents", () => {
    const config = benchConfig();
    expect(config?.previews.length).toBeGreaterThanOrEqual(3);
    for (const id of config!.previews)
      expect(() =>
        createEffectTuning(materialPreset(getMaterialDefinition(id as BlockMaterial))),
      ).not.toThrow();
    expect(gameModeFor("dev21").traits.console).toEqual({ name: "dev21" });
  });

  it("starts each preview from its own material's contents, named by the material", () => {
    for (const id of benchConfig()!.previews) {
      const definition = getMaterialDefinition(id as BlockMaterial);
      const preset = materialPreset(definition);
      expect(preset.handle).toBe(definition.id);
      expect(preset.config).toEqual(definition.appearance.contents!.config);
    }
  });

  it("builds a tuned material without changing the shared definition", () => {
    const definition = getMaterialDefinition(benchConfig()!.previews[0] as BlockMaterial);
    const before = structuredClone(definition.appearance.contents);
    const tuning = createEffectTuning(materialPreset(definition));
    tuning.set("brightness", 2.5);
    const tuned = tunedDefinition(definition, tuning);
    expect((tuned.appearance.contents!.config as { brightness: number }).brightness).toBe(2.5);
    expect(tuned.appearance.container).toBe(definition.appearance.container);
    expect(definition.appearance.contents).toEqual(before);
  });

  it("refuses a material with no tunable contents", () => {
    expect(() => materialPreset(getMaterialDefinition("paper" as BlockMaterial))).toThrow(
      /no tunable contents/,
    );
  });
});
