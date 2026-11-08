import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameSession } from "./game-session";
import { demoSessionConfig } from "./session-config";
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
  const session = () => new GameSession(dealerRegistry, demoSessionConfig, standardDeck, () => 0);

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
