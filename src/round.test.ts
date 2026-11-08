import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { baseDealer } from "./dealer";

describe("base dealer round limits", () => {
  it("starts with six plays and four discards", () => {
    expect(baseDealer.startGame(standardDeck, () => 0).round).toEqual({
      score: 0,
      targetScore: 100,
      movesLeft: 6,
      discardsLeft: 4,
    });
  });

  it("rejects actions after their allowance is exhausted", () => {
    const state = baseDealer.startGame(standardDeck, () => 0);
    const play = {
      cardId: state.hand[0].id,
      targetId: state.field[0].block.id,
      face: "east",
    } as const;
    expect(baseDealer.play({ ...state, round: { ...state.round, movesLeft: 0 } }, play)).toBeNull();
    expect(
      baseDealer.discard({ ...state, round: { ...state.round, discardsLeft: 0 } }, play.cardId),
    ).toBeNull();
  });
});
