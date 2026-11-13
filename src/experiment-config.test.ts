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
  // A function on the rules never reaches the export: its plain descriptor does.
  stockShop: (state) => state,
  policies: { stockShop: { shop: { offers: 6 } } },
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
    const config = exportConfiguration(scenario, runtime, "1.2.3");
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
    const config = exportConfiguration(scenario, runtime, "1.2.3");
    expect(config.rules.stages[0]).toMatchObject({ round: 1, setup: { targetScore: 100 } });
    expect(config.rules.rackCapacity).toBe(4);
    expect(config.rules).not.toHaveProperty("stockShop");
    expect(JSON.parse(serializeConfiguration(config))).toEqual(config);
    expect(serializeConfiguration(config)).not.toMatch(/=>|function|key|token/i);
  });

  it("rejects bad input without building anything", () => {
    const good = exportConfiguration(scenario, runtime, "1.2.3");
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
    expect(as({ ...good, rules: { ...good.rules, horizon: 4294967296 } })).toMatchObject({
      ok: false,
      diagnostics: [expect.stringMatching(/round horizon from 1/)],
    });
    for (const unverifiable of [{}, 3, [1]])
      expect(as({ ...good, rules: { ...good.rules, unverifiable } })).toEqual({
        ok: false,
        diagnostics: ["rules.unverifiable must be a list of rule names"],
      });
  });

  it("records each passive's resolved settings, defaults included, and refuses a changed one", () => {
    const good = exportConfiguration(scenario, runtime, "1.2.3");
    const [dense] = good.generated.passives as {
      definitionId: string;
      settings: Record<string, unknown>;
    }[];
    expect(dense!.definitionId).toBe("trial-dense-packing");
    expect(dense!.settings.maximum).toBe(6);
    expect(Object.keys(dense!.settings).length).toBeGreaterThan(1);
    const changed = structuredClone(good);
    const [first] = changed.generated.passives as { settings: Record<string, unknown> }[];
    const name = Object.keys(first!.settings).find((key) => key !== "maximum")!;
    first!.settings[name] = "an older default";
    expect(importConfiguration(JSON.stringify(changed), runtime)).toMatchObject({
      ok: false,
      diagnostics: [expect.stringMatching(/generated\.passives\.0\.settings/)],
    });
  });

  it("refuses a configuration whose builders now generate different cards", () => {
    const good = exportConfiguration(scenario, runtime, "1.2.3");
    expect(good.generated.cards.length).toBeGreaterThan(0);
    const changed = structuredClone(good);
    (changed.generated.cards[0] as { material?: unknown }).material = { id: "elsewhere" };
    expect(importConfiguration(JSON.stringify(changed), runtime)).toMatchObject({
      ok: false,
      diagnostics: [
        expect.stringMatching(/^this build generates a different trial.*generated\.cards\.0/),
      ],
    });
    expect(
      importConfiguration(JSON.stringify({ ...good, generated: undefined }), runtime),
    ).toMatchObject({ ok: false });
  });

  it("refuses a configuration made under different base scoring", () => {
    const good = exportConfiguration(scenario, runtime, "1.2.3");
    const [hand] = Object.keys(good.rules.handMultipliers);
    const changed = structuredClone(good);
    changed.rules.handMultipliers[hand!] = 999;
    expect(importConfiguration(JSON.stringify(changed), runtime)).toEqual({
      ok: false,
      diagnostics: [`its rules differ from this mode's at rules.handMultipliers.${hand}`],
    });
  });

  it("refuses a configuration made under different rules", () => {
    const other: RunRules = { ...rules, rackCapacity: 5 };
    const text = serializeConfiguration(
      exportConfiguration(scenario, { dealers, rules: other }, "1.2.3"),
    );
    expect(importConfiguration(text, runtime)).toEqual({
      ok: false,
      diagnostics: ["its rules differ from this mode's at rules.rackCapacity"],
    });
  });

  it("compares function-valued policies through their descriptors, and refuses unverifiable ones", () => {
    const text = (other: RunRules) =>
      serializeConfiguration(exportConfiguration(scenario, { dealers, rules: other }, "1.2.3"));
    expect(
      importConfiguration(
        text({ ...rules, policies: { stockShop: { shop: { offers: 9 } } } }),
        runtime,
      ),
    ).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/policies\.stockShop/)] });
    expect(importConfiguration(text({ ...rules, policies: undefined }), runtime)).toEqual({
      ok: false,
      diagnostics: ["these rules can't be verified: stockShop"],
    });
    const resale: RunRules = { ...rules, resaleModifiers: [(value) => value] };
    expect(importConfiguration(text(resale), { dealers, rules: resale })).toEqual({
      ok: false,
      diagnostics: ["these rules can't be verified: resaleModifiers"],
    });
  });

  it("verifies rules up to its recorded horizon, past the default eight rounds", () => {
    const later: RunRules = {
      ...rules,
      stage: (round, kind) => ({ ...rules.stage(round, kind), plays: round > 8 ? 9 : 3 }),
    };
    const short = serializeConfiguration(
      exportConfiguration(scenario, { dealers, rules: later }, "1.2.3"),
    );
    expect(importConfiguration(short, runtime)).toMatchObject({ ok: true });
    const long = serializeConfiguration(
      exportConfiguration(scenario, { dealers, rules: later }, "1.2.3", 12),
    );
    expect(importConfiguration(long, runtime)).toMatchObject({ ok: false });
    expect(JSON.parse(long).rules.horizon).toBe(12);
  });

  it("copies the serialized configuration", async () => {
    const config = exportConfiguration(scenario, runtime, "1.2.3");
    let copied = "";
    await copyConfiguration(config, { writeText: async (text) => void (copied = text) });
    expect(copied).toBe(serializeConfiguration(config));
  });
});
