import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import {
  createPassiveBlock,
  passiveDefinitions,
  randomPassiveDefinitions,
  trialOffer,
} from "./passives";
import { passiveUnlockRound } from "./offer-eligibility";
import { passiveWeight } from "./shop-stock";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";

const light = "light-stack";

describe("Light acquisition starts in round 3 (#1476)", () => {
  it("keeps its price/frequency but has no shop weight before round 3", () => {
    const definition = passiveDefinitions.get(light);
    expect(definition.shop).toEqual({ ...trialOffer, unlockRound: 3 });
    expect(passiveUnlockRound(definition)).toBe(3);
    expect([1, 2, 3, 4].map((round) => passiveWeight(definition, round))).toEqual([0, 0, 4, 4]);
  });

  it.each([1, 2, 3])("filters random grants before drawing RNG in round %i", (round) => {
    const random = vi.fn(() => 0);
    const definitions = randomPassiveDefinitions(1000, random, round);
    expect(definitions.some(({ id }) => id === light)).toBe(round >= 3);
    expect(definitions.every((definition) => passiveUnlockRound(definition) <= round)).toBe(true);
    expect(random).toHaveBeenCalledTimes(definitions.length);
  });

  it.each([1, 2, 3])("checks the live round for rack filling and stale purchases (%i)", (round) => {
    const rules = sandboxRunRules(demoRunRules);
    const initial = new GameRun(dealerRegistry, rules, standardDeck, () => 0);
    const stale = createPassiveBlock(light, "stale.light");
    const run = GameRun.fromSnapshot(
      dealerRegistry,
      rules,
      standardDeck,
      {
        ...initial.snapshot(),
        round,
        phase: "shop",
        state: {
          ...initial.state,
          coins: 100,
          shopStock: [{ kind: "passive", block: stale }],
        },
      },
      () => 0,
    );
    expect(run.purchaseVerdict(stale.id, "passive-rack")).toEqual(
      round < 3 ? { reason: "locked" } : null,
    );
    if (round < 3) expect(run.buyShopOffer(stale.id, "passive-rack")).toBeNull();
    run.fillPassiveRack(1000);
    expect(run.state.passiveRack.some(({ definitionId }) => definitionId === light)).toBe(
      round >= 3,
    );
  });

  it("retains an already-owned early Light through save and restore", () => {
    const initial = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    expect(initial.installPassive(createPassiveBlock(light, "owned.light"))).toBe(true);
    const restored = fromSaveRecord(
      JSON.parse(JSON.stringify(toSaveRecord(initial.snapshot()))),
      standardDeck,
      dealerRegistry,
    );
    expect(restored?.round).toBe(1);
    expect(restored?.state.passiveRack.map(({ definitionId }) => definitionId)).toContain(light);
  });
});
