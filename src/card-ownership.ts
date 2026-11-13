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

/**
 * What a card's owner does with it, and the state, when the table clears, and when the card is
 * removed from play for the rest of the run (#156: the Nothingifier). The card has already left
 * the hand or field when either is called.
 */
export type CardOwner = {
  atTableClear: (state: GameState, card: CardBlock) => GameState;
  atRemoval: (state: GameState, card: CardBlock) => GameState;
};

/** The state without a card's saved state (its material change, bonus or doneness). */
function forgetCardState(state: GameState, card: CardBlock): GameState {
  const { [card.id]: _gone, ...cardStates } = state.cardStates ?? {};
  return { ...state, cardStates: Object.keys(cardStates).length ? cardStates : undefined };
}

export const cardOwners = new Registry<CardOwner>("card owner");

cardOwners.register("deck", {
  atTableClear: (state, card) => ({ ...state, deck: [...state.deck, card] }),
  // Out of the run for good: recorded, so a save accounts for it without dealing it again.
  atRemoval: (state, card) =>
    forgetCardState(
      {
        ...state,
        removedCards: [...(state.removedCards ?? []), card.id],
        // A run-owned active instance (#554) is kept in full, so a save can still account for it.
        ...[card.traits.active ?? []].flat().map(() => ({
          retiredActives: [...(state.retiredActives ?? []), card],
        }))[0],
      },
      card,
    ),
});
/** A field-made card leaves play entirely: its record and saved state go with it. */
const leaveWithField = (state: GameState, card: CardBlock): GameState => {
  const generatedCards = (state.generatedCards ?? []).filter(({ id }) => id !== card.id);
  // Its saved state (a material change or bonus) goes with it, or a save would name a card
  // that no longer exists and be refused (#427 review).
  return forgetCardState(
    { ...state, generatedCards: generatedCards.length ? generatedCards : undefined },
    card,
  );
};
cardOwners.register("field", { atTableClear: leaveWithField, atRemoval: leaveWithField });

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

/**
 * Remove a card in the hand or on the table from play for the rest of the run (#156): it
 * leaves where it is (a field card leaves a gap; nothing settles) and its owner decides what
 * remains of it. Null when no such card is in the hand or on the table.
 */
export function removeCardForRun(state: GameState, cardId: string): GameState | null {
  const card =
    state.hand.find(({ id }) => id === cardId) ??
    state.field.find(({ block }) => block.id === cardId)?.block;
  if (!card) return null;
  return cardOwners.get(ownerOf(card)).atRemoval(
    {
      ...state,
      hand: state.hand.filter(({ id }) => id !== cardId),
      field: state.field.filter(({ block }) => block.id !== cardId),
    },
    card,
  );
}
