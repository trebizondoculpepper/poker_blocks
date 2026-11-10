import { describe, expect, it } from "vite-plus/test";
import {
  stageTargetBalance,
  validateMaterialBalance,
  validatePassiveBalance,
  validateStageTargetBalance,
} from "./balance";
import { materialDefinitions } from "./materials";
import { passiveDefinitions, createPassiveBlock } from "./passives";
import { defaultResale, resaleValue } from "./resale";

/** Gameplay code that sells a passive, and the UI around it: neither may price it. */
const transactionSources = import.meta.glob<string>(
  ["./table-input.ts", "./run-controller.ts", "./passive-rack.ts"],
  { query: "?raw", import: "default", eager: true },
);

describe("the balance config (#7, #103)", () => {
  const definitions = passiveDefinitions.names().map((id) => passiveDefinitions.get(id));

  it("gives every passive the shop can stock a valid balance on its own definition", () => {
    expect(validatePassiveBalance(definitions)).toEqual([]);
  });

  it("gives every material a valid scoring modifier (#141)", () => {
    expect(validateMaterialBalance(materialDefinitions)).toEqual([]);
    expect(
      validateMaterialBalance([
        { ...materialDefinitions[1], scoringModifier: { multiplicative: 0 } },
      ]),
    ).toEqual(["wood: multiplicative must be positive"]);
  });

  it("reports a missing balance or a bad price", () => {
    const [first] = definitions.filter(({ retired }) => !retired);
    expect(validatePassiveBalance([{ ...first, shop: undefined }])).toEqual([
      `${first.id}: no shop balance`,
    ]);
    expect(
      validatePassiveBalance([
        { ...first, shop: { basePrice: 0, unlockRound: 1, frequency: "even" } },
      ]),
    ).toHaveLength(1);
  });

  it("records the agreed catalogue prices", () => {
    expect(passiveDefinitions.get("double-line").shop?.basePrice).toBe(4);
    expect(passiveDefinitions.get("quad-line").shop?.basePrice).toBe(9);
    expect(passiveDefinitions.get("crossroads").shop?.basePrice).toBe(2);
  });
});

describe("the default resale policy (#103)", () => {
  it.each([
    [2, 1],
    [5, 2],
    [9, 4],
    [8, 4],
    [1, 1],
    [0, 1],
  ])("a %i-coin passive sells for %i", (basePrice, payout) =>
    expect(defaultResale(basePrice)).toBe(payout),
  );

  it("refuses a negative or non-numeric base price", () => {
    expect(() => defaultResale(-1)).toThrow();
    expect(() => defaultResale(Number.NaN)).toThrow();
  });

  it("reads the base price from the passive's priced trait", () => {
    expect(resaleValue(createPassiveBlock("quad-line", "p.1"))).toBe(4);
  });

  it("leaves pricing to the policy: the sale UI and controller never compute a payout", () => {
    for (const [file, text] of Object.entries(transactionSources)) {
      expect(text, file).not.toMatch(/basePrice|defaultResale|resaleValue/);
    }
  });
});

describe("stage target balance (#137)", () => {
  it("validates the configured opening target and stage rates", () => {
    expect(validateStageTargetBalance(stageTargetBalance)).toEqual([]);
    expect(validateStageTargetBalance({ ...stageTargetBalance, openingTarget: 0 })).toContain(
      "opening target must be a positive whole number",
    );
    expect(
      validateStageTargetBalance({
        ...stageTargetBalance,
        stages: [{ kind: "stage-1", rateInto: Number.POSITIVE_INFINITY }],
      }),
    ).toContain("stage-1: rate must be finite and at least 1");
    expect(
      validateStageTargetBalance({
        ...stageTargetBalance,
        stages: [{ kind: "stage-1", rateInto: 0.5 }],
      }),
    ).toContain("stage-1: rate must be finite and at least 1");
  });

  it("rejects a rounded target that cannot be represented safely", () => {
    expect(
      validateStageTargetBalance({
        openingTarget: Number.MAX_SAFE_INTEGER,
        stages: [{ kind: "first", rateInto: 2 }],
      }),
    ).toContain("stage target must remain a positive safe integer after rounding");
  });
});
