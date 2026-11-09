import { describe, expect, it } from "vite-plus/test";
import { passiveBalance, validateBalance } from "./balance";
import { passiveDefinitions, createPassiveBlock } from "./passives";
import { defaultResale, resaleValue } from "./resale";

/** Gameplay code that sells a passive, and the UI around it: neither may price it. */
const transactionSources = import.meta.glob<string>(
  ["./table-input.ts", "./run-controller.ts", "./passive-rack.ts"],
  { query: "?raw", import: "default", eager: true },
);

describe("the balance config (#7, #103)", () => {
  it("has a valid entry for every passive the shop can stock", () => {
    const stocked = passiveDefinitions.names().filter((id) => !passiveDefinitions.get(id).retired);
    expect(validateBalance(stocked)).toEqual([]);
  });

  it("reports a missing entry or a bad price", () => {
    expect(validateBalance(["no-such-passive"])).toEqual(["no-such-passive: no balance entry"]);
  });

  it("records the agreed catalogue prices", () => {
    expect(passiveBalance["double-line"].basePrice).toBe(4);
    expect(passiveBalance["quad-line"].basePrice).toBe(9);
    expect(passiveBalance.crossroads.basePrice).toBe(2);
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

  it("reads the base price from the balance config", () => {
    expect(resaleValue(createPassiveBlock("quad-line", "p.1"))).toBe(4);
  });

  it("leaves pricing to the policy: the sale UI and controller never compute a payout", () => {
    for (const [file, text] of Object.entries(transactionSources)) {
      expect(text, file).not.toMatch(/basePrice|defaultResale|resaleValue/);
    }
  });
});
