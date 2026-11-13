/**
 * Ordered deck operations (#551; doc/ordered-card-ownership.md, "Ordered zone capabilities").
 * The deck is an ordered pile whose next card is index zero: `popCards` takes from the front
 * and never touches the random stream; `shuffleCards` is the only operation that does, an
 * unbiased Fisher–Yates permutation of the same card instances.
 */
import type { CardBlock } from "./cards";

export type Draw = {
  deck: CardBlock[];
  cards: CardBlock[];
};

/**
 * Take `count` cards from the front of the deck, in order, without randomness. All or nothing:
 * a count the deck can't supply is rejected before anything moves. Zero is an empty draw.
 */
export function popCards(available: readonly CardBlock[], count: number): Draw {
  if (!Number.isInteger(count) || count < 0 || count > available.length) {
    throw new RangeError("Invalid draw count");
  }
  return { cards: available.slice(0, count), deck: available.slice(count) };
}

/** The same cards in a new order, from the run's seeded random stream (Fisher–Yates). */
export function shuffleCards(
  cards: readonly CardBlock[],
  random: () => number = Math.random,
): CardBlock[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled;
}
