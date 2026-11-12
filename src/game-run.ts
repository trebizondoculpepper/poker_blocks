import { resetStageState } from "./stage-end";
import { resetRoundState } from "./round-end";
import { clearField } from "./card-ownership";
// Registers the spawn-beyond-pair reaction result (#425).
import "./pair-spawn";
// Registers cooking's stage-end reset (#372).
import "./cooking";
// Registers the `trigger-block` rule command (#433).
import "./triggers";
// Registers the self-destruct and trigger-targets responses (#435).
import "./trigger-responses";
import { commitReactions, type AppliedReaction } from "./reactions";
import { commitCountdowns } from "./trigger-countdown";
import { setCardStateBonus } from "./state-bonuses";
import { applyRackItem } from "./rack-item-effects";
import type { BlockMaterial } from "./materials";
import { changeCardMaterial } from "./card-material";
import type { CardBlock } from "./cards";
import { resaleValue } from "./resale";
import { blockCanDestroy } from "./block-trait-behaviours";
import { Registry } from "./core/registry";
import { roundOutcome, type Dealer } from "./dealer";
import type { GameState, PlacedBlock, PlayAction } from "./game-state";
import type { DestroyCause } from "./traits/destructible";
import { moveItem } from "./zones";
import {
  ledgerTotal,
  materialHandRewardEntries,
  materialFieldRewardEntries,
  stageRewardLedger,
  type StageReward,
} from "./stage-rewards";
import { emptyRunStats, recordPlay, recordRoundComplete, type RunStats } from "./run-stats";
import { stageKinds, type RunRules, type StageKind } from "./run-rules";
import {
  createPassiveBlock,
  PassiveEventQueue,
  passiveDefinitions,
  randomPassiveDefinitions,
  type GameEvent,
  type PassiveBlock,
  type StageContext,
} from "./passives";
import {
  passiveActivations,
  scoreFieldWithPassives,
  type PassiveScoredLine,
  type RuleActivation,
} from "./passive-effects";
import { commitCommands, type CommandTarget } from "./rule-commands";
import type { RandomCursor } from "./random";
import {
  ActionContext,
  ActionLedger,
  defaultResolutionLimits,
  type EventEnvelope,
} from "./lifecycle/action";

/** What a session's random stream offers for rolling an action's draws back (#657). */
export type RandomCheckpoints = {
  checkpoint(): { state: number; draws: number };
  restore(mark: { state: number; draws: number }): void;
};
import { offerKind, type OfferDestination, type OfferRun, type ShopOffer } from "./offer-kinds";

/** Where a run is: one of a round's three stages, the shop, or finished after a loss. */
export type RunPhase = StageKind | "shop" | "over";
/** A position outcome describes the run without naming any scene. */
export type RunPositionOutcome = `run.position.${RunPhase}`;
/**
 * Every outcome a mode's game flow places a scene for: the run's position, and a won stage
 * whose rewards have been paid (the stage-won presentation, #91).
 */
export type RunFlowOutcome = RunPositionOutcome | "run.stage.won";

/** What a future save/Continue flow needs to restore a run. */
export type RunSnapshot = {
  round: number;
  phase: RunPhase;
  /** Stage that opened this shop; absent in older saves, which only had boss shops. */
  shopAfter?: StageKind;
  dealer: string;
  state: GameState;
  /** Run totals for the game over screen; older saves have none (zeros). */
  stats?: RunStats;
  /** The last stage paid out (round:phase) and what it paid, so it never pays twice. */
  rewarded?: { stage: string; reward: StageReward };
  /** The seed a run setup step dealt this run's deck from, so Continue rebuilds the same deck. */
  seed?: number;
  /**
   * The session's random seed and how far its sequence had reached, so Continue resumes the
   * same sequence rather than replaying it (#134).
   */
  random?: RandomCursor;
};

/**
 * Controls one game attempt: each stage → shop → next stage (or round).
 * It keeps the current facts while a registered dealer, chosen per stage, applies the rules.
 */
