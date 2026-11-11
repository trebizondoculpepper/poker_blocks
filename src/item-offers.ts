/**
 * Item offers (#388, #156): the shop's dedicated item slots draw from every registered pool.
 * Each pool lists its candidates for a round, each with a weight and how to make its offer;
 * the shop never asks what kind of item a candidate is. Transmogrifiers register one pool, the
 * Nothingifier another.
 */
import { Registry } from "./core/registry";
import type { ShopOffer } from "./offer-kinds";

export type ItemOfferCandidate = { weight: number; offer: () => ShopOffer };

/** A pool's candidates this round; `nextOfferId` names each offer it makes. */
export type ItemOfferPool = (
  round: number,
  nextOfferId: (prefix: string) => string,
) => readonly ItemOfferCandidate[];

export const itemOfferPools = new Registry<ItemOfferPool>("item offer pool");
