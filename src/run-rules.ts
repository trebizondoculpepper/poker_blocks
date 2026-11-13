import type { ResaleModifier } from "./resale";
import type { GameState, StageRules } from "./game-state";
import { stageTargetBalance, type StageTargetBalance } from "./balance";

export type StageKind = (typeof stageTargetBalance.stages)[number]["kind"];
export const stageKinds: readonly StageKind[] = stageTargetBalance.stages.map(({ kind }) => kind);

/**
 * Each stage's ordinal in the round (1, 2, 3), from the configured stage order (#660;
 * doc/game-events.md, "Numbered stage lifecycle"). The legacy kind handles are mapped here, at the
 * configuration boundary, so gameplay never compares one.
 */
const stageOrdinals = new Map(
  stageTargetBalance.stages.map((stage, index) => [stage.kind, index + 1]),
);
export const stageOrdinal = (handle: StageKind): number => stageOrdinals.get(handle) ?? 0;

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
  /**
   * The model controllers composed onto the playfield (#658; doc/game-events.md, "Ownership and
   * composition"). None composed: no material steps run.
   */
  playfield?: readonly import("./lifecycle/play-phases").PlayfieldController[];
  /** How much one action may resolve before it is rolled back (#657); the documented defaults. */
  resolutionLimits?: { events: number; operations: number };
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
  /**
   * How the run stocks a shop it enters with no stock, a save from before offers existed
   * included. The mode's `shop` trait supplies it (src/mode-trait-rules.ts); left out, a
   * shop has no stock.
   */
  stockShop?: (state: GameState, random: () => number, round: number) => GameState;
};

/** A stage in the round, in order, with the data that is its own. */
export type StageDefinition<Kind extends string = StageKind> =
  StageTargetBalance<Kind>["stages"][number];

/** The demo round: each stage's own data, in play order. */
export const demoStages: readonly StageDefinition[] = stageTargetBalance.stages;

/** Walk the configured sequence, rounding after each entered stage. */
export function targetForStage<Kind extends string>(
  balance: StageTargetBalance<Kind>,
  round: number,
  kind: Kind,
): number {
  if (!Number.isSafeInteger(round) || round < 1) throw new Error("round must be positive");
  const stageIndex = balance.stages.findIndex((stage) => stage.kind === kind);
  if (stageIndex < 0) throw new Error(`No stage definition for ${kind}`);
  let target = balance.openingTarget;
  const steps = (round - 1) * balance.stages.length + stageIndex;
  for (let step = 1; step <= steps; step++) {
    const next = Math.round(target * balance.stages[step % balance.stages.length].rateInto);
    if (!Number.isFinite(next) || next < 1)
      throw new Error("stage target must remain a positive number after rounding");
    // A never-ending run eventually outgrows safe integers; keep the target representable.
    target = Math.min(next, Number.MAX_SAFE_INTEGER);
    if (target === Number.MAX_SAFE_INTEGER) break;
  }
  return target;
}

/**
 * Agreed target progression with six plays and four discards per stage. The boss uses
 * the base dealer until boss rules exist.
 */
export const demoRunRules: RunRules = {
  // Openings first (#554), then material effects in the documented order: placement-timed reactions (the Air/flame upgrade)
  // and countdown deductions before scoring; the other reactions, then the pending detonations,
  // after it.
  playfield: [
    {
      id: "materialEffectsController",
      config: {
        beforeScore: ["openings", "placement-reactions", "countdown-deductions"],
        afterScore: ["reactions", "countdown-detonations"],
      },
    },
  ],
  stage(round, kind) {
    return {
      dealer: "base",
      targetScore: targetForStage(stageTargetBalance, round, kind),
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