export class GameRun {
  private readonly dealers: Registry<Dealer>;
  private readonly config: RunRules;
  private random: () => number;
  private activeDealer: Dealer;
  private currentState: GameState;
  private currentRound = 1;
  private currentPhase: RunPhase = "stage-1";
  private shopAfter: StageKind | null = null;
  private runStats: RunStats = emptyRunStats;
  private readonly passiveEvents = new PassiveEventQueue();
  private scoredLines: PassiveScoredLine[] = [];
  /** The rules that fired during the last discard, in the order they resolved (#81). */
  private discardActivations: RuleActivation[] = [];
  private discardEvents: readonly GameEvent[] = [];
  private rewarded: { stage: string; reward: StageReward } | null = null;
  private randomCursor: RandomCursor | undefined;
  private runSeed: number | undefined;
  /** The stage (round:phase) whose final stage.won or stage.lost has been emitted. */
  private decidedStage: string | null = null;
  /** Rewinds the session's random stream when an action rolls back (#657); none in tests. */
  private randomCheckpoints: RandomCheckpoints | null = null;
  /** Resolved action IDs, so a duplicate submission is rejected (#657). */
  private readonly actions = new ActionLedger();
  /** Bumped by every committed action: the version a captured fact describes. */
  private version = 0;
  private lastFacts: readonly EventEnvelope[] = [];
  /** The action resolving now, if any: every drain and command inside it shares its budget. */
  private activeAction: { context: ActionContext; phase: string } | null = null;
  private lastFailure: Error | null = null;

  constructor(
    dealers: Registry<Dealer>,
    config: RunRules,
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
    this.lifecycle("stage.started");
  }

  /** Resume a saved run exactly where it was. Validate the snapshot first (see save.ts). */
  static fromSnapshot(
    dealers: Registry<Dealer>,
    config: RunRules,
    cards: readonly CardBlock[],
    snapshot: RunSnapshot,
    random: () => number = Math.random,
  ): GameRun {
    // Hydrating replaces the dealt state wholesale, so the constructor's deal must not touch
    // the restored stream: drawing a hand that is thrown away would move the resume several steps
    // on and make Continue differ from uninterrupted play (#134). `random` is attached after.
    const session = new GameRun(dealers, config, cards, () => 0);
    session.random = random;
    session.activeDealer = dealers.get(snapshot.dealer);
    session.currentState = snapshot.state;
    session.currentRound = snapshot.round;
    session.currentPhase = snapshot.phase;
    // A shop snapshot names the stage before it; older ones that left it out followed the
    // round's last stage, the only stage that had a shop then.
    session.shopAfter = snapshot.phase === shopPosition ? (snapshot.shopAfter ?? finalStage) : null;
    session.runStats = snapshot.stats ?? emptyRunStats;
    session.rewarded = snapshot.rewarded ?? null;
    session.runSeed = snapshot.seed;
    session.randomCursor = snapshot.random;
    session.passiveEvents.syncRack(snapshot.state.passiveRack);
    // A stage saved after it was decided already announced its outcome.
    session.decidedStage =
      session.inStage && roundOutcome(snapshot.state) !== "playing" ? session.stageKey : null;
    session.stockEmptyShop();
    return session;
  }

  /** Let failed actions rewind the session's random stream with them (#657). */
  attachRandomCheckpoints(checkpoints: RandomCheckpoints): void {
    this.randomCheckpoints = checkpoints;
  }

  /** The facts the last committed action recorded, in order, each in its envelope (#657). */
  get actionFacts(): readonly EventEnvelope[] {
    return this.lastFacts;
  }

  /** Why the last action failed and was rolled back, if it did (diagnostics only). */
  get actionFailure(): Error | null {
    return this.lastFailure;
  }

