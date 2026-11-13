/**
 * Adopting a stored payload into permanent run ownership (#928; doc/opaque-actives.md,
 * "Atomic opening/adoption"). The narrow model operation an opening handler (#930) needs:
 * in one state update, the wrapper leaves its place and its payload, rebuilt from its descriptor,
 * takes exactly that place (the same field cell, or the same position in hand, deck or discard).
 * The wrapper is then retired through its own owner's removal, so it can never be dealt again and
 * a save still accounts for it. There is no moment at which both are live.
 *
 * Every identity stays unique: a payload whose ID is already live, removed or retired is refused,
 * and nothing changes. It draws no randomness and emits nothing; the caller reports the event.
 */
import { cardOwners, ownerOf } from "./card-ownership";
import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { materializePayload } from "./playable-payload";

export type AdoptionResult =
  | { ok: true; state: GameState; wrapper: CardBlock; payload: CardBlock }
  | { ok: false; reason: string };

/** Every identity the run holds, has removed or has retired. */
export function takenIdentities(state: GameState): Set<string> {
  return new Set([
    ...[
      ...state.field.map(({ block }) => block),
      ...state.hand,
      ...state.deck,
      ...state.discardPile,
      ...(state.generatedCards ?? []),
      ...(state.retiredActives ?? []),
    ].map(({ id }) => id),
    ...(state.removedCards ?? []),
  ]);
}

/** `state` with the card `id` replaced in whichever zone holds it, or null when none does. */
function replaceInPlace(state: GameState, id: string, next: CardBlock): GameState | null {
  const swap = (cards: readonly CardBlock[]) => cards.map((card) => (card.id === id ? next : card));
  const holds = (cards: readonly CardBlock[]) => cards.some((card) => card.id === id);
  if (state.field.some(({ block }) => block.id === id))
    return {
      ...state,
      field: state.field.map((entry) =>
        entry.block.id === id ? { ...entry, block: next } : entry,
      ),
    };
  if (holds(state.hand)) return { ...state, hand: swap(state.hand) };
  if (holds(state.deck)) return { ...state, deck: swap(state.deck) };
  if (holds(state.discardPile)) return { ...state, discardPile: swap(state.discardPile) };
  return null;
}

/** Adopt the payload stored in `wrapperId`, in the wrapper's place, retiring the wrapper. */
export function adoptStoredPayload(state: GameState, wrapperId: string): AdoptionResult {
  const wrapper = [
    ...state.field.map(({ block }) => block),
    ...state.hand,
    ...state.deck,
    ...state.discardPile,
  ].find(({ id }) => id === wrapperId);
  const stored = [wrapper?.traits.opaqueContainer ?? []].flat()[0];
  if (!wrapper || !stored) return { ok: false, reason: `${wrapperId} holds no stored payload` };
  let payload: CardBlock;
  try {
    payload = materializePayload(wrapperId, stored.payload);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  if (takenIdentities(state).has(payload.id))
    return { ok: false, reason: `payload ID ${payload.id} is already in use` };
  const placed = replaceInPlace(state, wrapperId, payload);
  if (!placed) return { ok: false, reason: `${wrapperId} is in no zone` };
  return {
    ok: true,
    state: cardOwners.get(ownerOf(wrapper)).atRemoval(placed, wrapper),
    wrapper,
    payload,
  };
}
