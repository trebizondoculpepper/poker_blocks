import { describe, expect, it } from "vite-plus/test";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { buildScenario, scenarioVersion, type ScenarioDefinition } from "./dev-scenario";
import {
  copyConfiguration,
  experimentConfigVersion,
  exportConfiguration,
  importConfiguration,
  serializeConfiguration,
} from "./experiment-config";
import type { RunRules } from "./run-rules";
import "./trial-modifiers";

const dealers = new Registry<Dealer>("dealer");
dealers.register(baseDealer.name, baseDealer);
const rules: RunRules = {
  stage: (round) => ({ dealer: "base", targetScore: 100 * round, plays: 3, discards: 2 }),
  handAtStageEnd: "return-to-deck",
  discardPileAfterShop: "keep-out",
  rackCapacity: 4,
  // A function on the rules never reaches the export.
  stockShop: (state) => state,
};
const runtime = { dealers, rules };

const scenario: ScenarioDefinition = {
  version: scenarioVersion,
  seed: 42,
  steps: [
    { capability: "devDeck", config: { steps: [{ operation: "standardTemplates", config: {} }] } },
    { capability: "devHand", config: { indices: [0, 1, 2, 3, 4] } },
    {
      capability: "devPassives",
      config: {
        passives: [
          {
            definitionId: "trial-dense-packing",
            overrides: { maximum: 6 },
          },
        ],
      },
    },
  ],
};

describe("experiment configuration export (#934)", () => {
  it("round-trips to an equivalent configuration that builds the same trial", () => {
    const config = exportConfiguration(scenario, rules, "1.2.3");
    const text = serializeConfiguration(config);
    const imported = importConfiguration(text, runtime);
    expect(imported).toEqual({ ok: true, config });
    const original = buildScenario(scenario, runtime);
    const restored = buildScenario(imported.ok ? imported.config.scenario : scenario, runtime);
    expect(original.ok && restored.ok).toBe(true);
    if (original.ok && restored.ok)
      expect(JSON.stringify(restored.trial.initialSnapshot)).toBe(
        JSON.stringify(original.trial.initialSnapshot),
      );
  });

  it("records the effective rules as plain data, without functions or secrets", () => {
    const config = exportConfiguration(scenario, rules, "1.2.3");
    expect(config.rules.stages[0]).toMatchObject({ round: 1, setup: { targetScore: 100 } });
    expect(config.rules.rackCapacity).toBe(4);
    expect(config.rules).not.toHaveProperty("stockShop");
    expect(JSON.parse(serializeConfiguration(config))).toEqual(config);
    expect(serializeConfiguration(config)).not.toMatch(/=>|function|key|token/i);
  });

  it("rejects bad input without building anything", () => {
    const good = exportConfiguration(scenario, rules, "1.2.3");
    const as = (value: unknown) => importConfiguration(JSON.stringify(value), runtime);
    expect(importConfiguration("{", runtime)).toMatchObject({ ok: false });
    expect(as({ ...good, format: "other" })).toMatchObject({ ok: false });
    expect(as({ ...good, version: experimentConfigVersion + 1 })).toMatchObject({
      diagnostics: [`unsupported configuration version ${experimentConfigVersion + 1}`],
    });
    expect(as({ ...good, revision: undefined })).toMatchObject({ ok: false });
    expect(
      as({ ...good, scenario: { ...scenario, steps: [{ capability: "nope", config: {} }] } }),
    ).toMatchObject({ ok: false, diagnostics: ['unknown scenario capability "nope"'] });
  });

  it("refuses a configuration made under different rules", () => {
    const other: RunRules = { ...rules, rackCapacity: 5 };
    const text = serializeConfiguration(exportConfiguration(scenario, other, "1.2.3"));
    expect(importConfiguration(text, runtime)).toEqual({
      ok: false,
      diagnostics: ["its rules differ from this mode's at rules.rackCapacity"],
    });
  });

  it("copies the serialized configuration", async () => {
    const config = exportConfiguration(scenario, rules, "1.2.3");
    let copied = "";
    await copyConfiguration(config, { writeText: async (text) => void (copied = text) });
    expect(copied).toBe(serializeConfiguration(config));
  });
});
