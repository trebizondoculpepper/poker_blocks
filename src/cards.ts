import type { DestructibleTrait } from "./traits/destructible";
import type { TransparentTrait } from "./traits/transparent";
import { faces, type AttachableTrait } from "./traits/attachable";
import { inspectable, type InspectableTrait } from "./traits/inspectable";
import { scorable, type ScorableTrait } from "./traits/scorable";
import type { BlockMaterial } from "./materials";

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
    inspectable?: InspectableTrait;
    scorable?: ScorableTrait;
    material?: { kind: BlockMaterial };
    /** See-through (fire, ice, crystal); see traits/transparent.ts. */
    transparent?: TransparentTrait;
    /** Can be destroyed, and by what; see traits/destructible.ts. */
    destructible?: DestructibleTrait;
  };
};

export const standardDeck: readonly CardBlock[] = suits.flatMap((suit) =>
  ranks.map((rank) => ({
    id: `${rank}-${suit.name}`,
    traits: {
      identity: { rank, suit },
      selectable: {},
      attachable: { faces },
      inspectable: inspectable(cardName({ rank, suit })),
      scorable: scorable(rankValue(rank)),
    },
  })),
);

export function cardName(identity: IdentityTrait): string {
  const rankNames: Partial<Record<IdentityTrait["rank"], string>> = {
    A: "ace",
    J: "jack",
    Q: "queen",
    K: "king",
  };
  const rank = rankNames[identity.rank] ?? identity.rank;
  const suit = identity.suit.name;
  const displayRank = `${rank[0].toUpperCase()}${rank.slice(1)}`;
  const displaySuit = `${suit[0].toUpperCase()}${suit.slice(1)}`;
  return `${displayRank} of ${displaySuit}`;
}

/** Standard base points: 2–10 as printed, J=11, Q=12, K=13, A=14. */
export function rankValue(rank: IdentityTrait["rank"]): number {
  const faces: Partial<Record<IdentityTrait["rank"], number>> = { J: 11, Q: 12, K: 13, A: 14 };
  return faces[rank] ?? Number(rank);
}
