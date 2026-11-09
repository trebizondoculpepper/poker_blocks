import { createCard, ranks, suits } from "./cards";
import type { GameState } from "./game-state";
import { materialDefinitions, withMaterial, type MaterialDefinition } from "./materials";
import { createPassiveBlock, randomPassiveDefinitions } from "./passives";
import type { ShopTrait } from "./game-modes";
import type { ShopOffer } from "./offer-kinds";

export type { ShopOffer } from "./offer-kinds";

/** Materials a shop can make a new card from: those with a shop price (#143). */
const pricedMaterials = (): MaterialDefinition[] =>
  (materialDefinitions as readonly MaterialDefinition[]).filter(({ shop }) => shop !== undefined);

/**
 * A shop's stock: new cards of a priced material (#143), which may repeat cards already in the
 * deck, and passives the run doesn't own. Which materials and how many of each come with #145;
 * until then a card's rank, suit and material are drawn evenly.
 */
export function shopPreviewState(
  state: GameState,
  coins: number,
  random: () => number = Math.random,
  stock: Pick<ShopTrait, "passiveOffers" | "cardOffers"> = { passiveOffers: 2, cardOffers: 3 },
): GameState {
  const deck = [...state.deck, ...state.hand, ...state.field.map(({ block }) => block)];
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  // Offer ids must not repeat a card or passive the run already has: a duplicate id would make
  // the deck, the rack, selling and saves treat two things as one.
  const usedIds = new Set([
    ...[...deck, ...state.discardPile].map(({ id }) => id),
    ...state.passiveRack.map(({ id }) => id),
  ]);
  let serial = 0;
  const nextOfferId = (prefix: string) => {
    let id: string;
    do id = `${prefix}.${++serial}`;
    while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const materials = pricedMaterials();
  const cardOffers: ShopOffer[] = Array.from({ length: stock.cardOffers }, () => ({
    kind: "card",
    block: withMaterial(
      createCard({ rank: pick(ranks), suit: pick(suits) }, nextOfferId("shop.card")),
      pick(materials),
    ),
  }));
  const passiveOffers: ShopOffer[] = randomPassiveDefinitions(stock.passiveOffers, random).map(
    (definition) => ({
      kind: "passive",
      block: createPassiveBlock(definition.id, nextOfferId("shop.passive")),
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
