/**
 * The Nothingifier (#156): a one-use Items-rack item. Dropped on a card in the hand or on the
 * table, it removes that card from play for the rest of the run (`removeCardForRun`), then is
 * used up. It is bought in the shop's item slots, which it shares with transmogrifiers, from
 * any round; unused it resells for half its price. Everything it does comes from its traits:
 * `nothingifier` (the effect), `limitedUse` (one use) and `priced` (the resale basis).
 */
import { gameTuning } from "./balance";
import { removeCardForRun } from "./card-ownership";
import { itemOfferPools } from "./item-offers";
import { createPassiveBlock, passiveDefinitions, type PassiveBlock } from "./passives";
import { rackItemEffects } from "./rack-item-effects";
import { rackTraitPersistence } from "./rack-trait-persistence";
// Registers its empty dotted-cube look.
import "./visual/dotted-cube";

export const nothingifierId = "nothingifier";

passiveDefinitions.register(nothingifierId, {
  id: nothingifierId,
  releaseStatus: { certified: {} },
  lifecycle: { parent: "limitedUseItem" },
  name: "Nothingifier",
  symbol: "∅",
  description:
    "Removes a card in your hand or on the table from play for the rest of the run. One use.",
  traitId: "passive.event-rules",
  categoryTrait: { effectCategory: {} },
  eventRules: [],
  // An empty cube outline of thick dots, like a heavier ghost cube.
  visual: { builder: "dottedCube", config: { colour: 0x65f4dd } },
  // Stocked only by the shop's item slots: the "dedicated" curve never draws it as a passive.
  shop: { basePrice: gameTuning.nothingifier.price, unlockRound: 1, frequency: "dedicated" },
});

/** A new Nothingifier at `price`, with its one use. */
export function createNothingifier(
  id: string,
  price: number = gameTuning.nothingifier.price,
): PassiveBlock {
  const block = createPassiveBlock(nothingifierId, id);
  return {
    ...block,
    traits: {
      ...block.traits,
      priced: { basePrice: price },
      limitedUse: { uses: 1, total: 1 },
      nothingifier: {},
    },
  };
}

rackItemEffects.register("nothingifier", (state, _item, cardId) => removeCardForRun(state, cardId));

// One candidate for the shop's item slots, every round.
itemOfferPools.register("nothingifier", (_round, nextOfferId) => [
  {
    weight: gameTuning.nothingifier.weight,
    offer: () => ({ kind: "nothingifier", block: createNothingifier(nextOfferId("shop.item")) }),
  },
]);

// Its effect trait carries no data; saved so a restored item still removes cards.
rackTraitPersistence.register("nothingifier", { save: () => ({}), restore: () => ({}) });
