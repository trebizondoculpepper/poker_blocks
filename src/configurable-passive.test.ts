import { describe, expect, it } from "vite-plus/test";
import {
  clonePassiveConfiguration,
  configurePassive,
  effectiveSettings,
  passiveConfiguration,
  PassiveConfigurationError,
  resetPassiveConfiguration,
} from "./configurable-passive";
import { createPassiveBlock, passiveDefinitions } from "./passives";
import { rackTraitPersistence } from "./rack-trait-persistence";
import "./trial-modifiers";

const factorOf = (block: ReturnType<typeof createPassiveBlock>) =>
  block.traits.passive!.eventRules![0]!.effects[0]!.config as {
    value: string;
    params: Record<string, unknown>;
  };

describe("per-instance passive configuration (#876)", () => {
  it("builds an instance's rules from its overrides, leaving the definition and other copies alone", () => {
    const definition = passiveDefinitions.get("trial-dense-packing");
    const before = JSON.stringify(definition);
    const a = configurePassive(createPassiveBlock("trial-dense-packing", "a"), { maximum: 4 });
    const b = createPassiveBlock("trial-dense-packing", "b");
    expect(factorOf(a).params).toEqual({ maximum: 4, start: 0.7 });
    expect(factorOf(b).params).toEqual({ maximum: 10, start: 0.7 });
    expect(JSON.stringify(definition)).toBe(before);
  });

  it("describes effective settings from the schema, with defaults and overrides", () => {
    const block = configurePassive(createPassiveBlock("trial-heavy-mean-mass", "a"), {
      coefficient: 2,
      aggregate: "totalKg",
    });
    const settings = Object.fromEntries(effectiveSettings(block).map((s) => [s.name, s]));
    expect(Object.keys(settings).sort()).toEqual(
      ["aggregate", "coefficient", "maximum", "referenceKg"].sort(),
    );
    expect(settings.coefficient).toMatchObject({ value: 2, defaultValue: 3, overridden: true });
    expect(settings.maximum).toMatchObject({ value: 10, overridden: false });
    expect(factorOf(block).value).toBe("totalKg");
  });

  it("reaches array-located curve parameters (tier factors)", () => {
    const block = configurePassive(createPassiveBlock("trial-material-diversity", "a"), {
      secondTierFactor: 6,
    });
    expect(factorOf(block).params).toEqual({
      tiers: [
        { at: 2, factor: 2 },
        { at: 3, factor: 6 },
      ],
    });
  });

  it("rejects unknown keys and out-of-range values, changing nothing", () => {
    const block = createPassiveBlock("trial-dense-packing", "a");
    expect(() => configurePassive(block, { eventRules: 1 })).toThrow(/unknown parameter/);
    expect(() => configurePassive(block, { maximum: 0.5 })).toThrow(PassiveConfigurationError);
    expect(() => configurePassive(block, { start: "high" })).toThrow(/start/);
    expect(passiveConfiguration(block).overrides).toEqual({});
  });

  it("gives a definition without the capability no settings and its own rules", () => {
    const fixed = passiveDefinitions
      .names()
      .map((name) => passiveDefinitions.get(name))
      .find((definition) => definition.configurable === undefined)!;
    const block = createPassiveBlock(fixed.id, "f");
    expect(effectiveSettings(block)).toEqual([]);
    expect(configurePassive(block, {}).traits.passive!.eventRules).toBe(fixed.eventRules);
    expect(() => configurePassive(block, { maximum: 2 })).toThrow(/unknown parameter/);
  });

  it("copies overrides independently on clone, and resets to the declared baseline", () => {
    const source = configurePassive(createPassiveBlock("trial-sparse-packing", "a"), {
      start: 0.3,
    });
    const clone = clonePassiveConfiguration(
      source,
      createPassiveBlock("trial-sparse-packing", "b"),
    );
    expect(clone.id).toBe("b");
    expect(passiveConfiguration(clone).overrides).toEqual({ start: 0.3 });
    expect(passiveConfiguration(clone).overrides).not.toBe(passiveConfiguration(source).overrides);
    const reset = resetPassiveConfiguration(clone);
    expect(passiveConfiguration(reset).overrides).toEqual({});
    expect(factorOf(reset).params).toEqual({ maximum: 10, start: 0.2 });
  });

  it("saves the version and overrides only, rebuilding rules through validation on restore", () => {
    const persistence = rackTraitPersistence.get("configurablePassive");
    const block = configurePassive(createPassiveBlock("trial-dense-packing", "a"), { start: 0.5 });
    const saved = persistence.save(block.traits.configurablePassive);
    expect(JSON.parse(JSON.stringify(saved))).toEqual({
      schemaVersion: 1,
      overrides: { start: 0.5 },
    });
    const restored = persistence.attach!(
      createPassiveBlock("trial-dense-packing", "a"),
      persistence.restore(saved),
    );
    expect(factorOf(restored).params).toEqual({ maximum: 10, start: 0.5 });
    expect(() => persistence.restore({ schemaVersion: 2, overrides: {} })).toThrow(/version/);
    expect(() => persistence.restore({ schemaVersion: 1, overrides: [] })).toThrow(/overrides/);
    expect(() =>
      persistence.attach!(createPassiveBlock("trial-dense-packing", "a"), {
        schemaVersion: 1,
        overrides: { start: 5 },
      }),
    ).toThrow(PassiveConfigurationError);
  });
});

describe("combination validation through the builder (#876)", () => {
  it("rejects a combination its builder's validation refuses", async () => {
    const { passiveRuleBuilders } = await import("./configurable-passive");
    passiveRuleBuilders.register("test-ordered-pair", {
      validate: (owner, config) => {
        const { low, high } = config as { low: number; high: number };
        return low < high ? [] : [`${owner}: low must be below high`];
      },
      build: () => [],
    });
    passiveDefinitions.register("test-configurable-pair", {
      ...passiveDefinitions.get("trial-dense-packing"),
      id: "test-configurable-pair",
      configurable: {
        builder: "test-ordered-pair",
        config: { low: 1, high: 5 },
        parameters: {
          low: { label: "Low", kind: "number", path: ["low"], min: 0, max: 10 },
          high: { label: "High", kind: "number", path: ["high"], min: 0, max: 10 },
        },
      },
    });
    const block = createPassiveBlock("test-configurable-pair", "p");
    expect(configurePassive(block, { low: 4 })).toBeTruthy();
    expect(() => configurePassive(block, { low: 6 })).toThrow(/low must be below high/);
  });
});
