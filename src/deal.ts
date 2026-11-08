import type { CardBlock } from "./cards";

export type Draw = {
  deck: CardBlock[];
  cards: CardBlock[];
};

export function drawCards(
  available: readonly CardBlock[],
  count: number,
  random: () => number = Math.random,
): Draw {
  if (!Number.isInteger(count) || count < 0 || count > available.length) {
    throw new RangeError("Invalid draw count");
  }

  const deck = [...available];
  const cards: CardBlock[] = [];
  for (let dealt = 0; dealt < count; dealt++) {
    const index = Math.floor(random() * deck.length);
    cards.push(deck.splice(index, 1)[0]);
  }
  return { deck, cards };
}
