import { describe, expect, it } from "vite-plus/test";
import { scenarioVersion, type ScenarioDefinition } from "../dev-scenario";
import "../trial-modifiers";
import {
  editedScenario,
  editProblems,
  parameterControls,
  passiveSettings,
  scenarioPassives,
} from "./dev-bench-panel";

const scenario: ScenarioDefinition = {
  version: scenarioVersion,
  seed: 3,
  steps: [
    { capability: "devDeck", config: { steps: [{ operation: "standardTemplates", config: {} }] } },
    {
      capability: "devPassives",
      config: {
        passives: [
          { definitionId: "trial-dense-packing" },
          { definitionId: "trial-heavy-mean-mass", overrides: { coefficient: 2 } },
        ],
      },
    },
  ],
};

describe("bench panel settings (#903)", () => {
  it("lists the scenario's installed passives in order", () => {
    expect(scenarioPassives(scenario).map(({ definitionId }) => definitionId)).toEqual([
      "trial-dense-packing",
      "trial-heavy-mean-mass",
    ]);
  });

  it("derives controls from each passive's own schema, with declared and edited values", () => {
    const [dense, heavy] = scenarioPassives(scenario);
    const denseSettings = passiveSettings(dense!, { maximum: 4 });
    expect(denseSettings.map(({ name }) => name)).toEqual(["maximum", "start"]);
    expect(denseSettings.find(({ name }) => name === "maximum")!.value).toBe(4);
    const coefficient = passiveSettings(heavy!, {}).find(({ name }) => name === "coefficient")!;
    expect(coefficient.value).toBe(2);
    expect(parameterControls.has(coefficient.schema.kind)).toBe(true);
  });

  it("shows an invalid pending edit without failing, so it can be corrected", () => {
    const [dense] = scenarioPassives(scenario);
    const maximum = passiveSettings(dense!, { maximum: 999 }).find(
      ({ name }) => name === "maximum",
    )!;
    expect(maximum.value).toBe(999);
  });

  it("validates edits with the shared validators", () => {
    expect(editProblems(scenario, [{ maximum: 4 }, {}])).toEqual([]);
    expect(editProblems(scenario, [{ maximum: 999 }, {}])).toEqual([
      expect.stringMatching(/maximum/),
    ]);
    expect(editProblems(scenario, [{}, { nope: 1 }])).toEqual([
      expect.stringMatching(/unknown parameter/),
    ]);
  });

  it("applies edits and a seed to a copy, keeping the original definition", () => {
    const before = JSON.stringify(scenario);
    const edited = editedScenario(scenario, [{ maximum: 4 }, { aggregate: "totalKg" }], 77);
    expect(edited.seed).toBe(77);
    expect(scenarioPassives(edited)).toEqual([
      { definitionId: "trial-dense-packing", overrides: { maximum: 4 } },
      {
        definitionId: "trial-heavy-mean-mass",
        overrides: { coefficient: 2, aggregate: "totalKg" },
      },
    ]);
    expect(JSON.stringify(scenario)).toBe(before);
  });
});
