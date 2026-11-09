import type { ResaleModifier } from "./resale";
import type { StageRules } from "./game-state";

export const stageKinds = ["stage-1", "stage-2", "boss"] as const;
export type StageKind = (typeof stageKinds)[number];

/** A stage's dealer and the numbers it starts with. */
export type StageSetup = StageRules & { dealer: string };

/**
 * Everything about progression that is still a design decision lives here, so a
 * placeholder can be swapped without touching the controller. See doc/game.md.
 */
export type RunRules = {
  stage(round: number, kind: StageKind): StageSetup;
  /** Cards still in hand when a stage ends. Open rule; only one option exists so far. */
  handAtStageEnd: "return-to-deck";
  /** Whether the discard pile returns to the deck after the boss-stage shop. */
  discardPileAfterShop: "keep-out" | "return-to-deck";
  /** Coins for completing a stage; the stage rewards' default (4) when left out. */
  stageReward?: number;
  /** How many passives the rack can hold; unlimited when left out. */
  rackCapacity?: number;
  /**
   * Changes to a passive's sale payout, applied in order after the default resale policy
   * (src/resale.ts). None by default; future sale-modifying passives plug in here.
   */
  resaleModifiers?: readonly ResaleModifier[];
  /** First playable-card shop price; one coin unless a run changes it. */
  cardPurchasePrice?: number;
};

/** A stage in the round, in order, with the data that is its own. */
export type StageDefinition = {
  kind: StageKind;
  /** The round 1 target; later rounds grow it (see `demoRunRules`). */
  baseTarget: number;
};

/** The demo round: each stage's own data, in play order. */
export const demoStages: readonly StageDefinition[] = [
  { kind: "stage-1", baseTarget: 100 },
  { kind: "stage-2", baseTarget: 150 },
  { kind: "boss", baseTarget: 200 },
];

/** A stage's own definition. */
function stageDefinition(kind: StageKind): StageDefinition {
  const definition = demoStages.find((stage) => stage.kind === kind);
  if (!definition) throw new Error(`No stage definition for ${kind}`);
  return definition;
}

/**
 * Placeholder demo progression: targets grow by half the base each round, every stage
 * has six plays and four discards, and the boss uses the base dealer until boss rules exist.
 */
export const demoRunRules: RunRules = {
  stage(round, kind) {
    return {
      dealer: "base",
      targetScore: Math.round(stageDefinition(kind).baseTarget * (1 + (round - 1) / 2)),
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
 * The dev-mode sandbox for endless play: the same dealers as `base`, but a stage can be
 * neither won nor lost on its own. Plays and discards never run out, and the target score
 * is out of reach. (The console's win and lose still decide a stage on demand.)
 */
export function sandboxRunRules(base: RunRules): RunRules {
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