  /**
   * Resolve one action as a transaction (#657; doc/game-events.md, "Delivery order, cascades and
   * failure"): its state changes, rewards, use consumption and random draws are staged, and an
   * error rolls all of them back together and publishes nothing; the failure is kept for
   * diagnostics. A duplicate action ID is rejected without effect. `body` returns null for an
   * invalid action, which consumes nothing.
   */
  private transact<T>(
    kind: string,
    actionId: string | undefined,
    body: (action: ActionContext) => T | null,
  ): T | null {
    const id = actionId ?? this.actions.next(kind);
    if (this.actions.has(id)) return null;
    // The run's own fields as they are now (its state is immutable; arrays are replaced, not
    // mutated), restored wholesale if the action fails.
    const saved = Object.fromEntries(Object.entries(this));
    const mark = this.randomCheckpoints?.checkpoint();
    const action = new ActionContext(
      id,
      this.version,
      this.config.resolutionLimits ?? defaultResolutionLimits,
    );
    try {
      this.activeAction = { context: action, phase: kind };
      const result = body(action);
      this.activeAction = null;
      if (result === null) return null;
      this.actions.remember(id);
      this.version++;
      this.lastFacts = action.facts;
      this.lastFailure = null;
      return result;
    } catch (error) {
      // Everything back as it was: the run's own fields, the queued events and the stream.
      Object.assign(this, saved);
      this.passiveEvents.clear();
      this.passiveEvents.syncRack(this.currentState.passiveRack);
      if (mark !== undefined) this.randomCheckpoints!.restore(mark);
      this.lastFailure = error instanceof Error ? error : new Error(String(error));
      this.activeAction = null;
      return null;
    }
  }

  /** The action's budget, in the shape the passive event queue counts against. */
  private budgetFor(action: ActionContext, phase: string) {
    return {
      deliver: (event: { type: string }, ancestry: readonly string[]) =>
        action.deliver(event, phase, ancestry),
      operate: (registration: string, ancestry: readonly string[]) =>
        action.operate(registration, phase, ancestry),
    };
  }

  /** Record the events an action delivered as its facts, in delivery order. */
  private recordDelivered(action: ActionContext, phase: string, delivered: readonly GameEvent[]) {
    // Each fact names the fact it answered, from the parent the queue kept as it queued it
    // (#661 review); a fact from an earlier drain of this action is found the same way.
    for (const event of delivered) {
      const cause = this.passiveEvents.parentOf(event);
      const envelope = action.record(event.type, event, {
        phase,
        parent: cause ? this.recordedFacts.get(cause) : null,
        subjectIds: [event.blockId ?? [], ...(event.cardIds ?? [])].flat(),
      });
      this.recordedFacts.set(event, envelope);
    }
  }

  /** The envelope recorded for each delivered event, so a follow-up can name its parent. */
  private recordedFacts = new WeakMap<GameEvent, EventEnvelope>();

  get dealer(): Dealer {
    return this.activeDealer;
  }

  get state(): GameState {
    return this.currentState;
  }

