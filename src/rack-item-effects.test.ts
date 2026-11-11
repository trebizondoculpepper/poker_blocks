import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { materialOf } from "./materials";
import { createPassiveBlock, passiveDefinitions } from "./passives";
import { demoRunRules } from "./run-rules";
import { createTransmogrifier } from "./transmogrifiers";

const withRack = (...items: ReturnType<typeof createTransmogrifier>[]) => {
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0.25);
  return GameRun.fromSnapshot(dealerRegistry, demoRunRules, standardDeck, {
    ...game.snapshot(),
    state: { ...game.state, passiveRack: items },
  });
};

describe("using a rack item on a card (#389)", () => {
  it("a transmogrifier changes the card's material and spends one use", () => {
    const run = withRack(createTransmogrifier("steel", "t1", 8));
    const card = run.state.hand[0]!;
    expect(run.applyRackItem("t1", card.id)).not.toBeNull();
    expect(materialOf(run.state.hand[0]!)).toBe("steel");
    expect(run.state.passiveRack[0]!.traits.limitedUse).toEqual({ uses: 1, total: 2 });
  });

  it("leaves the rack for good after its last use", () => {
    const run = withRack(createTransmogrifier("wood", "t1", 6, 1, 2));
    expect(run.applyRackItem("t1", run.state.hand[0]!.id)).not.toBeNull();
    expect(run.state.passiveRack).toEqual([]);
  });

  it("refuses a card already of that material without spending a use", () => {
    const run = withRack(createTransmogrifier("steel", "t1", 8));
    const card = run.state.hand[0]!;
    run.applyRackItem("t1", card.id);
    const before = run.state;
    expect(run.applyRackItem("t1", card.id)).toBeNull();
    expect(run.state).toBe(before);
    expect(run.state.passiveRack[0]!.traits.limitedUse?.uses).toBe(1);
  });

  it("refuses an item with no effect on cards (an ordinary passive)", () => {
    const passive = createPassiveBlock(passiveDefinitions.names()[0]!, "p1");
    const run = withRack(passive as ReturnType<typeof createTransmogrifier>);
    expect(run.applyRackItem("p1", run.state.hand[0]!.id)).toBeNull();
    expect(run.state.passiveRack).toHaveLength(1);
  });
});
