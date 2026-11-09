/**
 * Offer kinds (#67): what each kind of shop offer means, registered once. A shop offer is plain
 * data, `{ kind, block }`. Pricing, buying, leaving the shop and saving ask the offer's kind
 * here, so a new kind of offer (a material upgrade, a service) registers its handlers and needs
 * no edit to the game run, the shop view, the run controller or the save format.
 *
 * Prices come from the run's rules and the balance config; a kind only says which to use.
 */
import { cardOfferPrice } from "./balance";
import { createCard, ranks, suits, type CardBlock } from "./cards";
import { getMaterialDefinition, materialOf, withMaterial, type BlockMaterial } from "./materials";
import { Registry } from "./core/registry";
import type { GameState } from "./game-state";
import { createPassiveBlock, passiveDefinitions, type PassiveBlock } from "./passives";
import { passiveUnlockRound } from "./offer-eligibility";

/** Anything a shop can offer: a block with an id. */
export type OfferBlock = { readonly id: string };

/** One item for sale: its kind names the handlers in `offerKinds`. */
export type ShopOffer = { readonly kind: string; readonly block: OfferBlock };

/** Where an offer is dropped to buy it. */
export type OfferDestination = "hand" | "passive-rack";

/** What a kind's purchase may read from the run. */
export type OfferRun = {
  /** The run's round, for eligibility (#165). */
  round: number;
  rackCapacity: number;
  handSize: number;
};

/** A saved offer: its kind plus whatever its kind writes. */
export type SavedOffer = { kind: string; [field: string]: unknown };

/** What restoring an offer may use: the passive ids already taken. */
export type OfferRestore = {
  takePassiveId(id: unknown): string;
};

export type OfferKind<Block extends OfferBlock> = {
  /** Where it is dropped to buy it. */
  destination: OfferDestination;
  /** What it costs, in coins. */
  price(block: Block, run: OfferRun): number;
  /** The run's state with the bought block added, or null when it doesn't fit. */
  receive(state: GameState, block: Block, run: OfferRun): GameState | null;
  /** What leaving the shop does with it unbought. */
  unbought(state: GameState, block: Block): GameState;
  save(block: Block): SavedOffer;
  /** Rebuild it from a save; throws on a malformed record. */
  restore(saved: SavedOffer, restore: OfferRestore): Block;
};

const registry = new Registry<OfferKind<OfferBlock>>("offer kind");

/** Register an offer kind's handlers under its name. */
export function registerOfferKind<Block extends OfferBlock>(
  name: string,
  kind: OfferKind<Block>,
): void {
  registry.register(name, kind as unknown as OfferKind<OfferBlock>);
}

/** The handlers for an offer's kind; an unknown kind is an error. */
export function offerKind(offer: Pick<ShopOffer, "kind">): OfferKind<OfferBlock> {
  return registry.get(offer.kind);
}

/** Whether a saved offer names a registered kind. */
export const isOfferKind = (name: unknown): boolean =>
  typeof name === "string" && registry.has(name);

/** A card saved in full, so it can be rebuilt without a starting deck to look it up in. */
export type SavedCard = { id: string; rank: string; suit: string; material: string };

export function saveCard(card: CardBlock): SavedCard {
  const { rank, suit } = card.traits.identity;
  return { id: card.id, rank, suit: suit.name, material: materialOf(card) };
}

/** Rebuild a fully saved card; throws on a malformed record. */
export function restoreCard(saved: { [field: string]: unknown }): CardBlock {
  const rank = ranks.find((candidate) => candidate === saved.rank);
  const suit = suits.find(({ name }) => name === saved.suit);
  if (!rank || !suit) throw new Error("bad card");
  return withMaterial(
    createCard({ rank, suit }, text(saved.id)),
    getMaterialDefinition(text(saved.material) as BlockMaterial),
  );
}

/** A saved field that must be a string. */
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("bad card field");
  return value;
}

// A playable card: a new card of some material (#143), costing its material's base price plus
// its rank's surcharge. Dropped on the shop's buy target, it joins the run's deck and its
// ledger of bought cards; an unbought one simply goes.
registerOfferKind<CardBlock>("card", {
  destination: "hand",
  price: (block) =>
    cardOfferPrice(block.traits.identity.rank, getMaterialDefinition(materialOf(block))),
  receive: (state, block) => ({
    ...state,
    deck: [...state.deck, block],
    boughtCards: [...(state.boughtCards ?? []), block],
  }),
  unbought: (state) => state,
  save: (block) => ({ kind: "card", ...saveCard(block) }),
  restore: (saved) => restoreCard(saved),
});

// A passive: costs its base price (its definition's shop balance, #7, #144), bought into a free
// rack slot; an unbought one simply goes. A passive without a price can't be bought.
registerOfferKind<PassiveBlock>("passive", {
  destination: "passive-rack",
  price: (block) => block.traits.priced?.basePrice ?? Number.NaN,
  // Refused before the passive is available (#165), even from a stale or early offer.
  receive: (state, block, { rackCapacity, round }) =>
    round < passiveUnlockRound(passiveDefinitions.get(block.definitionId)) ||
    state.passiveRack.length >= rackCapacity ||
    state.passiveRack.some(({ id }) => id === block.id)
      ? null
      : { ...state, passiveRack: [...state.passiveRack, block] },
  unbought: (state) => state,
  save: (block) => ({ kind: "passive", id: block.id, definitionId: block.definitionId }),
  restore: (saved, restore) => {
    if (typeof saved.definitionId !== "string") throw new Error("bad passive offer");
    return createPassiveBlock(saved.definitionId, restore.takePassiveId(saved.id));
  },
});
