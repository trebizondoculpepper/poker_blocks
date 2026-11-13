import type { ScoringModifier } from "./scoring-modifier";
import type { DestructibleTrait } from "./traits/destructible";
import type { ResistantTrait } from "./traits/resistant";
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
    /**
     * Its rank/suit value provider (doc/opaque-actives.md, #892). Absent on a rankless active:
     * never rank zero or a fake suit. Read it through `pokerIdentity`.
     */
    identity?: IdentityTrait;
    selectable?: Record<string, never>;
    attachable?: AttachableTrait;
    inspectable?: InspectableTrait;
    scorable?: ScorableTrait;
    material?: { kind: BlockMaterial };
    /** See-through (fire, ice, crystal); see traits/transparent.ts. */
    transparent?: TransparentTrait;
    /** Can be destroyed, and by what; see traits/destructible.ts. */
    destructible?: DestructibleTrait;
    /** Resists destruction by the causes it names (src/traits/resistant.ts, #437). */
    resistant?: ResistantTrait;
    /** A scoring bonus from its state, one at a time (src/state-bonuses.ts, #365). */
    stateBonus?: { id: string };
    /** How cooked it is: a step of its material's doneness steps (src/cooking.ts, #372). */
    doneness?: { step: number };
    /** Who owns it: a registered card owner (src/card-ownership.ts, #424); the deck if absent. */
    owner?: { id: string };
    /** Plays left before it triggers itself (src/trigger-countdown.ts, #434). */
    countdown?: { left: number };
    /**
     * Scoring modifiers it has acquired, one register per lifetime (src/modifier-registers.ts,
     * #431), kept apart from its material's own values.
     */
    modifiers?: Readonly<Record<string, ScoringModifier>>;
  };
};

/**
 * A block has no rank/suit value provider where one is required: a rankless active reached poker
 * evaluation or another path that needs a rank and suit. The action is refused, not given a
 * fabricated identity.
 */
export class MissingValueProvider extends Error {
  constructor(blockId: string, need: string) {
    super(`${blockId} has no rank/suit value provider, which ${need} needs`);
    this.name = "MissingValueProvider";
  }
}

/** The block's rank and suit; throws MissingValueProvider for a rankless block. */
export function pokerIdentity(block: CardBlock, need = "this"): IdentityTrait {
  const identity = block.traits.identity;
  if (!identity) throw new MissingValueProvider(block.id, need);
  return identity;
}

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