  /**
   * Destroy a block on the field, if its destructible trait allows `cause`. It costs no
   * play or discard and does not change the score; the block leaves a gap (nothing
   * settles) and goes to the discard pile, so a saved run still accounts for every card. Emits `block.destroyed`, not a discard event. Returns the removed block, or null when refused.
   */
  destroyBlock(blockId: string, cause: DestroyCause): PlacedBlock | null {
    const placed = this.currentState.field.find(({ block }) => block.id === blockId);
    if (!placed || !blockCanDestroy(placed.block, cause)) return null;
    this.currentState = {
      ...this.currentState,
      field: this.currentState.field.filter((other) => other !== placed),
      // Out of play like a discard (and back in the deck when the discard pile returns).
      discardPile: [...this.currentState.discardPile, placed.block],
    };
    this.lifecycle("block.destroyed", { blockId });
    return placed;
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

  get phase(): RunPhase {
    return this.currentPhase;
  }

  get positionOutcome(): RunPositionOutcome {
    return `run.position.${this.currentPhase}`;
  }

  get shopAfterStage(): StageKind | null {
    return this.shopAfter;
  }

  get stats(): RunStats {
    return this.runStats;
  }

  /** Final results from the last play, shared by the stage total and presentation. */
  get lastScoredLines(): readonly PassiveScoredLine[] {
    return this.scoredLines;
  }

  /** What the last discard committed, in order: the events presentation plays (#538). */
  get lastDiscardEvents(): readonly GameEvent[] {
    return this.discardEvents;
  }

  /** The rules that fired during the last discard, for presentation (#81). */
  get lastDiscardActivations(): readonly RuleActivation[] {
    return this.discardActivations;
  }

  get inStage(): boolean {
    return (stageKinds as readonly string[]).includes(this.currentPhase);
  }

  /** The run has moved on to a shop between stages. */
  get inShop(): boolean {
    return this.shopAfter !== null;
  }

  /**
   * The stage lifecycle events refer to: the current stage, or in a shop the stage that
   * opened it. Null after the run is over.
   */
  get stageContext(): StageContext | null {
    const kind = this.inStage ? (this.currentPhase as StageKind) : this.shopAfter;
    return kind ? { round: this.currentRound, kind, dealer: this.activeDealer.name } : null;
  }

  private get stageKey(): string {
    return `${this.currentRound}:${this.currentPhase}`;
  }

  /** Emit a lifecycle event with the stage context and let the rack respond, in rack order. */
  private lifecycle(type: string, extra: Omit<GameEvent, "type" | "stage"> = {}): void {
    const stage = this.stageContext;
    this.passiveEvents.emit({ type, ...(stage ? { stage } : {}), ...extra });
    // Inside an action (a play's or discard's outcome), delivery shares its budget and records
    // its facts with it (#661 review); outside one (leaving the shop), it drains as before.
    const action = this.activeAction;
    const delivered = this.passiveEvents.drain(
      undefined,
      undefined,
      action ? this.budgetFor(action.context, action.phase) : undefined,
    );
    if (action) this.recordDelivered(action.context, action.phase, delivered);
  }

  /** Once a stage is decided, announce the final stage.won or stage.lost exactly once. */
  private announceOutcome(): void {
    if (!this.inStage || this.decidedStage === this.stageKey) return;
    const outcome = roundOutcome(this.currentState);
    if (outcome === "playing") return;
    this.decidedStage = this.stageKey;
    this.lifecycle(outcome === "won" ? "stage.won" : "stage.lost");
  }

  /** Where the session's random sequence has reached, recorded with the run (#134). */
  setRandomCursor(cursor: RandomCursor): void {
    this.randomCursor = cursor;
  }

  snapshot(): RunSnapshot {
    return {
      round: this.currentRound,
      phase: this.currentPhase,
      ...(this.shopAfter ? { shopAfter: this.shopAfter } : {}),
      dealer: this.activeDealer.name,
      state: this.currentState,
      stats: this.runStats,
      ...(this.rewarded ? { rewarded: this.rewarded } : {}),
      ...(this.runSeed === undefined ? {} : { seed: this.runSeed }),
      ...(this.randomCursor === undefined ? {} : { random: this.randomCursor }),
    };
  }

  /**
   * Pay a decided stage once: a win gives the completion bonus, held-material rewards and
   * stage-win passives; a loss gives held-material rewards only. A repeat returns the saved
   * ledger without adding coins. Null while the stage is still playing.
   */
  claimStageRewards(): StageReward | null {
    if (!this.inStage) return null;
    const outcome = roundOutcome(this.currentState);
    if (outcome === "playing") return null;
    // The final stage.won always comes before its reward.finalized.
    this.announceOutcome();
    const stage = this.stageKey;
    if (this.rewarded?.stage === stage) return this.rewarded.reward;
    // Passive rewards read the state before payment: an interest rule sees balanceBefore.
    const entries =
      outcome === "won"
        ? stageRewardLedger(
            this.currentState,
            this.config.stageReward,
            this.currentPhase as StageKind,
          )
        : [
            ...materialHandRewardEntries(this.currentState),
            ...materialFieldRewardEntries(this.currentState),
          ];
    if (outcome === "lost" && entries.length === 0) return null;
    const balanceBefore = this.currentState.coins;
    const balance = balanceBefore + ledgerTotal(entries);
    this.currentState = { ...this.currentState, coins: balance };
    this.rewarded = { stage, reward: { entries, balanceBefore, balance } };
    this.lifecycle("reward.finalized", {
      reward: { coins: balance - balanceBefore, balanceBefore, balance },
    });
    return this.rewarded.reward;
  }

  useDealer(name: string): void {
    this.activeDealer = this.dealers.get(name);
  }

  /** Install a block in the ordered rack and update its event subscriptions. */
  installPassive(block: PassiveBlock): boolean {
    if (block.traits.rackResident?.zone !== "passive-rack") return false;
    // A full rack takes no more (its capacity comes from the mode's passive rack trait).
    if (this.currentState.passiveRack.length >= this.rackCapacity) return false;
    if (this.currentState.passiveRack.some(({ id }) => id === block.id)) return false;
    this.currentState = {
      ...this.currentState,
      passiveRack: [...this.currentState.passiveRack, block],
    };
    this.passiveEvents.syncRack(this.currentState.passiveRack);
    return true;
  }

  /** How many passives the rack can hold (Infinity when the run sets no limit). */
  get rackCapacity(): number {
    return this.config.rackCapacity ?? Infinity;
  }

  /** The current stage's paid rewards, once claimed (see claimStageRewards); else null. */
  get stageReward(): StageReward | null {
    return this.rewarded?.stage === this.stageKey ? this.rewarded.reward : null;
  }

  /**
   * Whether a passive may be sold now: not once the run is over, and not while a won stage's
   * rewards are unpaid (selling a passive that pays on a stage win before the payout would
   * quietly lose its row).
   */
  get canSellPassives(): boolean {
    return this.currentPhase !== "over" && !this.stageRewardsPending;
  }

  /** In a shop with no stock: stock it under the run's rules (none when they don't say how). */
  private stockEmptyShop(): void {
    if (!this.inShop || this.currentState.shopStock !== undefined) return;
    this.currentState = (this.config.stockShop ?? ((state) => state))(
      this.currentState,
      this.random,
      this.round,
    );
  }

  /** A stage is won but its rewards are not yet paid (see claimStageRewards). */
  get stageRewardsPending(): boolean {
    if (!this.inStage || roundOutcome(this.currentState) !== "won") return false;
    return this.rewarded?.stage !== `${this.currentRound}:${this.currentPhase}`;
  }

  /**
   * Sell an installed passive (issue #16): remove that exact block from the rack and add its
   * sell value to the coins. Not a discard: no discard pile, plays or discards are touched.
   * Possible at any time in a run (not after it is over). Returns the coins gained, or null
   * when nothing was sold (unknown block, or the run is over).
   */
  sellPassive(passiveId: string): number | null {
    if (!this.canSellPassives) return null;
    const rack = this.currentState.passiveRack;
    const passive = rack.find(({ id }) => id === passiveId);
    if (!passive) return null;
    // The resale policy prices it; a bad price must not corrupt the balance (a save would
    // then not load), so resaleValue refuses one with null.
    const price = resaleValue(passive, this.config.resaleModifiers);
    if (price === null) return null;
    this.currentState = {
      ...this.currentState,
      passiveRack: rack.filter(({ id }) => id !== passiveId),
      coins: this.currentState.coins + price,
    };
    this.passiveEvents.syncRack(this.currentState.passiveRack);
    return price;
  }

  /** What an offer's kind may read from the run to price and receive it (#67). */
  get offerRun(): OfferRun {
    return {
      round: this.round,
      rackCapacity: this.rackCapacity,
      handSize: this.activeDealer.handSize,
    };
  }

  /** Whether the coins held cover this shop offer's price (false for an offer not in stock). */
  canAfford(id: string): boolean {
    const offer = this.currentState.shopStock?.find(({ block }) => block.id === id);
    if (!offer) return false;
    const price = offerKind(offer).price(offer.block, this.offerRun);
    return Number.isSafeInteger(price) && price >= 0 && this.currentState.coins >= price;
  }

  /**
   * Buy an offer into the place its kind goes (the hand or the rack). Refused, leaving the state
   * untouched, when dropped elsewhere, unaffordable, or when it doesn't fit there.
   */
  /**
   * Why buying this offer by dropping it on `destination` would be refused (#481), or null when it
   * would succeed. Side-effect free, from the same rules `buyShopOffer` applies, in this order,
   * the first that applies winning: `closed` (not in the shop), `unknown-offer`,
   * `wrong-destination`, `unaffordable`, then the offer kind's own reason (`rack-full`,
   * `already-owned`, `locked`), else `refused`.
   */
  purchaseVerdict(id: string, destination: OfferDestination): { reason: string } | null {
    const offer = this.inShop
      ? this.currentState.shopStock?.find(({ block }) => block.id === id)
      : undefined;
    const kind = offer && offerKind(offer);
    const run = this.offerRun;
    const price = offer && kind ? kind.price(offer.block, run) : Number.NaN;
    const checks: (() => string | null)[] = [
      () => (this.inShop ? null : "closed"),
      () => (offer ? null : "unknown-offer"),
      () => (destination === kind!.destination ? null : "wrong-destination"),
      () =>
        Number.isSafeInteger(price) && price >= 0 && this.currentState.coins >= price
          ? null
          : "unaffordable",
      () => kind!.refusal?.(this.currentState, offer!.block, run) ?? null,
      () => (kind!.receive(this.currentState, offer!.block, run) ? null : "refused"),
    ];
    const reason = checks.reduce<string | null>((found, check) => found ?? check(), null);
    return reason ? { reason } : null;
  }

  buyShopOffer(id: string, destination: OfferDestination): ShopOffer | null {
    if (this.purchaseVerdict(id, destination)) return null;
    const offer = this.currentState.shopStock!.find(({ block }) => block.id === id)!;
    const kind = offerKind(offer);
    const run = this.offerRun;
    const price = kind.price(offer.block, run);
    const received = kind.receive(this.currentState, offer.block, run);
    if (!received) return null;
    this.currentState = {
      ...received,
      shopStock: received.shopStock?.filter(({ block }) => block.id !== id),
      coins: received.coins - price,
    };
    this.passiveEvents.syncRack(this.currentState.passiveRack);
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
      this.installPassive(createPassiveBlock(definition.id, this.freePassiveId()));
    }
  }

