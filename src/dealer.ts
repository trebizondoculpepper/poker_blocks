import type { CardBlock } from "./cards";
import { blockAttachmentCell } from "./block-trait-behaviours";
import { Registry } from "./core/registry";
import { drawCards } from "./deal";
import type { GameState, PlayAction, StageRules } from "./game-state";
import { scoreField } from "./scoring";
import { cellKey, faceNormal, type Cell, type Face } from "./traits/attachable";
import { withSelectable, withoutSelectable } from "./traits/selectable";

export type RoundOutcome = "playing" | "won" | "lost";

/** Won once the target is reached; lost when plays run out short of it. */
export function roundOutcome(state: GameState): RoundOutcome {
  const { score, targetScore, movesLeft } = state.round;
  if (score >= targetScore) return "won";
  if (movesLeft <= 0) return "lost";
  return "playing";
}

/** Rules for a stage started without a run rules, such as in tests. */
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
  /**
   * The cells a line of `count` blocks would fill: from the placement cell, straight out
   * along the face's direction (east on an empty field). Null if any cell is taken.
   */
  linePlacementFor(state: GameState, count: number, targetId?: string, face?: Face): Cell[] | null;
  play(state: GameState, action: PlayAction): GameState | null;
  canDiscard(state: GameState): boolean;
  /**
   * Discard one or more hand cards as a single discard: one allowance however many go.
   * Null when discarding is not allowed, or any id is not in the hand.
   */
  discard(state: GameState, cardIds: string | readonly string[]): GameState | null;
}

export const baseDealer: Dealer = {
  name: "base",
  handSize: 5,

  startGame(cards, random: () => number = Math.random) {
    const empty: GameState = {
      field: [],
      hand: [],
      deck: [...cards],
      discardPile: [],
      passiveRack: [],
      coins: 0,
      round: { score: 0, targetScore: 0, movesLeft: 0, discardsLeft: 0 },
    };
    return this.startStage(empty, defaultStageRules, random);
  },

  startStage(state, rules, random: () => number = Math.random) {
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

  refillHand(state, random: () => number = Math.random) {
    const missing = Math.max(0, this.handSize - state.hand.length);
    const draw = drawCards(state.deck, Math.min(missing, state.deck.length), random);
    const drawn = draw.cards.map(withSelectable);
    return {
      state: { ...state, deck: draw.deck, hand: [...state.hand, ...drawn] },
      drawn,
    };
  },

  canPlay: (state) => roundOutcome(state) === "playing",

  placementFor(state, targetId, face) {
    if (state.field.length === 0) return { x: 0, y: 0, z: 0 };
    if (!targetId || !face) return null;
    const target = state.field.find(({ block }) => block.id === targetId);
    if (!target) return null;
    return blockAttachmentCell(
      target.block,
      target.cell,
      face,
      new Set(state.field.map(({ cell }) => cellKey(cell))),
    );
  },

  linePlacementFor(state, count, targetId, face) {
    const start = this.placementFor(state, targetId, face);
    if (!start || count < 1) return null;
    // On an empty field the direction does not matter; the line runs east.
    const step = face ? faceNormal(face) : { x: 1, y: 0, z: 0 };
    const taken = new Set(state.field.map(({ cell }) => cellKey(cell)));
    const cells = Array.from({ length: count }, (_, index) => ({
      x: start.x + step.x * index,
      y: start.y + step.y * index,
      z: start.z + step.z * index,
    }));
    // A line that would run into a block is refused whole.
    return cells.some((cell) => taken.has(cellKey(cell))) ? null : cells;
  },

  play(state, action) {
    if (!this.canPlay(state)) return null;
    const ids = action.cardIds?.length ? action.cardIds : [action.cardId];
    if (new Set(ids).size !== ids.length) return null;
    const blocks = ids.map((id) => state.hand.find((card) => card.id === id));
    if (blocks.some((block) => !block)) return null;
    const cells = this.linePlacementFor(state, ids.length, action.targetId, action.face);
    if (!cells) return null;
    const placedIds = new Set(ids);
    const field = [
      ...state.field,
      ...blocks.map((block, index) => ({ block: withoutSelectable(block!), cell: cells[index] })),
    ];
    const gained = scoreField(field).reduce((total, { points }) => total + points, 0);
    return {
      ...state,
      field,
      hand: state.hand.filter(({ id }) => !placedIds.has(id)),
      round: {
        ...state.round,
        score: state.round.score + gained,
        movesLeft: state.round.movesLeft - 1,
      },
    };
  },

  canDiscard: (state) => roundOutcome(state) === "playing" && state.round.discardsLeft > 0,

  discard(state, cardIds) {
    if (!this.canDiscard(state)) return null;
    const ids = new Set(typeof cardIds === "string" ? [cardIds] : cardIds);
    if (ids.size === 0) return null;
    // In hand order, so the discard pile reads left to right.
    const blocks = state.hand.filter(({ id }) => ids.has(id));
    if (blocks.length !== ids.size) return null;
    return {
      ...state,
      hand: state.hand.filter(({ id }) => !ids.has(id)),
      discardPile: [...state.discardPile, ...blocks],
      round: { ...state.round, discardsLeft: state.round.discardsLeft - 1 },
    };
  },
};

export const dealerRegistry = new Registry<Dealer>("dealer");
dealerRegistry.register(baseDealer.name, baseDealer);
