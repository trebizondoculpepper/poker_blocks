import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { baseDealer, roundOutcome } from "./dealer";
import type { PlacedBlock } from "./game-state";
import {
  evaluateLine,
  findScoringLines,
  presentationOrder,
  scoreField,
  scoreLine,
  type ScoredLine,
} from "./scoring";
import { scorableValue } from "./traits/scorable";

function card(id: string): CardBlock {
  const found = standardDeck.find((block) => block.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
}

const cards = (...ids: string[]) => ids.map(card);

describe("scorable trait", () => {
  it.each([
    ["2-spades", 2],
    ["10-hearts", 10],
    ["J-clubs", 11],
    ["Q-clubs", 12],
    ["K-clubs", 13],
    ["A-clubs", 14],
  ])("gives %s %d points", (id, value) => {
    expect(scorableValue(card(id))).toBe(value);
  });
});

describe("scoreLine", () => {
  it.each([
    [[], 0],
    [["7-spades"], 0],
    [["2-spades", "K-hearts"], 13],
    [["7-spades", "7-hearts"], 28],
    [["7-spades", "7-hearts", "K-clubs"], 28],
    [["7-spades", "7-hearts", "7-clubs"], 63],
    [["7-spades", "7-hearts", "9-clubs", "9-hearts"], 64],
    [["7-spades", "7-hearts", "7-clubs", "7-diamonds"], 196],
    [["7-spades", "7-hearts", "7-clubs", "7-diamonds", "K-hearts"], 196],
    [["2-spades", "3-hearts", "4-clubs", "5-hearts", "6-spades"], 60],
    [["10-spades", "J-hearts", "Q-clubs", "K-hearts", "A-spades"], 180],
    [["2-hearts", "7-hearts", "9-hearts", "J-hearts", "K-hearts"], 168],
    [["7-spades", "7-hearts", "7-clubs", "9-hearts", "9-spades"], 195],
    [["5-clubs", "6-clubs", "7-clubs", "8-clubs", "9-clubs"], 315],
  ])("scores %j as %d", (ids, points) => {
    expect(scoreLine(cards(...ids))).toBe(points);
  });

  it("names each hand", () => {
    const hand = (...ids: string[]) => evaluateLine(cards(...ids)).hand;
    expect(hand("2-spades", "K-hearts")).toBe("high-card");
    expect(hand("7-spades", "7-hearts")).toBe("pair");
    expect(hand("7-spades", "7-hearts", "9-clubs", "9-hearts")).toBe("two-pair");
    expect(hand("7-spades", "7-hearts", "7-clubs")).toBe("three-of-a-kind");
    expect(hand("2-spades", "3-hearts", "4-clubs", "5-hearts", "6-spades")).toBe("straight");
    expect(hand("2-hearts", "7-hearts", "9-hearts", "J-hearts", "K-hearts")).toBe("flush");
    expect(hand("7-spades", "7-hearts", "7-clubs", "9-hearts", "9-spades")).toBe("full-house");
    expect(hand("7-spades", "7-hearts", "7-clubs", "7-diamonds")).toBe("four-of-a-kind");
    expect(hand("5-clubs", "6-clubs", "7-clubs", "8-clubs", "9-clubs")).toBe("straight-flush");
  });

  it("treats aces as high only in straights", () => {
    expect(
      evaluateLine(cards("A-spades", "2-hearts", "3-clubs", "4-hearts", "5-spades")).hand,
    ).toBe("high-card");
  });

  it("does not count a short line of one suit as a flush", () => {
    expect(evaluateLine(cards("2-hearts", "7-hearts", "9-hearts")).hand).toBe("high-card");
  });

  it("leaves kickers out of the counted cards", () => {
    const result = evaluateLine(cards("7-spades", "K-clubs", "7-hearts"));
    expect(result.contributingIds).toEqual(["7-spades", "7-hearts"]);
    expect(evaluateLine(cards("2-spades", "K-hearts", "5-clubs")).contributingIds).toEqual([
      "K-hearts",
    ]);
  });

  it("picks the highest-scoring five cards from a long line", () => {
    const line = cards("K-spades", "2-clubs", "3-clubs", "4-clubs", "5-clubs", "6-clubs");
    const result = evaluateLine(line);
    expect(result.hand).toBe("straight-flush");
    expect(result.points).toBe(180);
    expect(result.contributingIds).not.toContain("K-spades");
  });

  it("is deterministic and leaves its input unchanged", () => {
    const line = cards("9-spades", "9-hearts", "2-clubs");
    const copy = [...line];
    expect(scoreLine(line)).toBe(scoreLine(line));
    expect(line).toEqual(copy);
  });
});

describe("findScoringLines", () => {
  const at = (id: string, x: number, y: number, z: number): PlacedBlock => ({
    block: card(id),
    cell: { x, y, z },
  });

  it("finds maximal lines on each axis, in cell order, and ignores lone blocks", () => {
    const field = [
      at("4-spades", 2, 0, 0),
      at("2-spades", 0, 0, 0),
      at("3-spades", 1, 0, 0),
      at("5-spades", 0, 1, 0),
      at("6-spades", 0, 0, 1),
      at("9-spades", 5, 5, 5),
    ];
    const snapshot = structuredClone(field.map(({ cell }) => cell));
    const lines = findScoringLines(field);
    expect(lines.map((l) => [l.axis, l.blocks.map((b) => b.id)])).toEqual([
      ["x", ["2-spades", "3-spades", "4-spades"]],
      ["y", ["2-spades", "5-spades"]],
      ["z", ["2-spades", "6-spades"]],
    ]);
    expect(lines[0].cells).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);
    expect(field.map(({ cell }) => cell)).toEqual(snapshot);
  });

  it("splits runs at gaps and reports each line once", () => {
    const field = [
      at("2-spades", 0, 0, 0),
      at("3-spades", 1, 0, 0),
      at("4-spades", 3, 0, 0),
      at("5-spades", 4, 0, 0),
    ];
    expect(findScoringLines(field).map((l) => l.blocks.length)).toEqual([2, 2]);
  });
});

