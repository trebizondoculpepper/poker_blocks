import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { GameSession } from "./game-session";
import type { GameState } from "./game-state";
import type { SessionConfig, StageKind } from "./session-config";

const targets: Record<StageKind, number> = { "stage-1": 10, "stage-2": 20, boss: 30 };
const bossDealer: Dealer = { ...baseDealer, name: "boss" };

function makeSession(config: Partial<SessionConfig> = {}) {
  const dealers = new Registry<Dealer>("dealer");
  dealers.register(baseDealer.name, baseDealer);
  dealers.register(bossDealer.name, bossDealer);
  const full: SessionConfig = {
    stage: (round, kind) => ({
      dealer: kind === "boss" ? "boss" : "base",
      targetScore: targets[kind] * round,
      plays: 3,
      discards: 2,
    }),
    handAtStageEnd: "return-to-deck",
    discardPileAfterShop: "keep-out",
    ...config,
  };
  return new GameSession(dealers, full, standardDeck, () => 0);
}

const allCards = (state: GameState): CardBlock[] => [
  ...state.field.map(({ block }) => block),
  ...state.hand,
  ...state.deck,
  ...state.discardPile,
];

/** Make the current stage won or lost without depending on which cards were dealt. */
function decide(session: GameSession, outcome: "won" | "lost"): void {
  const state = session.state as { round: GameState["round"] };
  const round = state.round;
  (session as unknown as { currentState: GameState }).currentState = {
    ...session.state,
    round:
      outcome === "won"
        ? { ...round, score: round.targetScore }
        : { ...round, movesLeft: 0, score: 0 },
  };
}

describe("GameSession progression", () => {
  it("runs stage 1 → stage 2 → boss → shop → next round with each stage's dealer and target", () => {
    const session = makeSession();
    const seen: [number, string, string, number][] = [];
    const record = () =>
      seen.push([
        session.round,
        session.phase,
        session.dealer.name,
        session.state.round.targetScore,
      ]);
    record();
    for (let step = 0; step < 3; step++) {
      decide(session, "won");
      expect(session.advance()).toBe(true);
      record();
    }
    expect(session.leaveShop()).toBe(true);
    record();
    expect(seen).toEqual([
      [1, "stage-1", "base", 10],
      [1, "stage-2", "base", 20],
      [1, "boss", "boss", 30],
      [1, "shop", "boss", 30],
      [2, "stage-1", "base", 20],
    ]);
  });

  it("does not advance an undecided stage, and ends the session on a loss", () => {
    const session = makeSession();
    expect(session.advance()).toBe(false);
    expect(session.leaveShop()).toBe(false);
    decide(session, "lost");
    expect(session.advance()).toBe(true);
    expect(session.phase).toBe("over");
    expect(session.play({ cardId: session.state.hand[0]?.id ?? "x" })).toBeNull();
    expect(session.advance()).toBe(false);
  });

  it("starts each stage with an empty field, fresh counters and a full hand", () => {
    const session = makeSession();
    expect(session.state.field).toHaveLength(0);
    session.play({ cardId: session.state.hand[0].id });
    session.refillHand();
    session.discard(session.state.hand[0].id);
    expect(session.state.field).toHaveLength(1);
    decide(session, "won");
    session.advance();
    expect(session.state.field).toHaveLength(0);
    expect(session.state.hand).toHaveLength(5);
    expect(session.state.round).toEqual({
      score: 0,
      targetScore: 20,
      movesLeft: 3,
      discardsLeft: 2,
    });
    expect(new Set(allCards(session.state)).size).toBe(52);
    expect(allCards(session.state)).toHaveLength(52);
  });

  it("keeps a stage-1 discard out of stages 2 and 3", () => {
    const session = makeSession();
    const discarded = session.state.hand[0];
    expect(session.discard(discarded.id)).not.toBeNull();
    expect(session.state.round.movesLeft).toBe(3);
    for (let stage = 0; stage < 2; stage++) {
      decide(session, "won");
      session.advance();
      expect(session.state.discardPile).toContain(discarded);
      expect(session.state.deck).not.toContain(discarded);
      expect(session.state.hand).not.toContain(discarded);
    }
    expect(session.phase).toBe("boss");
  });

  it("applies the configured discard policy when leaving the shop", () => {
    for (const policy of ["keep-out", "return-to-deck"] as const) {
      const session = makeSession({ discardPileAfterShop: policy });
      const discarded = session.state.hand[0];
      session.discard(discarded.id);
      for (let stage = 0; stage < 3; stage++) {
        decide(session, "won");
        session.advance();
      }
      session.leaveShop();
      expect(session.state.discardPile.includes(discarded)).toBe(policy === "keep-out");
      expect(new Set(allCards(session.state)).size).toBe(52);
    }
  });

  it("exposes progression and dealer identity for saving", () => {
    const session = makeSession();
    expect(session.snapshot()).toMatchObject({ round: 1, phase: "stage-1", dealer: "base" });
  });
});
