/**
 * The game's event rule handlers (#63, #139): the named selectors, conditions and effects that
 * passives' (and, with #141, materials') `EventRule` data refers to. A rule's data names a
 * handler and configures it; the handler is the only code. The runner in `src/event-rules.ts`
 * never interprets the names, and scoring never asks which rule or passive it is evaluating.
 *
 * Adding a rule kind is one registration here (or in a test), with no change to scoring.
 */
import type { CardBlock } from "./cards";
import { EventRuleRegistry, type RuleFrame } from "./event-rules";
import type { BlockMaterial } from "./materials";
import { materialOf } from "./materials";
import type { ScoreEventContext } from "./passives";
import type { StageKind } from "./run-rules";
import type { HandlerConfig } from "./event-rules";

export const ruleHandlers = new EventRuleRegistry();

/** The working value with `change` applied: how every scoring effect moves the number. */
const working = (frame: Readonly<RuleFrame>, change: (value: number) => number): RuleFrame => ({
  ...frame,
  workingValue: change(frame.workingValue ?? 0),
});

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
  ({ suits }, block) => !!block && suits.includes(block.traits.identity.suit.name),
);
ruleHandlers.registerCondition<{ rank: string }, CardBlock | undefined>(
  "rank-is",
  ({ rank }, block) => block?.traits.identity.rank === rank,
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
  ({ factor }, _selected, frame) => working(frame, (value) => value * factor),
);
ruleHandlers.registerEffect<{ amount: number }, unknown>(
  "add-block-value",
  ({ amount }, _selected, frame) => working(frame, (value) => value + amount),
);
ruleHandlers.registerEffect<{ factor: number }, unknown>(
  "multiply-line-score",
  ({ factor }, _selected, frame) => working(frame, (value) => value * factor),
);
/** Raises the working score to `power` (a prismatic crystal's exponential modifier). */
ruleHandlers.registerEffect<{ power: number }, unknown>(
  "power-line-score",
  // Exponents add their increases above 1 (#431): the phase's starting value is raised to the
  // new total, so it ends at base^(1 + sum(e - 1)) in any order, even through a total of 0.
  ({ power }, _selected, frame) => {
    const exponent = (frame.exponent ?? 1) + power - 1;
    const base = frame.powerBase ?? frame.workingValue ?? 0;
    // A power that has no finite result (a zero line under a negative total exponent) scores
    // nothing, so a score is always a finite number (#476 review).
    const raised = base ** exponent;
    return {
      ...frame,
      workingValue: Number.isFinite(raised) ? raised : 0,
      exponent,
      powerBase: base,
    };
  },
);
/** Adds `amount` once, or once per crossing cell with `perIntersection`. */
ruleHandlers.registerEffect<
  { amount: number; perIntersection?: boolean },
  ScoreEventContext | undefined
>("add-line-score", ({ amount, perIntersection }, score, frame) =>
  working(frame, (value) => value + amount * (perIntersection ? (score?.intersections ?? 0) : 1)),
);

// ----- Effects that collect commands, committed by the game run (src/rule-commands.ts) -----

/** Ask for a command; the rule itself changes nothing. */
const command = (frame: Readonly<RuleFrame>, id: string, config: unknown): RuleFrame => ({
  ...frame,
  commands: [...frame.commands, { id, config }],
});
ruleHandlers.registerEffect<{ amount: number }, unknown>(
  "add-coins",
  ({ amount }, _selected, frame) => command(frame, "add-coins", { amount }),
);
/** `amount` coins for each selected thing (each matching block, say). */
ruleHandlers.registerEffect<{ amount: number }, readonly unknown[]>(
  "add-coins-per-selected",
  ({ amount }, selected, frame) =>
    command(frame, "add-coins", { amount: amount * selected.length }),
);
ruleHandlers.registerEffect("grant-random-unowned-passive", (_config, _selected, frame) =>
  command(frame, "grant-unowned-passive", {}),
);
