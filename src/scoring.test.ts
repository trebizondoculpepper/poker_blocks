import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { roundOutcome, baseDealer } from "./dealer";
import type { PlacedBlock } from "./game-state";
import { evaluateHand, evaluateLine, findLines, scoreField } from "./scoring";

function card(id: string): CardBlock {
  const found = standardDeck.find((block) => block.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
}

const hand = (...ids: string[]) => ids.map(card);

describe("evaluateHand", () => {
  it.each([
    [["A-spades", "K-hearts"], "high-card"],
    [["7-spades", "7-hearts"], "pair"],
    [["7-spades", "7-hearts", "7-clubs"], "three-of-a-kind"],
    [["7-spades", "7-hearts", "9-clubs", "9-hearts"], "two-pair"],
    [["7-spades", "7-hearts", "7-clubs", "7-diamonds"], "four-of-a-kind"],
    [["2-spades", "3-hearts", "4-clubs", "5-hearts", "6-spades"], "straight"],
    [["A-spades", "2-hearts", "3-clubs", "4-hearts", "5-spades"], "straight"],
    [["10-spades", "J-hearts", "Q-clubs", "K-hearts", "A-spades"], "straight"],
    [["Q-spades", "K-hearts", "A-clubs", "2-hearts", "3-spades"], "high-card"],
    [["2-hearts", "7-hearts", "9-hearts", "J-hearts", "K-hearts"], "flush"],
    [["7-spades", "7-hearts", "7-clubs", "9-hearts", "9-spades"], "full-house"],
    [["5-clubs", "6-clubs", "7-clubs", "8-clubs", "9-clubs"], "straight-flush"],
  ])("classifies %j as %s", (ids, expected) => {
    expect(evaluateHand(hand(...ids))).toBe(expected);
  });

  it("does not count a short line as a flush", () => {
    expect(evaluateHand(hand("2-hearts", "7-hearts", "9-hearts"))).toBe("high-card");
  });

  it("allows five of a kind from a modified deck", () => {
    const seven = card("7-spades");
    expect(evaluateHand([seven, seven, seven, seven, seven])).toBe("five-of-a-kind");
  });
});

describe("evaluateLine", () => {
  it("scores the best five cards of a long line", () => {
    const line = hand("K-spades", "2-clubs", "3-clubs", "4-clubs", "5-clubs", "6-clubs");
    expect(evaluateLine(line)).toBe("straight-flush");
  });
});

describe("findLines", () => {
  const at = (id: string, x: number, y: number, z: number): PlacedBlock => ({
    block: card(id),
    cell: { x, y, z },
  });

  it("finds runs on each axis and ignores lone blocks", () => {
    const field = [
      at("2-spades", 0, 0, 0),
      at("3-spades", 1, 0, 0),
      at("4-spades", 2, 0, 0),
      at("5-spades", 0, 1, 0),
      at("9-spades", 5, 5, 5),
    ];
    const lines = findLines(field);
    expect(lines.map((l) => [l.axis, l.blocks.map((b) => b.id)])).toEqual([
      ["x", ["2-spades", "3-spades", "4-spades"]],
      ["y", ["2-spades", "5-spades"]],
    ]);
  });

  it("splits runs at gaps", () => {
    const field = [at("2-spades", 0, 0, 0), at("3-spades", 1, 0, 0), at("4-spades", 3, 0, 0)];
    expect(findLines(field)).toHaveLength(1);
  });

  it("scores every line on the field", () => {
    const field = [at("7-spades", 0, 0, 0), at("7-hearts", 0, 0, 1)];
    expect(scoreField(field).map(({ hand: h }) => h)).toEqual(["pair"]);
  });
});

describe("round scoring", () => {
  it("adds line scores on each play and ends the round at the target", () => {
    let state = baseDealer.startGame(standardDeck, () => 0);
    state = { ...state, round: { ...state.round, targetScore: 1 } };
    const [first] = state.hand;
    const played = baseDealer.play(state, {
      cardId: first.id,
      targetId: state.field[0].block.id,
      face: "east",
    });
    expect(played).not.toBeNull();
    expect(played!.round.score).toBeGreaterThan(0);
    expect(roundOutcome(played!)).toBe("won");
    expect(baseDealer.canPlay(played!)).toBe(false);
    expect(baseDealer.canDiscard(played!)).toBe(false);
  });

  it("loses when plays run out short of the target", () => {
    const state = baseDealer.startGame(standardDeck, () => 0);
    const spent = { ...state, round: { ...state.round, movesLeft: 0 } };
    expect(roundOutcome(spent)).toBe("lost");
  });
});
