import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { createPassiveBlock, randomPassiveDefinitions, type PassiveBlock } from "./passives";
import type { ShopTrait } from "./rooms";

export type ShopOffer =
  | { kind: "card"; block: CardBlock }
  | { kind: "passive"; block: PassiveBlock };

/** The first shop sandbox borrows three unique cards from its deck for display. */
export function shopPreviewState(
  state: GameState,
  coins: number,
  random: () => number = Math.random,
  stock: ShopTrait = { passiveOffers: 2, cardOffers: 3 },
): GameState {
  const deck = [...state.deck, ...state.hand, ...state.field.map(({ block }) => block)];
  const cardOffers: ShopOffer[] = [];
  for (let index = 0; index < stock.cardOffers && deck.length; index++) {
    const [block] = deck.splice(Math.floor(random() * deck.length), 1);
    cardOffers.push({ kind: "card", block });
  }
  // Offer ids must not repeat a passive already in the rack (bought in an earlier shop):
  // a duplicate id would make the rack, selling, and saves treat two passives as one.
  const usedIds = new Set(state.passiveRack.map(({ id }) => id));
  let serial = 0;
  const nextOfferId = () => {
    let id: string;
    do id = `shop.passive.${++serial}`;
    while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const passiveOffers: ShopOffer[] = randomPassiveDefinitions(stock.passiveOffers, random).map(
    (definition) => ({
      kind: "passive",
      block: createPassiveBlock(definition.id, nextOfferId()),
    }),
  );
  return {
    ...state,
    field: [],
    hand: [],
    deck,
    coins,
    shopStock: [...passiveOffers, ...cardOffers],
  };
}
