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
/** Adds `amount` once, or once per crossing cell with `perIntersection`. */
ruleHandlers.registerEffect<
  { amount: number; perIntersection?: boolean },
  ScoreEventContext | undefined
>("add-line-score", ({ amount, perIntersection }, score, frame) =>
  working(frame, (value) => value + amount * (perIntersection ? (score?.intersections ?? 0) : 1)),
);
