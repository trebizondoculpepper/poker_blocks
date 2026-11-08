export const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export const suits = [
  { name: "spades", symbol: "♠", color: "#1c2433" },
  { name: "hearts", symbol: "♥", color: "#bd3651" },
  { name: "diamonds", symbol: "♦", color: "#bd3651" },
  { name: "clubs", symbol: "♣", color: "#1c2433" },
] as const;

export type Card = {
  rank: (typeof ranks)[number];
  suit: (typeof suits)[number];
};

export const deck: readonly Card[] = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));

export function randomCard(): Card {
  return deck[Math.floor(Math.random() * deck.length)];
}

export function cardName(card: Card): string {
  const rankNames: Partial<Record<Card["rank"], string>> = {
    A: "ace",
    J: "jack",
    Q: "queen",
    K: "king",
  };
  return `${rankNames[card.rank] ?? card.rank} of ${card.suit.name}`;
}
