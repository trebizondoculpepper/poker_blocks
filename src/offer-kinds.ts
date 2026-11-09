/**
 * Offer kinds (#67): what each kind of shop offer means, registered once. A shop offer is plain
 * data, `{ kind, block }`. Pricing, buying, leaving the shop and saving ask the offer's kind
 * here, so a new kind of offer (a material upgrade, a service) registers its handlers and needs
 * no edit to the game run, the shop view, the run controller or the save format.
 *
 * Prices come from the run's rules and the balance config; a kind only says which to use.
 */
import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import type { GameState } from "./game-state";
import { createPassiveBlock, type PassiveBlock } from "./passives";
import type { RunRules } from "./run-rules";

/** Anything a shop can offer: a block with an id. */
export type OfferBlock = { readonly id: string };

/** One item for sale: its kind names the handlers in `offerKinds`. */
export type ShopOffer = { readonly kind: string; readonly block: OfferBlock };

/** Where an offer is dropped to buy it. */
export type OfferDestination = "hand" | "passive-rack";

/** What a kind's purchase may read from the run. */
export type OfferRun = {
  rules: Pick<RunRules, "cardPurchasePrice">;
  passiveBuyPrice: number;
  rackCapacity: number;
  handSize: number;
};

/** A saved offer: its kind plus whatever its kind writes. */
export type SavedOffer = { kind: string; [field: string]: unknown };

/** What restoring an offer may use: the run's cards by id, and the passive ids already taken. */
export type OfferRestore = {
  card(id: unknown): CardBlock;
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

// A playable card: bought into the hand. The sandbox's cards are borrowed from the deck, so an
// unbought one goes back to it.
registerOfferKind<CardBlock>("card", {
  destination: "hand",
  price: (_block, { rules }) => rules.cardPurchasePrice ?? 1,
  receive: (state, block, { handSize }) =>
    state.hand.length >= handSize ? null : { ...state, hand: [...state.hand, block] },
  unbought: (state, block) => ({ ...state, deck: [...state.deck, block] }),
  save: (block) => ({ kind: "card", cardId: block.id }),
  restore: (saved, restore) => restore.card(saved.cardId),
});

// A passive: bought into a free rack slot; an unbought one simply goes.
registerOfferKind<PassiveBlock>("passive", {
  destination: "passive-rack",
  price: (_block, { passiveBuyPrice }) => passiveBuyPrice,
  receive: (state, block, { rackCapacity }) =>
    state.passiveRack.length >= rackCapacity || state.passiveRack.some(({ id }) => id === block.id)
      ? null
      : { ...state, passiveRack: [...state.passiveRack, block] },
  unbought: (state) => state,
  save: (block) => ({ kind: "passive", id: block.id, definitionId: block.definitionId }),
  restore: (saved, restore) => {
    if (typeof saved.definitionId !== "string") throw new Error("bad passive offer");
    return createPassiveBlock(saved.definitionId, restore.takePassiveId(saved.id));
  },
});
