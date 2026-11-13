/**
 * The game's event rule handlers (#63, #139): the named selectors, conditions and effects that
 * passives' (and, with #141, materials') `EventRule` data refers to. A rule's data names a
 * handler and configures it; the handler is the only code. The runner in `src/event-rules.ts`
 * never interprets the names, and scoring never asks which rule or passive it is evaluating.
 *
 * Adding a rule kind is one registration here (or in a test), with no change to scoring.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import type { CardBlock } from "./cards";
import { EventRuleRegistry, type ResolvedOutcome, type RuleFrame } from "./event-rules";
import type { BlockMaterial } from "./materials";
import { materialOf } from "./materials";
import type { ScoreEventContext, StageContext } from "./passives";
import type { StageKind } from "./run-rules";
import type { HandlerConfig } from "./event-rules";

export const ruleHandlers = new EventRuleRegistry();

/**
 * A scoring effect's change, reported as it applies (#483): its operation, resolved operand and
 * the working value before and after, on a `scope` measured in score.
 */
const scored = (
  frame: Readonly<RuleFrame>,
  operation: string,
  operand: number,
  scope: string,
  change: (value: number) => number,
): RuleFrame => {
  const before = frame.workingValue ?? 0;
  const after = change(before);
  return {
    ...frame,
    workingValue: after,
    outcomes: [
      ...(frame.outcomes ?? []),
      { operation, operand, before, after, unit: "score", scope },
    ],
  };
};

// ----- Selectors: what a rule looks at -----

/** On `score.beforeBlockValue`: the block being valued. */
ruleHandlers.registerSelector<Record<never, never>, CardBlock | undefined>(
  "scored-block",
  (_config, frame) => frame.event.score?.block,
);
/** On `score.*`: the scored line, with how many of its cells cross another line. */
ruleHandlers.registerSelector<Record<never, never>, ScoreEventContext | undefined>(
  "scored-line",
  (_config, frame) => frame.event.score,
);

/** The event's blocks (discarded, or the hand at a stage win) for which `where` holds. */
ruleHandlers.registerSelector<{ where: HandlerConfig }, readonly CardBlock[]>(
  "event-blocks",
  ({ where }, frame) =>
    (frame.event.blocks ?? []).filter((block) => ruleHandlers.holds(where, block, frame)),
);
/** On a stage or shop lifecycle event: its stage, with round and ordinal (#660). */
ruleHandlers.registerSelector<Record<never, never>, StageContext | undefined>(
  "event-stage",
  (_config, frame) => frame.event.stage,
);
/** On `stage.won`: the stage of the round that was won. */
ruleHandlers.registerSelector<Record<never, never>, StageKind | undefined>(
  "won-stage",
  (_config, frame) => frame.event.stageKind,
);

// ----- Conditions: whether the rule applies -----

ruleHandlers.registerCondition("always", () => true);
ruleHandlers.registerCondition<{ material: BlockMaterial }, CardBlock | undefined>(
  "material-is",
  ({ material }, block) => !!block && materialOf(block) === material,
);
/** The maximal line's length, even when a long line scores with a five-block subset. */
ruleHandlers.registerCondition<
  { minimum?: number; maximum?: number },
  ScoreEventContext | undefined
>("line-length", ({ minimum = 0, maximum = Infinity }, score) => {
  const length = score?.line.blocks.length ?? 0;
  return length >= minimum && length <= maximum;
});
ruleHandlers.registerCondition<Record<never, never>, ScoreEventContext | undefined>(
  "perpendicular-intersection",
  (_config, score) => (score?.intersections ?? 0) > 0,
);

ruleHandlers.registerCondition<{ suits: readonly string[] }, CardBlock | undefined>(
  "suit-in",
  ({ suits }, block) => !!block && suits.includes(block.traits.identity?.suit.name ?? ""),
);
ruleHandlers.registerCondition<{ rank: string }, CardBlock | undefined>(
  "rank-is",
  ({ rank }, block) => block?.traits.identity?.rank === rank,
);
/** At least `minimum` selected things (blocks, say). */
ruleHandlers.registerCondition<{ minimum: number }, readonly unknown[]>(
  "count-at-least",
  ({ minimum }, selected) => selected.length >= minimum,
);
ruleHandlers.registerCondition<{ stages: readonly StageKind[] }, StageKind | undefined>(
  "stage-in",
  ({ stages }, stage) => !!stage && stages.includes(stage),
);
/**
 * Which stage of the round it is, by ordinal (1, 2 or 3), and optionally in which rounds (#660):
 * `{ ordinals: [2] }` matches stage two in every round, never one or three.
 */
ruleHandlers.registerCondition<
  { ordinals: readonly number[]; rounds?: readonly number[] },
  StageContext | undefined
>(
  "stage-ordinal-in",
  ({ ordinals, rounds }, stage) =>
    !!stage && ordinals.includes(stage.ordinal) && (!rounds || rounds.includes(stage.round)),
);

