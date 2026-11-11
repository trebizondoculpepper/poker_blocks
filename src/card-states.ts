/**
 * Applying a saved ledger of card states (#387, #365, #372) to freshly rebuilt cards, through a
 * registry of appliers keyed by the state's field. Each module that persists card state
 * registers its own applier with an order (a material before a state bonus before a doneness
 * step, since the later ones read the card the earlier ones made); this function never names a
 * mechanic, so a new persisted state needs no change here.
 */
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import type { CardState } from "./card-material";

export type CardStateApplier = {
  /** Lower runs first. */
  order: number;
  apply(card: CardBlock, value: unknown): CardBlock;
};

export const cardStateAppliers = new Registry<CardStateApplier>("card state applier");

/** Apply a saved ledger of card states to a freshly rebuilt card, in the appliers' order. */
export function applyCardStates(
  card: CardBlock,
  states: Readonly<Record<string, CardState>> | undefined,
): CardBlock {
  const state: Readonly<Record<string, unknown>> = states?.[card.id] ?? {};
  return cardStateAppliers
    .names()
    .map((field) => ({ field, applier: cardStateAppliers.get(field) }))
    .sort((a, b) => a.applier.order - b.applier.order)
    .reduce<CardBlock>(
      (current, { field, applier }) =>
        [state[field] ?? []]
          .flat()
          .reduce<CardBlock>((each, value) => applier.apply(each, value), current),
      card,
    );
}
