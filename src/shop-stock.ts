import type { CardBlock } from "./cards";
import type { GameState } from "./game-state";
import { createPassiveBlock, randomPassiveDefinitions, type PassiveBlock } from "./passives";

export type ShopOffer =
  | { kind: "card"; block: CardBlock }
  | { kind: "passive"; block: PassiveBlock };

/** The first shop sandbox borrows three unique cards from its deck for display. */
export function shopPreviewState(
  state: GameState,
  coins: number,
  random: () => number = Math.random,
): GameState {
  const deck = [...state.deck, ...state.hand, ...state.field.map(({ block }) => block)];
  const cardOffers: ShopOffer[] = [];
  for (let index = 0; index < 3 && deck.length; index++) {
    const [block] = deck.splice(Math.floor(random() * deck.length), 1);
    cardOffers.push({ kind: "card", block });
  }
  const passiveOffers: ShopOffer[] = randomPassiveDefinitions(2, random).map(
    (definition, index) => ({
      kind: "passive",
      block: createPassiveBlock(definition.id, `shop.passive.${index + 1}`),
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
