import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { roundOutcome, type Dealer } from "./dealer";
import type { GameState, PlayAction } from "./game-state";
import { moveItem } from "./zones";
import { ledgerTotal, stageRewardLedger, type StageReward } from "./stage-rewards";
import { emptyRunStats, recordPlay, recordRoundComplete, type RunStats } from "./run-stats";
import {
  defaultPassivePrices,
  stageKinds,
  type PassivePrices,
  type SessionConfig,
  type StageKind,
} from "./session-config";
import {
  createPassiveBlock,
  PassiveEventQueue,
  passiveDefinitions,
  randomPassiveDefinitions,
  type PassiveBlock,
} from "./passives";
import { discardPassiveEffects, scoreFieldWithPassives } from "./passive-effects";
import type { ScoredLine } from "./scoring";
import type { ShopOffer } from "./shop-stock";

/** Where a session is: one of a round's three stages, the shop, or finished after a loss. */
export type Phase = StageKind | "shop" | "over";

/** What a future save/Continue flow needs to restore a session. */
export type SessionSnapshot = {
  round: number;
  phase: Phase;
  /** Stage that opened this shop; absent in older saves, which only had boss shops. */
  shopAfter?: StageKind;
  dealer: string;
  state: GameState;
  /** Run totals for the game over screen; older saves have none (zeros). */
  stats?: RunStats;
  /** The last stage paid out (round:phase) and what it paid, so it never pays twice. */
  rewarded?: { stage: string; reward: StageReward };
};

