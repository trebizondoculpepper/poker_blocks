import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { roundOutcome, type Dealer } from "./dealer";
import type { GameState, PlayAction } from "./game-state";
import { insertAt, moveItem } from "./zones";
import { stageKinds, type SessionConfig, type StageKind } from "./session-config";

/** Where a session is: one of a round's three stages, the shop, or finished after a loss. */
export type Phase = StageKind | "shop" | "over";

/** What a future save/Continue flow needs to restore a session. */
export type SessionSnapshot = {
  round: number;
  phase: Phase;
  dealer: string;
  state: GameState;
};

/**
 * Controls one game attempt: stage 1 → stage 2 → boss stage → shop → next round.
 * It keeps the current facts while a registered dealer, chosen per stage, applies the rules.
 */
export class GameSession {
  private readonly dealers: Registry<Dealer>;
  private readonly config: SessionConfig;
  private readonly random: () => number;
  private activeDealer: Dealer;
  private currentState: GameState;
  private currentRound = 1;
  private currentPhase: Phase = "stage-1";

  constructor(
    dealers: Registry<Dealer>,
    config: SessionConfig,
    cards: readonly CardBlock[],
    random: () => number = Math.random,
  ) {
    this.dealers = dealers;
    this.config = config;
    this.random = random;
    const setup = config.stage(1, "stage-1");
    this.activeDealer = dealers.get(setup.dealer);
    const dealt = this.activeDealer.startGame(cards, random);
    this.currentState = this.activeDealer.startStage(dealt, setup, random);
  }

  /** Resume a saved run exactly where it was. Validate the snapshot first (see save.ts). */
  static fromSnapshot(
    dealers: Registry<Dealer>,
    config: SessionConfig,
    cards: readonly CardBlock[],
    snapshot: SessionSnapshot,
    random: () => number = Math.random,
  ): GameSession {
    const session = new GameSession(dealers, config, cards, random);
    session.activeDealer = dealers.get(snapshot.dealer);
    session.currentState = snapshot.state;
    session.currentRound = snapshot.round;
    session.currentPhase = snapshot.phase;
    return session;
  }

  get dealer(): Dealer {
    return this.activeDealer;
  }

  get state(): GameState {
    return this.currentState;
  }

  get round(): number {
    return this.currentRound;
  }

  get phase(): Phase {
    return this.currentPhase;
  }

  get inStage(): boolean {
    return (stageKinds as readonly string[]).includes(this.currentPhase);
  }

  snapshot(): SessionSnapshot {
    return {
      round: this.currentRound,
      phase: this.currentPhase,
      dealer: this.activeDealer.name,
      state: this.currentState,
    };
  }

  useDealer(name: string): void {
    this.activeDealer = this.dealers.get(name);
  }

  play(action: PlayAction): GameState | null {
    if (!this.inStage) return null;
    const next = this.activeDealer.play(this.currentState, action);
    if (next) this.currentState = next;
    return next;
  }

  discard(cardId: string): GameState | null {
    if (!this.inStage) return null;
    const next = this.activeDealer.discard(this.currentState, cardId);
    if (next) this.currentState = next;
    return next;
  }

  /**
   * Refill the hand. Drawn cards go at `slot` (the gap left by the card just played or
   * discarded) so the hand keeps its order; without a slot they go at the end.
   */
  refillHand(slot?: number): CardBlock[] {
    if (!this.inStage) return [];
    const before = this.currentState.hand;
    const result = this.activeDealer.refillHand(this.currentState, this.random);
    this.currentState =
      slot === undefined
        ? result.state
        : { ...result.state, hand: insertAt(before, slot, result.drawn) };
    return result.drawn;
  }

  /**
   * Move a hand card to another position. Not a play or discard: no counters, score,
   * deck or card identity change. Returns false for an invalid move.
   */
  reorderHand(from: number, to: number): boolean {
    const hand = moveItem(this.currentState.hand, from, to);
    if (!hand) return false;
    this.currentState = { ...this.currentState, hand };
    return true;
  }

  /**
   * Move on once the current stage is decided: a win goes to the next stage, or to the
   * shop after the boss stage; a loss ends the session. Returns false while still playing.
   */
  advance(): boolean {
    if (!this.inStage) return false;
    const outcome = roundOutcome(this.currentState);
    if (outcome === "playing") return false;
    if (outcome === "lost") {
      this.currentPhase = "over";
      return true;
    }
    const next = stageKinds[stageKinds.indexOf(this.currentPhase as StageKind) + 1];
    if (next) {
      this.startStage(next);
    } else {
      this.currentState = this.clearTable(this.currentState);
      this.currentPhase = "shop";
    }
    return true;
  }

  /** Leave the shop for stage 1 of the next round. */
  leaveShop(): boolean {
    if (this.currentPhase !== "shop") return false;
    this.currentRound++;
    if (this.config.discardPileAfterShop === "return-to-deck") {
      const { deck, discardPile } = this.currentState;
      this.currentState = {
        ...this.currentState,
        deck: [...deck, ...discardPile],
        discardPile: [],
      };
    }
    this.startStage("stage-1");
    return true;
  }

  private startStage(kind: StageKind): void {
    const setup = this.config.stage(this.currentRound, kind);
    this.activeDealer = this.dealers.get(setup.dealer);
    this.currentState = this.activeDealer.startStage(
      this.clearTable(this.currentState),
      setup,
      this.random,
    );
    this.currentPhase = kind;
  }

  /** Return the field and, under the current hand policy, the hand to the deck. */
  private clearTable(state: GameState): GameState {
    const returned = [
      ...state.field.map(({ block }) => block),
      ...(this.config.handAtStageEnd === "return-to-deck" ? state.hand : []),
    ];
    return {
      ...state,
      field: [],
      hand: this.config.handAtStageEnd === "return-to-deck" ? [] : state.hand,
      deck: [...state.deck, ...returned],
    };
  }
}
