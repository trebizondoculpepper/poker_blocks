import type { CardBlock } from "./cards";
import { drawCards, startingHandSize } from "./deal";

export function refillHand(
  deck: readonly CardBlock[],
  hand: readonly CardBlock[],
  random: () => number = Math.random,
): { deck: CardBlock[]; hand: CardBlock[]; drawn: CardBlock[] } {
  const missing = Math.max(0, startingHandSize - hand.length);
  const draw = drawCards(deck, Math.min(missing, deck.length), random);
  return { deck: draw.deck, hand: [...hand, ...draw.cards], drawn: draw.cards };
}
