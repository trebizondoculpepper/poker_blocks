import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { drawCards } from "./deal";
import type { GameState, PlayAction } from "./game-state";
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

export type HandRefill = { state: GameState; drawn: CardBlock[] };

/** Dealers interpret and change GameState; boss dealers can replace these rules. */
export interface Dealer {
  readonly name: string;
  readonly handSize: number;
  startGame(cards: readonly CardBlock[], random?: () => number): GameState;
  refillHand(state: GameState, random?: () => number): HandRefill;
  canPlay(state: GameState): boolean;
  placementFor(state: GameState, targetId: string, face: Face): Cell | null;
  play(state: GameState, action: PlayAction): GameState | null;
  canDiscard(state: GameState): boolean;
  discard(state: GameState, cardId: string): GameState | null;
}

export const baseDealer: Dealer = {
  name: "base",
  handSize: 5,

  startGame(cards, random = Math.random) {
    const first = drawCards(cards, 1, random);
    const hand = drawCards(first.deck, Math.min(this.handSize, first.deck.length), random);
    return {
      field: [{ block: first.cards[0], cell: { x: 0, y: 0, z: 0 } }],
      hand: hand.cards,
      deck: hand.deck,
      discardPile: [],
      round: { score: 0, targetScore: 100, movesLeft: 6, discardsLeft: 4 },
    };
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
