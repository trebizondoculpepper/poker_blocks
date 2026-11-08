import { describe, expect, it } from "vite-plus/test";
import { initialRound, recordDiscard, recordPlay } from "./round";

describe("round limits", () => {
  it("starts with six plays and four discards", () => {
    expect(initialRound).toEqual({ score: 0, targetScore: 100, movesLeft: 6, discardsLeft: 4 });
  });

  it("uses a move only after a successful play", () => {
    const played = recordPlay(initialRound);
    expect(played?.movesLeft).toBe(5);
    expect(initialRound.movesLeft).toBe(6);
    expect(recordPlay({ ...initialRound, movesLeft: 0 })).toBeNull();
  });

  it("uses a discard only while some remain", () => {
    expect(recordDiscard(initialRound)?.discardsLeft).toBe(3);
    expect(recordDiscard({ ...initialRound, discardsLeft: 0 })).toBeNull();
  });
});
