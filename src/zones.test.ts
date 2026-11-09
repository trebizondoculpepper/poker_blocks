import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { createPassiveBlock, passiveTraits, type PassiveBlock } from "./passives";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { inspectable } from "./traits/inspectable";
import { insertAt, moveItem } from "./zones";

describe("moveItem", () => {
  const items = [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }];

  it("moves first to last and last to first, keeping the same instances", () => {
    expect(moveItem(items, 0, 3)).toEqual([items[1], items[2], items[3], items[0]]);
    const back = moveItem(items, 3, 0)!;
    expect(back).toEqual([items[3], items[0], items[1], items[2]]);
    expect(back[0]).toBe(items[3]);
  });

  it("treats a move to the same place as a no-op and leaves the input alone", () => {
    const copy = [...items];
    expect(moveItem(items, 2, 2)).toEqual(items);
    expect(items).toEqual(copy);
  });

  it("refuses out-of-range moves", () => {
    expect(moveItem(items, -1, 0)).toBeNull();
    expect(moveItem(items, 0, 4)).toBeNull();
    expect(moveItem(items, 1.5, 0)).toBeNull();
  });
});

describe("insertAt", () => {
  it("inserts at the index, clamped to the zone", () => {
    expect(insertAt([1, 2, 3], 1, [9])).toEqual([1, 9, 2, 3]);
    expect(insertAt([1, 2], 10, [9])).toEqual([1, 2, 9]);
    expect(insertAt([1, 2], -3, [9])).toEqual([9, 1, 2]);
  });
});

describe("hand reordering", () => {
  const session = () => new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);

  it("reorders the hand without touching counters, score, deck or other zones", () => {
    const game = session();
    const before = game.state;
    expect(game.reorderHand(0, 4)).toBe(true);
    expect(game.state.hand).toEqual([...before.hand.slice(1), before.hand[0]]);
    expect(new Set(game.state.hand)).toEqual(new Set(before.hand));
    expect(game.state.round).toEqual(before.round);
    expect(game.state.deck).toBe(before.deck);
    expect(game.state.field).toBe(before.field);
    expect(game.state.discardPile).toBe(before.discardPile);
  });

  it("leaves the hand unchanged for an invalid or cancelled move", () => {
    const game = session();
    const before = game.state;
    expect(game.reorderHand(0, 9)).toBe(false);
    expect(game.state).toBe(before);
  });

  it("packs survivors left and appends drawn cards on the right", () => {
    const game = session();
    const [a, b, c, d, e] = game.state.hand;
    game.play({ cardId: c.id });
    const [drawn] = game.refillHand();
    expect(game.state.hand).toEqual([a, b, d, e, drawn]);
    game.discard(a.id);
    const [next] = game.refillHand();
    expect(game.state.hand).toEqual([b, d, e, drawn, next]);
  });
});

describe("passive rack reordering", () => {
  const session = () =>
    new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), standardDeck, () => 0);
  const withRack = (ids: string[]) => {
    const game = session();
    for (const [index, definition] of ["double-line", "quad-line", "double-line"].entries())
      if (index < ids.length) game.installPassive(createPassiveBlock(definition, ids[index]));
    return game;
  };

  it("moves first to last and back with the same instances and nothing lost or duplicated", () => {
    const game = withRack(["a", "b", "c"]);
    const [a, b, c] = game.state.passiveRack;
    expect(game.reorderPassive(0, 2)).toBe(true);
    expect(game.state.passiveRack).toEqual([b, c, a]);
    expect(game.state.passiveRack[2]).toBe(a);
    expect(game.reorderPassive(2, 0)).toBe(true);
    expect(game.state.passiveRack).toEqual([a, b, c]);
    expect(new Set(game.state.passiveRack.map(({ id }) => id)).size).toBe(3);
  });

  it("changes no counters, score, coins or other zones", () => {
    const game = withRack(["a", "b"]);
    const before = game.state;
    expect(game.reorderPassive(1, 0)).toBe(true);
    expect(game.state.round).toEqual(before.round);
    expect(game.state.coins).toBe(before.coins);
    expect(game.state.hand).toBe(before.hand);
    expect(game.state.deck).toBe(before.deck);
    expect(game.state.field).toBe(before.field);
    expect(game.state.discardPile).toBe(before.discardPile);
  });

  it("treats a drop on its own slot as a no-op and refuses invalid moves untouched", () => {
    const game = withRack(["a", "b"]);
    const rack = game.state.passiveRack;
    expect(game.reorderPassive(1, 1)).toBe(true);
    expect(game.state.passiveRack).toEqual(rack);
    const before = game.state;
    expect(game.reorderPassive(0, 2)).toBe(false);
    expect(game.reorderPassive(-1, 0)).toBe(false);
    expect(game.state).toBe(before);
  });

  it("resolves passives in the rack order at the time of the event", () => {
    const seen: string[] = [];
    passiveTraits.register("test.reorder.listener", {
      id: "test.reorder.listener",
      listensTo: ["discard.completed"],
      respond: (passive) => {
        seen.push(passive.id);
        return [];
      },
    });
    const listener = (id: string): PassiveBlock => ({
      id,
      definitionId: "double-line",
      traits: {
        rackResident: { zone: "passive-rack" },
        passive: { traitId: "test.reorder.listener" },
        inspectable: inspectable(id),
      },
    });
    const game = session();
    game.installPassive(listener("left"));
    game.installPassive(listener("right"));
    expect(game.discard(game.state.hand[0].id)).not.toBeNull();
    expect(seen).toEqual(["left", "right"]);
    seen.length = 0;
    expect(game.reorderPassive(1, 0)).toBe(true);
    expect(game.discard(game.state.hand[0].id)).not.toBeNull();
    expect(seen).toEqual(["right", "left"]);
  });
});
