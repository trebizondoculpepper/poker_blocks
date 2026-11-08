import type { StageRules } from "./game-state";

export const stageKinds = ["stage-1", "stage-2", "boss"] as const;
export type StageKind = (typeof stageKinds)[number];

/** A stage's dealer and the numbers it starts with. */
export type StageSetup = StageRules & { dealer: string };

/**
 * Everything about progression that is still a design decision lives here, so a
 * placeholder can be swapped without touching the controller. See doc/game.md.
 */
export type SessionConfig = {
  stage(round: number, kind: StageKind): StageSetup;
  /** Cards still in hand when a stage ends. Open rule; only one option exists so far. */
  handAtStageEnd: "return-to-deck";
  /** Whether the discard pile goes back into the deck when the player leaves the shop. */
  discardPileAfterShop: "keep-out" | "return-to-deck";
  /** Coins for completing a stage; the stage rewards' default (4) when left out. */
  stageReward?: number;
  /** How many passives the rack can hold; unlimited when left out. */
  rackCapacity?: number;
  /** What passives cost and fetch, in coins; `defaultPassivePrices` when left out. */
  passivePrices?: PassivePrices;
};

/**
 * The passive price policy (issue #16). Owned by the session so another session can set a
 * different spread; selling may later fetch less than buying.
 */
export type PassivePrices = { buy: number; sell: number };

/** First version: a passive costs 1 coin and sells for 1 coin. */
export const defaultPassivePrices: PassivePrices = { buy: 1, sell: 1 };

const baseTargets: Record<StageKind, number> = { "stage-1": 100, "stage-2": 150, boss: 200 };

/**
 * Placeholder demo progression: targets grow by half the base each round, every stage
 * has six plays and four discards, and the boss uses the base dealer until boss rules exist.
 */
export const demoSessionConfig: SessionConfig = {
  stage(round, kind) {
    return {
      dealer: "base",
      targetScore: Math.round(baseTargets[kind] * (1 + (round - 1) / 2)),
      plays: 6,
      discards: 4,
    };
  },
  handAtStageEnd: "return-to-deck",
  discardPileAfterShop: "return-to-deck",
};

/** A number that is never reached or used up (the dev1 sandbox); the HUD shows it as ∞. */
export const unlimited = 1_000_000;

/**
 * The dev-room sandbox for endless play: the same dealers as `base`, but a stage can be
 * neither won nor lost on its own. Plays and discards never run out, and the target score
 * is out of reach. (The console's win and lose still decide a stage on demand.)
 */
export function sandboxSessionConfig(base: SessionConfig): SessionConfig {
  return {
    ...base,
    stage: (round, kind) => ({
      ...base.stage(round, kind),
      targetScore: unlimited,
      plays: unlimited,
      discards: unlimited,
    }),
  };
}
