/**
 * State bonuses (#365; design in doc/game-architecture.md, "State bonuses (proposal)", #364):
 * a scoring bonus a card gains from a reaction, kept in one slot on the card
 * (`traits.stateBonus: { id }`) so a new state replaces the old one rather than stacking. The
 * numbers live once, here, as a `ScoringModifier`, and reach the scorer as the card's own rules
 * (`cardScoringRules`), in the agreed phases. Rank, suit and hand identity never change.
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";
import type { EventRule } from "./event-rules";
import {
  scoringModifierRules,
  validateScoringModifier,
  type ScoringModifier,
} from "./scoring-modifier";

export type StateBonusDefinition = {
  /** Shown by the inspector, e.g. "Boiled (×2)". */
  name: string;
  modifier: ScoringModifier;
};

export const stateBonuses = new Registry<StateBonusDefinition>("state bonus");

// The agreed amounts (#362): melting ice gives water +1, ordinary flame heats water +1, and
// aggressive flame boils it ×2. Reactions assign them (#366–#369).
stateBonuses.register("melted", { name: "Melted (+1)", modifier: { additive: 1 } });
stateBonuses.register("heated", { name: "Heated (+1)", modifier: { additive: 1 } });
stateBonuses.register("boiled", { name: "Boiled (×2)", modifier: { multiplicative: 2 } });
// Air stokes flame into aggressive flame (#370): a state with no score of its own, which
// boils water beside it (#369).
stateBonuses.register("aggressive", { name: "Aggressive", modifier: {} });

/** Everything wrong with the registered state bonuses' numbers. */
export function validateStateBonuses(): string[] {
  return stateBonuses
    .names()
    .flatMap((id) => validateScoringModifier(`state bonus ${id}`, stateBonuses.get(id).modifier));
}

/** The scoring rules a card's state bonus brings: none without one. */
export function stateBonusRules(block: CardBlock): EventRule[] {
  return [block.traits.stateBonus ?? []]
    .flat()
    .flatMap(({ id }) => scoringModifierRules(stateBonuses.get(id).modifier));
}

/** The card with this state bonus in its one slot, replacing any it had. */
export function withStateBonus(card: CardBlock, id: string): CardBlock {
  stateBonuses.get(id);
  return { ...card, traits: { ...card.traits, stateBonus: { id } } };
}

/**
 * Give one card a state bonus wherever it is, replacing any previous one, and record it so a
 * save keeps it. Null when no card has that id, or it already has exactly this bonus.
 */
export function setCardStateBonus(state: GameState, cardId: string, id: string): GameState | null {
  stateBonuses.get(id);
  const current = [
    ...state.hand,
    ...state.field.map(({ block }) => block),
    ...state.deck,
    ...state.discardPile,
  ].find((card) => card.id === cardId);
  if (!current || current.traits.stateBonus?.id === id) return null;
  const swap = (card: CardBlock) => (card.id === cardId ? withStateBonus(card, id) : card);
  return {
    ...state,
    hand: state.hand.map(swap),
    field: state.field.map((placed) => ({ ...placed, block: swap(placed.block) })),
    deck: state.deck.map(swap),
    discardPile: state.discardPile.map(swap),
    ...(state.boughtCards ? { boughtCards: state.boughtCards.map(swap) } : {}),
    cardStates: {
      ...state.cardStates,
      [cardId]: { ...state.cardStates?.[cardId], stateBonus: id },
    },
  };
}
