import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { baseDealer, type Dealer } from "./dealer";
import { GameRun } from "./game-run";
import type { GameState } from "./game-state";
import type { RunRules, StageKind } from "./run-rules";
import { fromSaveRecord, toSaveRecord } from "./save";
import { shopPreviewState } from "./shop-stock";

const targets: Record<StageKind, number> = { "stage-1": 10, "stage-2": 20, boss: 30 };
const bossDealer: Dealer = { ...baseDealer, name: "boss" };

function makeSession(config: Partial<RunRules> = {}) {
  const dealers = new Registry<Dealer>("dealer");
  dealers.register(baseDealer.name, baseDealer);
  dealers.register(bossDealer.name, bossDealer);
  const full: RunRules = {
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
  return new GameRun(dealers, full, standardDeck, () => 0);
}

const allCards = (state: GameState): CardBlock[] => [
  ...state.field.map(({ block }) => block),
  ...state.hand,
  ...state.deck,
  ...state.discardPile,
];

/** Make the current stage won or lost without depending on which cards were dealt. */
function decide(session: GameRun, outcome: "won" | "lost"): void {
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

describe("GameRun progression", () => {
  it("keeps coins across stages and the shop while stage score resets", () => {
    const session = makeSession();
    (session as unknown as { currentState: GameState }).currentState = {
      ...session.state,
      coins: 9,
    };
    // Each won stage pays its completion bonus (4) once; score resets, coins carry on.
    decide(session, "won");
    session.advance();
    expect(session.state.coins).toBe(13);
    expect(session.phase).toBe("shop");
    session.leaveShop();
    expect(session.state.round.score).toBe(0);
    decide(session, "won");
    session.advance();
    session.leaveShop();
    decide(session, "won");
    session.advance();
    expect(session.phase).toBe("shop");
    expect(session.state.coins).toBe(21);
    session.leaveShop();
    expect(session.state.coins).toBe(21);
  });

  it("runs each stage → shop → next stage, including the boss shop before round 2", () => {
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
      expect(session.leaveShop()).toBe(true);
      record();
    }
    expect(seen).toEqual([
      [1, "stage-1", "base", 10],
      [1, "shop", "base", 10],
      [1, "stage-2", "base", 20],
      [1, "shop", "base", 20],
      [1, "boss", "boss", 30],
      [1, "shop", "boss", 30],
      [2, "stage-1", "base", 20],
    ]);
    decide(session, "won");
    session.advance();
    expect([session.round, session.phase, session.shopAfterStage]).toEqual([2, "shop", "stage-1"]);
    session.leaveShop();
    expect([session.round, session.phase]).toEqual([2, "stage-2"]);
  });

  it("does not advance an undecided stage, and ends the run on a loss", () => {
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
    session.leaveShop();
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
      session.leaveShop();
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
        if (stage < 2) {
          session.leaveShop();
          expect(session.state.discardPile).toContain(discarded);
        }
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

  it("resumes the right next stage after saving each shop, including an old boss shop save", () => {
    const session = makeSession();
    const dealers = new Registry<Dealer>("dealer");
    dealers.register(baseDealer.name, baseDealer);
    dealers.register(bossDealer.name, bossDealer);
    for (const completed of ["stage-1", "stage-2", "boss"] as const) {
      expect(session.phase).toBe(completed);
      decide(session, "won");
      session.advance();
      const saved = toSaveRecord(session.snapshot());
      expect(saved.shopAfter).toBe(completed);
      const restored = fromSaveRecord(saved, standardDeck, dealers);
      expect(restored?.shopAfter).toBe(completed);
      const resumed = GameRun.fromSnapshot(
        dealers,
        {
          stage: (round, kind) => ({
            dealer: kind === "boss" ? "boss" : "base",
            targetScore: targets[kind] * round,
            plays: 3,
            discards: 2,
          }),
          handAtStageEnd: "return-to-deck",
          discardPileAfterShop: "keep-out",
        },
        standardDeck,
        restored!,
        () => 0,
      );
      expect(resumed.leaveShop()).toBe(true);
      expect(resumed.phase).toBe(
        completed === "stage-1" ? "stage-2" : completed === "stage-2" ? "boss" : "stage-1",
      );
      expect(resumed.round).toBe(completed === "boss" ? 2 : 1);
      session.leaveShop();
    }
    const old = toSaveRecord({ ...session.snapshot(), phase: "shop" });
    delete old.shopAfter;
    const oldSnapshot = fromSaveRecord(old, standardDeck, dealers);
    expect(oldSnapshot?.shopAfter).toBeUndefined();
    const oldShop = GameRun.fromSnapshot(
      dealers,
      {
        stage: (round, kind) => ({
          dealer: kind === "boss" ? "boss" : "base",
          targetScore: targets[kind] * round,
          plays: 3,
          discards: 2,
        }),
        handAtStageEnd: "return-to-deck",
        discardPileAfterShop: "keep-out",
      },
      standardDeck,
      oldSnapshot!,
      () => 0,
    );
    expect(oldShop.shopAfterStage).toBe("boss");
    expect(oldShop.leaveShop()).toBe(true);
    expect(oldShop.phase).toBe("stage-1");
  });

  it("can skip an empty-cost shop without changing coins and generates fresh stock next time", () => {
    const session = makeSession();
    decide(session, "won");
    session.advance();
    const dealers = new Registry<Dealer>("dealer");
    dealers.register(baseDealer.name, baseDealer);
    const stocked = GameRun.fromSnapshot(
      dealers,
      {
        stage: (round, kind) => ({
          dealer: "base",
          targetScore: targets[kind] * round,
          plays: 3,
          discards: 2,
        }),
        handAtStageEnd: "return-to-deck",
        discardPileAfterShop: "keep-out",
      },
      standardDeck,
      { ...session.snapshot(), state: shopPreviewState(session.state, 0, () => 0) },
      () => 0,
    );
    const balance = stocked.state.coins;
    expect(stocked.state.shopStock).toHaveLength(5);
    expect(stocked.leaveShop()).toBe(true);
    expect(stocked.state.coins).toBe(balance);
    expect(stocked.state.shopStock).toBeUndefined();
    decide(stocked, "won");
    stocked.advance();
    expect(stocked.phase).toBe("shop");
    expect(stocked.state.shopStock).toBeUndefined();
  });

  it("keeps purchased blocks and the remaining balance when leaving an early shop", () => {
    const session = makeSession();
    decide(session, "won");
    session.advance();
    const dealers = new Registry<Dealer>("dealer");
    dealers.register(baseDealer.name, baseDealer);
    const stocked = GameRun.fromSnapshot(
      dealers,
      {
        stage: (round, kind) => ({
          dealer: "base",
          targetScore: targets[kind] * round,
          plays: 3,
          discards: 2,
        }),
        handAtStageEnd: "return-to-deck",
        discardPileAfterShop: "keep-out",
      },
      standardDeck,
      { ...session.snapshot(), state: shopPreviewState(session.state, 5, () => 0) },
      () => 0,
    );
    const passive = stocked.state.shopStock!.find(({ kind }) => kind === "passive")!;
    const card = stocked.state.shopStock!.find(({ kind }) => kind === "card")!;
    expect(stocked.buyShopOffer(passive.block.id, "passive-rack")).not.toBeNull();
    expect(stocked.buyShopOffer(card.block.id, "hand")).not.toBeNull();
    expect(stocked.state.coins).toBe(3);
    stocked.leaveShop();
    expect(stocked.phase).toBe("stage-2");
    expect(stocked.state.coins).toBe(3);
    expect(stocked.state.passiveRack.some(({ id }) => id === passive.block.id)).toBe(true);
    expect(
      [...stocked.state.hand, ...stocked.state.deck].some(({ id }) => id === card.block.id),
    ).toBe(true);
    expect(new Set(allCards(stocked.state).map(({ id }) => id)).size).toBe(52);
  });
});