/**
 * Controls one game attempt: each stage → shop → next stage (or round).
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
  private shopAfter: StageKind | null = null;
  private runStats: RunStats = emptyRunStats;
  private readonly passiveEvents = new PassiveEventQueue();
  private scoredLines: ScoredLine[] = [];
  private rewarded: { stage: string; reward: StageReward } | null = null;

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
    session.shopAfter = snapshot.phase === "shop" ? (snapshot.shopAfter ?? "boss") : null;
    session.runStats = snapshot.stats ?? emptyRunStats;
    session.rewarded = snapshot.rewarded ?? null;
    session.passiveEvents.syncRack(snapshot.state.passiveRack);
    return session;
  }

  get dealer(): Dealer {
    return this.activeDealer;
  }

  get state(): GameState {
    return this.currentState;
  }

  /** Developer console adjustment; never lets the persistent balance go below zero. */
  adjustCoins(delta: number): number {
    if (!Number.isSafeInteger(delta)) throw new Error("coin adjustment must be an integer");
    const coins = Math.max(0, this.currentState.coins + delta);
    this.currentState = { ...this.currentState, coins };
    return coins;
  }

  get round(): number {
    return this.currentRound;
  }

  get phase(): Phase {
    return this.currentPhase;
  }

  get shopAfterStage(): StageKind | null {
    return this.shopAfter;
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
      ...(this.shopAfter ? { shopAfter: this.shopAfter } : {}),
      dealer: this.activeDealer.name,
      state: this.currentState,
      stats: this.runStats,
      ...(this.rewarded ? { rewarded: this.rewarded } : {}),
    };
  }

  /**
   * Pay a won stage's rewards (issue #12): the completion bonus, then passives in rack
   * order. Pays once per stage: asking again, after a reload or a second Continue, returns
   * the same reward without adding coins. Null unless the current stage is won.
   */
  claimStageRewards(): StageReward | null {
    if (!this.inStage || roundOutcome(this.currentState) !== "won") return null;
    const stage = `${this.currentRound}:${this.currentPhase}`;
    if (this.rewarded?.stage === stage) return this.rewarded.reward;
    const entries = stageRewardLedger(this.currentState, this.config.stageReward);
    const balanceBefore = this.currentState.coins;
    const balance = balanceBefore + ledgerTotal(entries);
    this.currentState = { ...this.currentState, coins: balance };
    this.rewarded = { stage, reward: { entries, balanceBefore, balance } };
    return this.rewarded.reward;
  }

  useDealer(name: string): void {
    this.activeDealer = this.dealers.get(name);
  }

  /** Install a block in the ordered rack and update its event subscriptions. */
  installPassive(block: PassiveBlock): boolean {
    if (block.traits.rackResident?.zone !== "passive-rack") return false;
    // A full rack takes no more (its capacity comes from the room's passive rack trait).
    if (this.currentState.passiveRack.length >= this.rackCapacity) return false;
    if (this.currentState.passiveRack.some(({ id }) => id === block.id)) return false;
    this.currentState = {
      ...this.currentState,
      passiveRack: [...this.currentState.passiveRack, block],
    };
    this.passiveEvents.syncRack(this.currentState.passiveRack);
    return true;
  }

  /** How many passives the rack can hold (Infinity when the session sets no limit). */
  get rackCapacity(): number {
    return this.config.rackCapacity ?? Infinity;
  }

  /** A stage is won but its rewards are not yet paid (see claimStageRewards). */
  get stageRewardsPending(): boolean {
    if (!this.inStage || roundOutcome(this.currentState) !== "won") return false;
    return this.rewarded?.stage !== `${this.currentRound}:${this.currentPhase}`;
  }

  /** What passives cost and sell for in this session. */
  get passivePrices(): PassivePrices {
    return this.config.passivePrices ?? defaultPassivePrices;
  }

  /**
   * Sell an installed passive (issue #16): remove that exact block from the rack and add its
   * sell value to the coins. Not a discard: no discard pile, plays or discards are touched.
   * Possible at any time in a run (not after it is over). Returns the coins gained, or null
   * when nothing was sold (unknown block, or the run is over).
   */
  sellPassive(passiveId: string): number | null {
    if (this.currentPhase === "over") return null;
    // A won stage's rewards are fixed first: selling a passive that pays on a stage win
    // before the payout would quietly lose its row.
    if (this.stageRewardsPending) return null;
    const rack = this.currentState.passiveRack;
    if (!rack.some(({ id }) => id === passiveId)) return null;
    const price = this.passivePrices.sell;
    // A bad price policy must not corrupt the balance (a save would then not load).
    if (!Number.isSafeInteger(price) || price < 0) return null;
    this.currentState = {
      ...this.currentState,
      passiveRack: rack.filter(({ id }) => id !== passiveId),
      coins: this.currentState.coins + price,
    };
    this.passiveEvents.syncRack(this.currentState.passiveRack);
    return price;
  }

  /** Buy an offer into the appropriate rack. A refused drop leaves the state untouched. */
  buyShopOffer(id: string, destination: "hand" | "passive-rack"): ShopOffer | null {
    if (this.currentPhase !== "shop") return null;
    const offer = this.currentState.shopStock?.find(({ block }) => block.id === id);
    if (!offer) return null;
    const price =
      offer.kind === "passive" ? this.passivePrices.buy : (this.config.cardPurchasePrice ?? 1);
    if (!Number.isSafeInteger(price) || price < 0 || this.currentState.coins < price) return null;
    if (offer.kind === "passive") {
      if (
        destination !== "passive-rack" ||
        this.currentState.passiveRack.length >= this.rackCapacity
      )
        return null;
      this.currentState = {
        ...this.currentState,
        passiveRack: [...this.currentState.passiveRack, offer.block],
        shopStock: this.currentState.shopStock!.filter(({ block }) => block.id !== id),
        coins: this.currentState.coins - price,
      };
      this.passiveEvents.syncRack(this.currentState.passiveRack);
    } else {
      if (destination !== "hand" || this.currentState.hand.length >= this.activeDealer.handSize)
        return null;
      this.currentState = {
        ...this.currentState,
        hand: [...this.currentState.hand, offer.block],
        shopStock: this.currentState.shopStock!.filter(({ block }) => block.id !== id),
        coins: this.currentState.coins - price,
      };
    }
    return offer;
  }

  /** Retire legacy definitions, then fill empty slots while keeping active blocks in order. */
  fillPassiveRack(targetSize: number): void {
    const active = this.currentState.passiveRack.filter(
      ({ definitionId }) => !passiveDefinitions.get(definitionId).retired,
    );
    if (active.length !== this.currentState.passiveRack.length) {
      this.currentState = { ...this.currentState, passiveRack: active };
      this.passiveEvents.syncRack(active);
    }
    const missing = Math.max(
      0,
      Math.min(targetSize, this.rackCapacity) - this.currentState.passiveRack.length,
    );
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
      this.runStats = recordPlay(this.runStats, gained, action.cardIds?.length || 1);
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

  /** Refill up to the dealer's hand size, appending new cards after the survivors. */
  refillHand(): CardBlock[] {
    if (!this.inStage) return [];
    const result = this.activeDealer.refillHand(this.currentState, this.random);
    this.currentState = result.state;
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
   * Move on once the current stage is decided: a win opens its shop; a loss ends the
   * session. Returns false while still playing.
   */
  advance(): boolean {
    if (!this.inStage) return false;
    const outcome = roundOutcome(this.currentState);
    if (outcome === "playing") return false;
    if (outcome === "lost") {
      this.currentPhase = "over";
      return true;
    }
    // A won stage always pays before it is left (once; see claimStageRewards).
    this.claimStageRewards();
    this.shopAfter = this.currentPhase as StageKind;
    this.currentState = this.clearTable(this.currentState);
    this.currentPhase = "shop";
    if (this.shopAfter === "boss") this.runStats = recordRoundComplete(this.runStats);
    return true;
  }

  /** Leave a shop for the next stage, or stage 1 of the next round after a boss. */
  leaveShop(): boolean {
    if (this.currentPhase !== "shop") return false;
    const completed = this.shopAfter ?? "boss";
    // The sandbox's unbought card offers were borrowed from the deck, so return them.
    this.currentState = {
      ...this.currentState,
      deck: [
        ...this.currentState.deck,
        ...(this.currentState.shopStock ?? [])
          .filter((offer): offer is Extract<ShopOffer, { kind: "card" }> => offer.kind === "card")
          .map(({ block }) => block),
      ],
      // Undefined means a later shop will generate fresh stock, including after a skip.
      shopStock: undefined,
    };
    if (completed === "boss" && this.config.discardPileAfterShop === "return-to-deck") {
      const { deck, discardPile } = this.currentState;
      this.currentState = {
        ...this.currentState,
        deck: [...deck, ...discardPile],
        discardPile: [],
      };
    }
    const next = stageKinds[stageKinds.indexOf(completed) + 1];
    if (!next) this.currentRound++;
    this.shopAfter = null;
    this.startStage(next ?? "stage-1");
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