  /** What a fired rule's commands may change in this run (src/rule-commands.ts). */
  private readonly commandTarget: CommandTarget = ((run: GameRun) => ({
    get state() {
      return run.currentState;
    },
    update: (state: GameState) => void (run.currentState = state),
    grantUnownedPassive: () => run.grantUnownedPassive(),
    operate: (registration: string) =>
      run.activeAction?.context.operate(registration, run.activeAction.phase, []),
  }))(this);

  /** A passive instance id no installed passive has: `passive.<n>`, from the rack size up. */
  private freePassiveId(): string {
    const taken = new Set(this.currentState.passiveRack.map(({ id }) => id));
    let serial = this.currentState.passiveRack.length + 1;
    while (taken.has(`passive.${serial}`)) serial++;
    return `passive.${serial}`;
  }

  /** Install one random passive the rack doesn't hold; the event it causes, if any. */
  private grantUnownedPassive(): GameEvent[] {
    const owned = this.currentState.passiveRack.map(({ definitionId }) => definitionId);
    const chosen = randomPassiveDefinitions(1, this.random, owned)[0];
    if (!chosen) return [];
    const id = this.freePassiveId();
    // A full rack refuses it: nothing was installed, so nothing is reported (#566 review).
    if (!this.installPassive(createPassiveBlock(chosen.id, id))) return [];
    return [{ type: "passive.installed", blockId: id }];
  }