describe("presentationOrder", () => {
  const scored = (points: number, id: string) =>
    ({ points, blockIds: [id] }) as unknown as ScoredLine;

  it("drops zero-point lines and puts the highest last, keeping ties in order", () => {
    const a = scored(28, "a");
    const b = scored(0, "b");
    const c = scored(13, "c");
    const d = scored(28, "d");
    expect(presentationOrder([a, b, c, d])).toEqual([c, a, d]);
  });

  it("identifies the scored line and its scoring cards", () => {
    const field: PlacedBlock[] = [
      { block: card("7-spades"), cell: { x: 0, y: 0, z: 0 } },
      { block: card("7-hearts"), cell: { x: 0, y: 0, z: 1 } },
    ];
    const [line] = scoreField(field);
    expect(line).toMatchObject({
      blockIds: ["7-spades", "7-hearts"],
      contributingIds: ["7-spades", "7-hearts"],
      hand: "pair",
      points: 28,
    });
    expect(line.line.axis).toBe("z");
  });
});

describe("round scoring", () => {
  it("adds line points on each play and ends the round at the target", () => {
    let state = baseDealer.startGame(standardDeck, () => 0);
    state = { ...state, round: { ...state.round, targetScore: 1 } };
    const played = baseDealer.play(state, {
      cardId: state.hand[0].id,
      targetId: state.field[0].block.id,
      face: "east",
    });
    expect(played!.round.score).toBeGreaterThan(0);
    expect(roundOutcome(played!)).toBe("won");
    expect(baseDealer.canPlay(played!)).toBe(false);
    expect(baseDealer.canDiscard(played!)).toBe(false);
  });

  it("loses when plays run out short of the target", () => {
    const state = baseDealer.startGame(standardDeck, () => 0);
    expect(roundOutcome({ ...state, round: { ...state.round, movesLeft: 0 } })).toBe("lost");
  });
});
