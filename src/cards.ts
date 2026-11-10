import type { DestructibleTrait } from "./traits/destructible";
import type { TransparentTrait } from "./traits/transparent";
import { faces, type AttachableTrait } from "./traits/attachable";
import { inspectable, type InspectableTrait } from "./traits/inspectable";
import { scorable, type ScorableTrait } from "./traits/scorable";
import type { BlockMaterial } from "./materials";

export const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export const suits = [
  // `tone` is the ink a suit is printed in; each material gives each tone its colour.
  { name: "spades", symbol: "♠", color: "#1c2433", tone: "black" },
  { name: "hearts", symbol: "♥", color: "#bd3651", tone: "red" },
  { name: "diamonds", symbol: "♦", color: "#bd3651", tone: "red" },
  { name: "clubs", symbol: "♣", color: "#1c2433", tone: "black" },
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

/** A plain playable card with this identity. */
export function createCard(identity: IdentityTrait, id: string): CardBlock {
  return {
    id,
    traits: {
      identity,
      selectable: {},
      attachable: { faces },
      inspectable: inspectable(cardName(identity)),
      scorable: scorable(rankValue(identity.rank)),
    },
  };
}

export const standardDeck: readonly CardBlock[] = suits.flatMap((suit) =>
  ranks.map((rank) => createCard({ rank, suit }, `${rank}-${suit.name}`)),
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