  /** The reactions the last play set off, in field order, for presentation (#366). */
  lastReactions: readonly AppliedReaction[] = [];

  /**
   * Play from the hand, resolved as one transaction (#657): invalid plays consume nothing; an
   * error anywhere in scoring, reactions or listeners rolls the whole play back. `actionId`
   * identifies the submission, so a duplicate is rejected.
   */
  play(action: PlayAction, actionId?: string): GameState | null {
    if (!this.inStage) return null;
    return this.transact("play", actionId, (context) => this.resolvePlay(action, context));
  }

  private resolvePlay(action: PlayAction, context: ActionContext): GameState | null {
    const next = this.activeDealer.play(this.currentState, action);
    if (next) {
      this.scoredLines = scoreFieldWithPassives(
        next.field,
        next.passiveRack,
        undefined,
        this.random,
        // Committed scoring counts against the play's budget (#661 review).
        (registration) => context.operate(registration, "play", []),
      );
      const gained = this.scoredLines.reduce((sum, line) => sum + line.points, 0);
      this.runStats = recordPlay(this.runStats, gained, action.cardIds?.length || 1);
      this.currentState = {
        ...next,
        round: { ...next.round, score: this.currentState.round.score + gained },
      };
      // Reactions (#366): resolved once, after scoring, so they never score this play; they
      // change the state later plays score.
      // Committed through the shared command path; only real changes are reported.
      this.lastReactions = commitReactions(this.commandTarget);
      // Countdowns (#434): only a committed play counts; a block reaching zero is triggered.
      const counted = commitCountdowns(
        this.commandTarget,
        new Set([action.cardId, ...(action.cardIds ?? [])]),
      );
      // The current dealer scores in play(); this is a post-play event until
      // placement and scoring are separated by the gameplay coordinator.
      this.passiveEvents.emit({ type: "play.completed", blockId: action.cardId });
      for (const { blockId, from, to } of this.lastReactions)
        this.passiveEvents.emit({ type: "reaction.applied", blockId, reaction: { from, to } });
      for (const event of counted) this.passiveEvents.emit(event);
      this.recordDelivered(
        context,
        "play",
        this.passiveEvents.drain(undefined, undefined, this.budgetFor(context, "play")),
      );
      this.announceOutcome();
    }
    return next ? this.currentState : null;
  }

