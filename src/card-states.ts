/**
 * Applying a saved ledger of card states (#387, #365, #372) to freshly rebuilt cards: a changed
 * material, a state bonus and a doneness step, each by its own module.
 */
import type { CardBlock } from "./cards";
import { rematerial, type CardState } from "./card-material";
import { withStateBonus } from "./state-bonuses";
import { withDoneness } from "./cooking";

/** Apply a saved ledger of card states (material, state bonus) to freshly rebuilt cards. */
export function applyCardStates(
  card: CardBlock,
  states: Readonly<Record<string, CardState>> | undefined,
): CardBlock {
  const state = states?.[card.id] ?? {};
  const material = [state.material ?? []]
    .flat()
    .reduce((current, kind) => rematerial(current, kind), card);
  const bonused = [state.stateBonus ?? []]
    .flat()
    .reduce((current, id) => withStateBonus(current, id), material);
  return [state.doneness ?? []]
    .flat()
    .reduce((current, step) => withDoneness(current, step), bonused);
}
