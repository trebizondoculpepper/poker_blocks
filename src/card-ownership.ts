/**
 * Who owns a card (#424): what happens to it when a stage's table clears. A card's `owner` trait
 * names a registered owner; without one it is the run deck's (`deck`) and goes back to the deck.
 * A card made on the field during play (the first are clouds, #425) is the field's (`field`): it
 * leaves play with the table and never joins the deck or a later draw. `GameRun.clearTable` asks
 * each field card's owner; it never asks what the card is.
 *
 * Field-owned cards live in `GameState.generatedCards` while they exist, so a save can rebuild
 * them in full (they aren't in the starting deck).
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";

/** What a card's owner does with it, and the state, when the table clears. */
export type CardOwner = { atTableClear: (state: GameState, card: CardBlock) => GameState };

export const cardOwners = new Registry<CardOwner>("card owner");

cardOwners.register("deck", {
  atTableClear: (state, card) => ({ ...state, deck: [...state.deck, card] }),
});
cardOwners.register("field", {
  atTableClear: (state, card) => {
    const generatedCards = (state.generatedCards ?? []).filter(({ id }) => id !== card.id);
    return { ...state, generatedCards: generatedCards.length ? generatedCards : undefined };
  },
});

/** The owner a card names, `deck` unless it says otherwise. */
export const ownerOf = (card: CardBlock): string => card.traits.owner?.id ?? "deck";

/** A card made on the field during play: owned by the field, so it leaves with the table. */
export function asGenerated(card: CardBlock): CardBlock {
  return { ...card, traits: { ...card.traits, owner: { id: "field" } } };
}

/** Return every field card to its owner, as the table clears; the field is left empty. */
export function clearField(state: GameState): GameState {
  return state.field.reduce<GameState>(
    (current, { block }) => cardOwners.get(ownerOf(block)).atTableClear(current, block),
    { ...state, field: [] },
  );
}