  /**
   * Give one card a new material for the rest of the run (#387): in hand, on the field, in the
   * deck or discard pile, kept through later stages and saves. Null, changing nothing, when
   * the card isn't in the run or already has that material.
   */
  changeCardMaterial(cardId: string, material: BlockMaterial): GameState | null {
    const next = changeCardMaterial(this.currentState, cardId, material);
    if (next) this.currentState = next;
    return next;
  }

  /**
   * Give one card a state bonus (#365), replacing any it had, kept through later stages and
   * saves. Null, changing nothing, when the card isn't in the run or already has it.
   */
  setCardStateBonus(cardId: string, bonusId: string): GameState | null {
    const next = setCardStateBonus(this.currentState, cardId, bonusId);
    if (next) this.currentState = next;
    return next;
  }

  /**
   * Use a rack item on a card (#389): a transmogrifier changes its material. One use is spent;
   * an item with none left leaves the rack. Null, changing nothing, when it is refused.
   */
  applyRackItem(itemId: string, cardId: string): GameState | null {
    const next = applyRackItem(this.currentState, itemId, cardId);
    if (next) this.currentState = next;
    return next;
  }

  /** Discard one card, or several as one discard. */
  /** Discard from the hand, resolved as one transaction (#657); see `play`. */
  discard(cardIds: string | readonly string[], actionId?: string): GameState | null {
    if (!this.inStage) return null;
    return this.transact("discard", actionId, (context) => this.resolveDiscard(cardIds, context));
  }

