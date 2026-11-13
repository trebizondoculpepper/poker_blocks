import { createCard, ranks, suits } from "./cards";
import type { GameState } from "./game-state";
import { withMaterial } from "./materials";
import { createPassiveBlock, passiveDefinitions, type PassiveDefinition } from "./passives";
import { defaultShop, type ShopTrait } from "./game-modes";
import { drawWeighted, passiveFrequencies, weightAt } from "./offer-weights";
import { passiveUnlockRound } from "./offer-eligibility";
import type { ShopOffer } from "./offer-kinds";
import { validateShopStock } from "./shop-stock-config";
import { cardDistributions } from "./card-generator";
import { itemOfferPools } from "./item-offers";
// Registers the transmogrifiers' item offers (#388).
import "./transmogrifiers";
import "./nothingifier";

export type { ShopOffer } from "./offer-kinds";

/**
 * A shop's stock (#143, #145): `minOffers` to `maxOffers` offers, with configurable guaranteed
 * passive and card counts when eligible, the rest drawn by normalised weight from everything
 * eligible this round. A card offer is a new card of a material drawn by its weight curve
 * (any rank and suit, and it may repeat a card the deck holds); a passive offer is a passive
 * the run doesn't own, drawn by its frequency curve from its unlock round, at most once a shop.
 */
export function shopPreviewState(
  state: GameState,
  coins: number,
  random: () => number = Math.random,
  stock: ShopTrait = defaultShop,
  round = 1,
): GameState {
  const stockErrors = validateShopStock(stock);
  if (stockErrors.length)
    throw new Error(`Invalid shop stock: ${stockErrors.map(({ message }) => message).join("; ")}`);
  const deck = [...state.deck, ...state.hand, ...state.field.map(({ block }) => block)];
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  // Offer ids must not repeat a card or passive the run already has: a duplicate id would make
  // the deck, the rack, selling and saves treat two things as one.
  const usedIds = new Set([
    ...[...deck, ...state.discardPile].map(({ id }) => id),
    ...state.passiveRack.map(({ id }) => id),
    // A card removed for the run (#156) still owns its id: saves account for it.
    ...(state.removedCards ?? []),
  ]);
  let serial = 0;
  const nextOfferId = (prefix: string) => {
    let id: string;
    do id = `${prefix}.${++serial}`;
    while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };

  const owned = new Set(state.passiveRack.map(({ definitionId }) => definitionId));
  const passives: Candidate[] = passiveDefinitions
    .names()
    .map((name) => passiveDefinitions.get(name))
    .filter((definition) => !definition.retired && !owned.has(definition.id))
    .map((definition) => ({
      weight: passiveWeight(definition, round),
      once: true,
      shelf: 0,
      offer: () => ({
        kind: "passive",
        block: createPassiveBlock(definition.id, nextOfferId("shop.passive")),
      }),
    }));
  // The same playable-card table the shared generator samples (#555).
  const cards: Candidate[] = cardDistributions
    .get("shopPlayableCards")(round)
    .map(({ material, weight }) => ({
      weight,
      once: false,
      shelf: 1,
      offer: () => ({
        kind: "card",
        block: withMaterial(
          createCard({ rank: pick(ranks), suit: pick(suits) }, nextOfferId("shop.card")),
          material,
        ),
      }),
    }));

  // Dedicated item offers (transmogrifiers #388, the Nothingifier #156) come on top; the shop holds at most nine.
  const slots = stock.itemSlots ?? 1;
  const count = Math.min(
    stock.minOffers + Math.floor(random() * (stock.maxOffers - stock.minOffers + 1)),
    9 - slots,
  );
  const chosen: Candidate[] = [];
  const draw = (pool: Candidate[]) => {
    const candidate = drawWeighted(pool, ({ weight }) => weight, random);
    if (!candidate) return;
    chosen.push(candidate);
    if (candidate.once) candidate.weight = 0;
  };
  // Guaranteed kinds first, then anything by weight. An ineligible pool yields no offer.
  for (let index = 0; index < (stock.guaranteedPassives ?? 1); index++) draw(passives);
  for (let index = 0; index < (stock.guaranteedCards ?? 1); index++) draw(cards);
  while (chosen.length < count && [...passives, ...cards].some(({ weight }) => weight > 0))
    draw([...passives, ...cards]);
  // Each item slot (#388, #156) draws from every registered item pool's candidates this
  // round, by weight, each candidate at most once a shop.
  const items: Candidate[] = itemOfferPools
    .names()
    .flatMap((name) => itemOfferPools.get(name)(round, nextOfferId))
    .map(({ weight, offer }) => ({ weight, once: true, shelf: 2, offer }));
  for (let slot = 0; slot < slots; slot++) {
    const candidate = drawWeighted(items, ({ weight }) => weight, random);
    if (!candidate) break;
    chosen.push(candidate);
    candidate.weight = 0;
  }
  // Laid out passives first, then cards, then items.
  const offers = chosen.toSorted((a, b) => a.shelf - b.shelf).map(({ offer }) => offer());
  return {
    ...state,
    field: [],
    hand: [],
    deck,
    coins,
    shopStock: offers,
  };
}

/** Something a shop could stock, and how likely it is this round. */
type Candidate = {
  weight: number;
  /** Drawn at most once a shop (a passive), or as often as the weights say (a material). */
  once: boolean;
  /** Where it is laid out: lower shelves first. */
  shelf: number;
  offer: () => ShopOffer;
};

/** A passive's weight this round: none before it unlocks, then its frequency curve. */
export function passiveWeight(definition: PassiveDefinition, round: number): number {
  if (!definition.shop || round < passiveUnlockRound(definition)) return 0;
  return weightAt(passiveFrequencies.get(definition.shop.frequency), round);
}