// ----- Value sources: amounts an effect's configuration may take instead of a number (#97) -----

/** A fixed amount, for symmetry with the random sources: `{ valueSource: "fixed", value: 3 }`. */
ruleHandlers.registerValueSource<{ value: number }>("fixed", ({ value }) => value);
/** A die: a whole number from 1 to `sides`, each equally likely. */
ruleHandlers.registerValueSource<{ sides: number }>(
  "roll",
  ({ sides }, random) => 1 + Math.min(sides - 1, Math.floor(random() * sides)),
);

// ----- Effects: what the rule does to the working value -----

ruleHandlers.registerEffect<{ factor: number }, unknown>(
  "multiply-block-value",
  ({ factor }, _selected, frame) =>
    scored(frame, "multiply-block-value", factor, "block", (value) => value * factor),
);
ruleHandlers.registerEffect<{ amount: number }, unknown>(
  "add-block-value",
  ({ amount }, _selected, frame) =>
    scored(frame, "add-block-value", amount, "block", (value) => value + amount),
);
ruleHandlers.registerEffect<{ factor: number }, unknown>(
  "multiply-line-score",
  ({ factor }, _selected, frame) =>
    scored(frame, "multiply-line-score", factor, "line", (value) => value * factor),
);
/**
 * `frame` with its line raised by one more exponent contribution, reported as `operation`.
 * Exponents add their increases above 1 (#431): the phase's starting value is raised to the new
 * total, so it ends at base^(1 + sum(e - 1)) in any order, even through a total of 0. A neutral
 * power (1) changes nothing but is still reported, with any captured `note`.
 */
export function raiseLine(
  frame: Readonly<RuleFrame>,
  power: number,
  operation: string,
  note?: string,
): RuleFrame {
  const exponent = (frame.exponent ?? 1) + power - 1;
  const base = frame.powerBase ?? frame.workingValue ?? 0;
  // A power that has no finite result (a zero line under a negative total exponent) scores
  // nothing, so a score is always a finite number (#476 review).
  const raised = base ** exponent;
  const after = Number.isFinite(raised) ? raised : 0;
  return {
    ...frame,
    workingValue: after,
    exponent,
    powerBase: base,
    outcomes: [
      ...(frame.outcomes ?? []),
      {
        operation,
        operand: power,
        before: frame.workingValue ?? 0,
        after,
        unit: "score",
        scope: "line",
        ...(note ? { note } : {}),
      },
    ],
  };
}

/** Raises the working score to `power` (a prismatic crystal's exponential modifier). */
ruleHandlers.registerEffect<{ power: number }, unknown>(
  "power-line-score",
  ({ power }, _selected, frame) => raiseLine(frame, power, "power-line-score"),
);
/** Adds `amount` once, or once per crossing cell with `perIntersection`. */
ruleHandlers.registerEffect<
  { amount: number; perIntersection?: boolean },
  ScoreEventContext | undefined
>("add-line-score", ({ amount, perIntersection }, score, frame) => {
  // The actual contribution: per crossing cell when so configured (Crossroads), resolved here.
  const added = amount * (perIntersection ? (score?.intersections ?? 0) : 1);
  return scored(frame, "add-line-score", added, "line", (value) => value + added);
});

// ----- Effects that collect commands, committed by the game run (src/rule-commands.ts) -----

/** Ask for a command; the rule itself changes nothing. A coin amount is reported as its outcome. */
const command = (
  frame: Readonly<RuleFrame>,
  id: string,
  config: unknown,
  outcome?: ResolvedOutcome,
): RuleFrame => ({
  ...frame,
  commands: [...frame.commands, { id, config }],
  ...(outcome ? { outcomes: [...(frame.outcomes ?? []), outcome] } : {}),
});
// A coin or grant effect passes on the sound its rule configures, if any; the command falls back
// to its default (#566 review).
type Sounded = { sound?: SoundEffectId };
const withSound = ({ sound }: Sounded) => (sound ? { sound } : {});
ruleHandlers.registerEffect<{ amount: number } & Sounded, unknown>(
  "add-coins",
  (config, _selected, frame) =>
    command(
      frame,
      "add-coins",
      { amount: config.amount, ...withSound(config) },
      { operation: "add-coins", operand: config.amount, unit: "coins" },
    ),
);
/** `amount` coins for each selected thing (each matching block, say). */
ruleHandlers.registerEffect<{ amount: number } & Sounded, readonly unknown[]>(
  "add-coins-per-selected",
  (config, selected, frame) =>
    command(
      frame,
      "add-coins",
      { amount: config.amount * selected.length, ...withSound(config) },
      {
        operation: "add-coins-per-selected",
        operand: config.amount * selected.length,
        unit: "coins",
      },
    ),
);
ruleHandlers.registerEffect<Sounded | undefined, unknown>(
  "grant-random-unowned-passive",
  (config, _selected, frame) => command(frame, "grant-unowned-passive", withSound(config ?? {})),
);
