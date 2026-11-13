import { describe, expect, it } from "vite-plus/test";
import {
  LifecycleConfigurationError,
  resolveLifecycle,
  resolveLifecycles,
  type LifecycleDeclaration,
} from "./lifecycle-resolver";

const none = { nonResettable: { reason: "no automatic reversion" } };
const toRawAtStage = { resettable: { recipe: [{ handler: "doneness" }], boundary: "stage" } };

// Fixtures shaped like the declaration matrix (doc/block-lifecycle-declarations.md); the names
// are opaque handles here, never looked at by the resolver.
const fixtures: Record<string, LifecycleDeclaration> = {
  base: { retention: "run", reset: none },
  meat: { parent: "base", reset: toRawAtStage },
  cookedMeat: { parent: "meat" },
  gelato: {
    parent: "base",
    reset: {
      resettable: {
        recipe: [{ handler: "material", config: { to: "custard" } }],
        boundary: "round",
      },
    },
  },
  cloud: { parent: "base", retention: "stage" },
  heatedWater: { parent: "base" },
  timedMeat: {
    parent: "meat",
    reset: {
      resettable: {
        recipe: [{ handler: "doneness" }, { handler: "countdown" }],
        boundary: "stage",
      },
    },
  },
};

const resolve = (name: string, extra: Record<string, LifecycleDeclaration> = {}) => {
  const all = { ...fixtures, ...extra };
  return resolveLifecycle(name, (n) => (Object.hasOwn(all, n) ? all[n] : undefined));
};
const fails = (name: string, extra: Record<string, LifecycleDeclaration>, message: RegExp) =>
  expect(() => resolve(name, extra)).toThrow(
    expect.objectContaining({
      name: "LifecycleConfigurationError",
      message: expect.stringMatching(message),
    }),
  );

describe("inherited lifecycle resolution (#916)", () => {
  it("resolves a root's own values", () => {
    expect(resolve("base")).toEqual({
      retention: "run",
      reset: { facet: "nonResettable", config: none.nonResettable },
    });
  });

  it("inherits what a definition does not declare, through several parents", () => {
    expect(resolve("heatedWater")).toEqual(resolve("base"));
    expect(resolve("cookedMeat")).toEqual({
      retention: "run",
      reset: { facet: "resettable", config: toRawAtStage.resettable },
    });
  });

  it("replaces a complete value locally, never merging it with the parent's", () => {
    expect(resolve("cloud")).toMatchObject({
      retention: "stage",
      reset: { facet: "nonResettable" },
    });
    expect(resolve("timedMeat").reset.config).toEqual({
      recipe: [{ handler: "doneness" }, { handler: "countdown" }],
      boundary: "stage",
    });
    expect(resolve("gelato")).toMatchObject({
      retention: "run",
      reset: { facet: "resettable", config: { boundary: "round" } },
    });
  });

  it("rejects a missing definition, an unknown parent and a cycle", () => {
    fails("nope", {}, /no lifecycle declaration/);
    fails(
      "orphan",
      { orphan: { parent: "ghost", retention: "run", reset: none } },
      /unknown lifecycle parent "ghost"/,
    );
    fails("a", { a: { parent: "b" }, b: { parent: "a" } }, /cycle: a → b → a/);
    fails("self", { self: { parent: "self" } }, /cycle/);
  });

  it("rejects unresolved retention or reset, and a bad retention", () => {
    fails("noRetention", { noRetention: { reset: none } }, /no retention/);
    fails("noReset", { noReset: { retention: "run" } }, /no reset facet/);
    fails("odd", { odd: { retention: "forever" as never, reset: none } }, /bad retention/);
  });

  it("rejects contradictory or unknown facets, recipes and boundaries", () => {
    fails(
      "both",
      { both: { retention: "run", reset: { ...none, ...toRawAtStage } } },
      /conflicting/,
    );
    fails("empty", { empty: { retention: "run", reset: {} } }, /no reset facet declared/);
    fails(
      "mystery",
      { mystery: { retention: "run", reset: { mystery: {} } } },
      /unknown reset facet/,
    );
    fails(
      "badHandler",
      {
        badHandler: {
          retention: "run",
          reset: { resettable: { recipe: [{ handler: "melt" }], boundary: "stage" } },
        },
      },
      /unknown reset handler.*melt/,
    );
    fails(
      "noRecipe",
      { noRecipe: { retention: "run", reset: { resettable: { boundary: "stage" } } } },
      /needs a recipe/,
    );
    fails(
      "badBoundary",
      {
        badBoundary: {
          retention: "run",
          reset: { resettable: { recipe: [{ handler: "doneness" }], boundary: "lunch" } },
        },
      },
      /bad reset boundary/,
    );
  });

  it("resolves every declaration at once, or throws the first error", () => {
    expect(Object.keys(resolveLifecycles(fixtures))).toEqual(Object.keys(fixtures));
    expect(() => resolveLifecycles({ ...fixtures, broken: { parent: "missing" } })).toThrow(
      LifecycleConfigurationError,
    );
  });

  it("does not change the declarations it reads", () => {
    const frozen = structuredClone(fixtures);
    resolveLifecycles(fixtures);
    expect(fixtures).toEqual(frozen);
  });
});
