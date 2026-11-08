import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { roundOutcome, type Dealer } from "./dealer";
import type { GameState, PlayAction } from "./game-state";
import { fillSlots, insertAt, moveItem } from "./zones";
import { emptyRunStats, recordPlay, recordRoundComplete, type RunStats } from "./run-stats";
import { stageKinds, type SessionConfig, type StageKind } from "./session-config";
import {
  createPassiveBlock,
  PassiveEventQueue,
  randomPassiveDefinitions,
  type PassiveBlock,
} from "./passives";
import { discardPassiveEffects, scoreFieldWithPassives } from "./passive-effects";
import type { ScoredLine } from "./scoring";

/** Where a session is: one of a round's three stages, the shop, or finished after a loss. */
export type Phase = StageKind | "shop" | "over";

/** What a future save/Continue flow needs to restore a session. */
export type SessionSnapshot = {
  round: number;
  phase: Phase;
  dealer: string;
  state: GameState;
  /** Run totals for the game over screen; older saves have none (zeros). */
  stats?: RunStats;
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
  private runStats: RunStats = emptyRunStats;
  private readonly passiveEvents = new PassiveEventQueue();
  private scoredLines: ScoredLine[] = [];

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
    this.passiveEvents.syncRack(this.currentState.passiveRack);
    this.passiveEvents.emit({ type: "stage.started" });
    this.passiveEvents.drain();
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
    session.runStats = snapshot.stats ?? emptyRunStats;
    session.passiveEvents.syncRack(snapshot.state.passiveRack);
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

  get stats(): RunStats {
    return this.runStats;
  }

  /** Final results from the last play, shared by the stage total and presentation. */
  get lastScoredLines(): readonly ScoredLine[] {
    return this.scoredLines;
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
      stats: this.runStats,
    };
  }

  useDealer(name: string): void {
    this.activeDealer = this.dealers.get(name);
  }

  /** Install a block in the ordered rack and update its event subscriptions. */
  installPassive(block: PassiveBlock): boolean {
    if (block.traits.rackResident?.zone !== "passive-rack") return false;
    if (this.currentState.passiveRack.some(({ id }) => id === block.id)) return false;
    this.currentState = {
      ...this.currentState,
      passiveRack: [...this.currentState.passiveRack, block],
    };
    this.passiveEvents.syncRack(this.currentState.passiveRack);
    return true;
  }

  /** Fill empty rack slots from unowned definitions, keeping existing blocks in order. */
  fillPassiveRack(targetSize: number): void {
    const missing = Math.max(0, targetSize - this.currentState.passiveRack.length);
    const owned = this.currentState.passiveRack.map(({ definitionId }) => definitionId);
    for (const definition of randomPassiveDefinitions(missing, this.random, owned)) {
      let serial = this.currentState.passiveRack.length + 1;
      while (this.currentState.passiveRack.some(({ id }) => id === `passive.${serial}`)) serial++;
      this.installPassive(createPassiveBlock(definition.id, `passive.${serial}`));
    }
  }

  play(action: PlayAction): GameState | null {
    if (!this.inStage) return null;
    const next = this.activeDealer.play(this.currentState, action);
    if (next) {
      this.scoredLines = scoreFieldWithPassives(next.field, next.passiveRack);
      const gained = this.scoredLines.reduce((sum, line) => sum + line.points, 0);
      this.runStats = recordPlay(this.runStats, gained);
      this.currentState = {
        ...next,
        round: { ...next.round, score: this.currentState.round.score + gained },
      };
      // The current dealer scores in play(); this is a post-play event until
      // placement and scoring are separated by the gameplay coordinator.
      this.passiveEvents.emit({ type: "play.completed", blockId: action.cardId });
      this.passiveEvents.drain();
    }
    return next ? this.currentState : null;
  }

  /** Discard one card, or several as one discard. */
  discard(cardIds: string | readonly string[]): GameState | null {
    if (!this.inStage) return null;
    const ids = new Set(typeof cardIds === "string" ? [cardIds] : cardIds);
    const discarded = this.currentState.hand.filter(({ id }) => ids.has(id));
    const next = this.activeDealer.discard(this.currentState, cardIds);
    if (next) {
      this.currentState = next;
      this.passiveEvents.emit({
        type: "discard.completed",
        cardIds: discarded.map(({ id }) => id),
      });
      this.passiveEvents.drain(128, (block, event) => {
        if (event.type !== "discard.completed") return [];
        const { coins, grants } = discardPassiveEffects(block, discarded);
        if (coins)
          this.currentState = { ...this.currentState, coins: this.currentState.coins + coins };
        const followups = [];
        for (let index = 0; index < grants; index++) {
          const owned = this.currentState.passiveRack.map(({ definitionId }) => definitionId);
          const chosen = randomPassiveDefinitions(1, this.random, owned)[0];
          if (!chosen) break;
          let serial = this.currentState.passiveRack.length + 1;
          while (this.currentState.passiveRack.some(({ id }) => id === `passive.${serial}`))
            serial++;
          const id = `passive.${serial}`;
          this.installPassive(createPassiveBlock(chosen.id, id));
          followups.push({ type: "passive.installed", blockId: id });
        }
        return followups;
      });
    }
    return next ? this.currentState : null;
  }

  /**
   * Refill the hand up to the dealer's hand size. Drawn cards go at `slot` (the gap left by
   * the card just played or discarded), or into each of several gaps in turn, so the hand
   * keeps its order; without a slot they go at the end.
   */
  refillHand(slot?: number | readonly number[]): CardBlock[] {
    if (!this.inStage) return [];
    const before = this.currentState.hand;
    // The dealer decides how many to draw (its hand size); the session decides where.
    const result = this.activeDealer.refillHand(this.currentState, this.random);
    const hand =
      slot === undefined
        ? result.state.hand
        : typeof slot === "number"
          ? insertAt(before, slot, result.drawn)
          : fillSlots(before, slot, result.drawn);
    this.currentState = { ...result.state, hand };
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
   * Developer shortcut (console `win` and `lose`): decide the current stage now, by
   * meeting its target score or by spending its last play. False outside a stage.
   */
  forceOutcome(outcome: "won" | "lost"): boolean {
    if (!this.inStage) return false;
    const { round } = this.currentState;
    this.currentState = {
      ...this.currentState,
      round:
        outcome === "won"
          ? { ...round, score: Math.max(round.score, round.targetScore) }
          : { ...round, score: Math.min(round.score, round.targetScore - 1), movesLeft: 0 },
    };
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
      this.runStats = recordRoundComplete(this.runStats);
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
    this.passiveEvents.syncRack(this.currentState.passiveRack);
    this.passiveEvents.emit({ type: "stage.started" });
    this.passiveEvents.drain();
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
