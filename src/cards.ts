import { faces, type AttachableTrait } from "./traits/attachable";

export const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export const suits = [
  { name: "spades", symbol: "♠", color: "#1c2433" },
  { name: "hearts", symbol: "♥", color: "#bd3651" },
  { name: "diamonds", symbol: "♦", color: "#bd3651" },
  { name: "clubs", symbol: "♣", color: "#1c2433" },
] as const;

export type IdentityTrait = {
  rank: (typeof ranks)[number];
  suit: (typeof suits)[number];
};

export type CardBlock = {
  id: string;
  traits: {
    identity: IdentityTrait;
    selectable?: Record<string, never>;
    attachable?: AttachableTrait;
  };
};

export const standardDeck: readonly CardBlock[] = suits.flatMap((suit) =>
  ranks.map((rank) => ({
    id: `${rank}-${suit.name}`,
    traits: { identity: { rank, suit }, selectable: {}, attachable: { faces } },
  })),
);

export function cardName(identity: IdentityTrait): string {
  const rankNames: Partial<Record<IdentityTrait["rank"], string>> = {
    A: "ace",
    J: "jack",
    Q: "queen",
    K: "king",
  };
  return `${rankNames[identity.rank] ?? identity.rank} of ${identity.suit.name}`;
}