  private resolveDiscard(
    cardIds: string | readonly string[],
    context: ActionContext,
  ): GameState | null {
    const ids = new Set(typeof cardIds === "string" ? [cardIds] : cardIds);
    const discarded = this.currentState.hand.filter(({ id }) => ids.has(id));
    const next = this.activeDealer.discard(this.currentState, cardIds);
    if (next) {
      this.currentState = next;
      this.passiveEvents.emit({
        type: "discard.completed",
        cardIds: discarded.map(({ id }) => id),
        blocks: discarded,
      });
      // Each listener's fired rules are committed as they resolve, left to right (#170).
      this.discardActivations = [];
      this.discardEvents = this.passiveEvents.drain(
        128,
        (block, event) => {
          const fired = passiveActivations(block, event);
          this.discardActivations.push(...fired);
          return commitCommands(
            fired.flatMap(({ commands }) => commands),
            this.commandTarget,
          );
        },
        this.budgetFor(context, "discard"),
      );
      this.recordDelivered(context, "discard", this.discardEvents);
      this.announceOutcome();
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
   * Move an installed passive to another rack slot (issue #4). Like a hand reorder this is not
   * a play, discard, sale or score: only the rack's order changes, and with it the order in
   * which passives resolve (scoring, rewards and events all read the rack left to right).
   * Refused once the run is over, like selling.
   */
  reorderPassive(from: number, to: number): boolean {
    if (this.currentPhase === "over") return false;
    const passiveRack = moveItem(this.currentState.passiveRack, from, to);
    if (!passiveRack) return false;
    this.currentState = { ...this.currentState, passiveRack };
    this.passiveEvents.syncRack(passiveRack);
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
    this.announceOutcome();
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
    this.announceOutcome();
    this.claimStageRewards();
    if (outcome === "lost") {
      this.currentPhase = "over";
      return true;
    }
    this.shopAfter = this.currentPhase as StageKind;
    this.currentState = this.clearTable(this.currentState);
    this.currentPhase = shopPosition;
    // The round's last stage completes the round; no stage is named for it.
    if (!nextStage(this.shopAfter)) this.runStats = recordRoundComplete(this.runStats);
    this.lifecycle("shop.entered");
    this.stockEmptyShop();
    return true;
  }

  /** Leave a shop for the next stage, or stage 1 of the next round after a boss. */
  leaveShop(): boolean {
    if (this.currentPhase !== "shop") return false;
    const completed = this.shopAfter ?? finalStage;
    const next = nextStage(completed);
    // Each unbought offer's kind says what leaving does with it (borrowed cards go back to the
    // deck). Undefined stock means a later shop generates fresh stock, including after a skip.
    const stock = this.currentState.shopStock ?? [];
    this.currentState = {
      ...stock.reduce(
        (state, offer) => offerKind(offer).unbought(state, offer.block),
        this.currentState,
      ),
      shopStock: undefined,
    };
    // Leaving the round's last shop ends the round, under the run's discard pile policy; then
    // round-scoped card state resets through its registered handlers (#383).
    if (!next)
      this.currentState = resetRoundState(
        discardPileAtRoundEnd[this.config.discardPileAfterShop](this.currentState),
      );
    this.lifecycle("shop.left");
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
    this.lifecycle("stage.started");
  }

  /** Return the field to the deck, and the hand as the run's hand policy says. */
  private clearTable(state: GameState): GameState {
    // Stage-scoped card state (doneness, #372) resets through its registered handlers; the
    // stage's rewards have been read by now.
    const reset = resetStageState(state);
    // Each field card goes to its owner (#424): the deck's back to the deck, a generated
    // card out of play.
    const cleared = clearField(reset);
    return handAtStageEnd[this.config.handAtStageEnd](cleared);
  }
}

/** The run position between stages. Its own until phases leave GameRun (#36). */
const shopPosition: RunPhase = "shop";

/** The round's last stage, after whose shop the next round begins. */
const finalStage: StageKind = stageKinds[stageKinds.length - 1];

/** The stage after this one in the round; none after the last. */
function nextStage(completed: StageKind): StageKind | undefined {
  return stageKinds.find((_, index) => index > 0 && stageKinds[index - 1] === completed);
}

/** What each hand policy does with the cards still in hand when a stage ends. */
const handAtStageEnd: Record<RunRules["handAtStageEnd"], (state: GameState) => GameState> = {
  "return-to-deck": (state) => ({ ...state, hand: [], deck: [...state.deck, ...state.hand] }),
};

/** What each discard pile policy does when a round ends. */
const discardPileAtRoundEnd: Record<
  RunRules["discardPileAfterShop"],
  (state: GameState) => GameState
> = {
  "keep-out": (state) => state,
  "return-to-deck": (state) => ({
    ...state,
    deck: [...state.deck, ...state.discardPile],
    discardPile: [],
  }),
};
