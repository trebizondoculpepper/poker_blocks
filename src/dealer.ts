import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { drawCards } from "./deal";
import type { GameState, PlayAction, StageRules } from "./game-state";
import { scoreField } from "./scoring";
import { attachmentCell, cellKey, type Cell, type Face } from "./traits/attachable";

export type RoundOutcome = "playing" | "won" | "lost";

/** Won once the target is reached; lost when plays run out short of it. */
export function roundOutcome(state: GameState): RoundOutcome {
  const { score, targetScore, movesLeft } = state.round;
  if (score >= targetScore) return "won";
  if (movesLeft <= 0) return "lost";
  return "playing";
}

/** Rules for a stage started without a session configuration, such as in tests. */
export const defaultStageRules: StageRules = { targetScore: 100, plays: 6, discards: 4 };

export type HandRefill = { state: GameState; drawn: CardBlock[] };

/** Dealers interpret and change GameState; boss dealers can replace these rules. */
export interface Dealer {
  readonly name: string;
  readonly handSize: number;
  /** A new game: every card in the deck, then the first stage dealt with default rules. */
  startGame(cards: readonly CardBlock[], random?: () => number): GameState;
  /** Clear the field into the deck, set the stage's counters and fill the hand. */
  startStage(state: GameState, rules: StageRules, random?: () => number): GameState;
  refillHand(state: GameState, random?: () => number): HandRefill;
  canPlay(state: GameState): boolean;
  placementFor(state: GameState, targetId?: string, face?: Face): Cell | null;
  play(state: GameState, action: PlayAction): GameState | null;
  canDiscard(state: GameState): boolean;
  discard(state: GameState, cardId: string): GameState | null;
}

export const baseDealer: Dealer = {
  name: "base",
  handSize: 5,

  startGame(cards, random = Math.random) {
    const empty: GameState = {
      field: [],
      hand: [],
      deck: [...cards],
      discardPile: [],
      round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
    };
    return this.startStage(empty, defaultStageRules, random);
  },

  startStage(state, rules, random = Math.random) {
    const cleared: GameState = {
      ...state,
      field: [],
      deck: [...state.deck, ...state.field.map(({ block }) => block)],
      round: {
        score: 0,
        targetScore: rules.targetScore,
        movesLeft: rules.plays,
        discardsLeft: rules.discards,
      },
    };
    return this.refillHand(cleared, random).state;
  },

  refillHand(state, random = Math.random) {
    const missing = Math.max(0, this.handSize - state.hand.length);
    const draw = drawCards(state.deck, Math.min(missing, state.deck.length), random);
    return {
      state: { ...state, deck: draw.deck, hand: [...state.hand, ...draw.cards] },
      drawn: draw.cards,
    };
  },

  canPlay: (state) => roundOutcome(state) === "playing",

  placementFor(state, targetId, face) {
    if (state.field.length === 0) return { x: 0, y: 0, z: 0 };
    if (!targetId || !face) return null;
    const target = state.field.find(({ block }) => block.id === targetId);
    if (!target) return null;
    return attachmentCell(
      target.block.traits.attachable,
      target.cell,
      face,
      new Set(state.field.map(({ cell }) => cellKey(cell))),
    );
  },

  play(state, action) {
    if (!this.canPlay(state)) return null;
    const block = state.hand.find(({ id }) => id === action.cardId);
    const cell = this.placementFor(state, action.targetId, action.face);
    if (!block || !cell) return null;
    const field = [...state.field, { block, cell }];
    const gained = scoreField(field).reduce((total, { points }) => total + points, 0);
    return {
      ...state,
      field,
      hand: state.hand.filter(({ id }) => id !== block.id),
      round: {
        ...state.round,
        score: state.round.score + gained,
        movesLeft: state.round.movesLeft - 1,
      },
    };
  },

  canDiscard: (state) => roundOutcome(state) === "playing" && state.round.discardsLeft > 0,

  discard(state, cardId) {
    if (!this.canDiscard(state)) return null;
    const block = state.hand.find(({ id }) => id === cardId);
    if (!block) return null;
    return {
      ...state,
      hand: state.hand.filter(({ id }) => id !== cardId),
      discardPile: [...state.discardPile, block],
      round: { ...state.round, discardsLeft: state.round.discardsLeft - 1 },
    };
  },
};

export const dealerRegistry = new Registry<Dealer>("dealer");
dealerRegistry.register(baseDealer.name, baseDealer);
