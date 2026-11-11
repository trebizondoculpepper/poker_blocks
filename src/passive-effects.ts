import type { PlacedBlock } from "./game-state";
import type { EventRule, RuleCommand } from "./event-rules";
import type { GameEvent, PassiveBlock } from "./passives";
import { ruleHandlers } from "./rule-handlers";
import { cardScoringRules } from "./materials";
import type { CardBlock } from "./cards";
import {
  evaluateLine,
  findScoringLines,
  handMultipliers,
  type Line,
  type ScoredLine,
} from "./scoring";
import { scoringEligibilities } from "./scoring-eligibility";
import { scoringEligibilityOf } from "./materials";
import { cellKey } from "./traits/attachable";
import { scorableValue } from "./traits/scorable";

/** A passive's rule that fired, reported so presentation can show it. */
/** A rule that fired, reported so presentation can show it. */
export type RuleActivation = {
  /** Who brought the rule: a passive's instance id, or a card's id for its own (material) rules. */
  sourceId: string;
  on: string;
  /** On `score.beforeBlockValue`: the contributing block the rule changed. */
  blockId?: string;
  /** Commands the rule's effects collected, for the game run to commit. */
  commands: readonly RuleCommand[];
};

export type PassiveScoredLine = ScoredLine & { activations: readonly RuleActivation[] };

/** Something that brings event rules: an installed passive, or a card with its own rules. */
type RuleSource = { id: string; rules: readonly EventRule[] };
const passiveSource = (passive: PassiveBlock): RuleSource => ({
  id: passive.id,
  rules: passive.traits.passive.eventRules ?? [],
});
const cardSource = (
  block: CardBlock,
  rulesForCard: (block: CardBlock) => EventRule[],
): RuleSource => ({
  id: block.id,
  rules: rulesForCard(block),
});

/**
 * The line's scoring phases after its hand is chosen, in order (doc/game.md, "Order of
 * operations"): multipliers, then powers, then the rack's line effects. Each phase runs the
 * contributing cards' own rules first, then the passives', so any source may use any phase.
 */
const linePhases = ["score.lineMultiply", "score.linePower", "score.beforeLineFinalized"];

/**
 * After a line's score is clamped at zero: a flat bonus here (a die's roll, #97) is added to
 * every scored line and can never rescue a negative one.
 */
const afterClampPhase = "score.afterLineClamp";

/** Each source's event rules subscribed to `on`, in source order then listed order. */
function subscribedRules(
  sources: readonly RuleSource[],
  on: string,
): { source: RuleSource; rule: EventRule }[] {
  return sources.flatMap((source) =>
    source.rules.filter((rule) => rule.on === on).map((rule) => ({ source, rule })),
  );
}

/**
 * Run the subscribed rules over a working value, left to right, each seeing the value the
 * previous one left. Pure: it returns the result and the rules that fired, applying nothing.
 */
function evaluateRules(
  rules: readonly { source: RuleSource; rule: EventRule }[],
  event: GameEvent,
  start: number,
): { value: number; activations: RuleActivation[] } {
  const activations: RuleActivation[] = [];
  let value = start;
  // The phase's total exponent so far: each power rule moves it (#431).
  let exponent = 1;
  for (const { source, rule } of rules) {
    const frame = ruleHandlers.evaluate(rule, {
      event,
      workingValue: value,
      exponent,
      commands: [],
    });
    value = frame.workingValue ?? value;
    exponent = frame.exponent ?? exponent;
    if (frame.fired)
      activations.push({
        sourceId: source.id,
        on: rule.on,
        blockId: event.score?.block?.id,
        commands: frame.commands,
      });
  }
  return { value, activations };
}

/**
 * Score every line with the cards' own rules and the rack's (#139, #141). Pure: candidate
 * hands in a long line evaluate block values without committing anything; only the chosen
 * hand's contributing cards and the line phases report activations, once. The score is
 * rounded once, after every effect, and never goes below zero.
 */
export function scoreFieldWithPassives(
  field: readonly PlacedBlock[],
  rack: readonly PassiveBlock[],
  rulesForCard: (block: CardBlock) => EventRule[] = cardScoringRules,
  random: () => number = noRandomSource,
): PassiveScoredLine[] {
  const lines = findScoringLines(field);
  // One resolution: each passive's value sources (a die's roll) resolve once, here, before any
  // candidate hand is evaluated, and the same values apply to every line (#97).
  const passives = rack.map((passive) => {
    const source = passiveSource(passive);
    return {
      ...source,
      rules: source.rules.map((rule) => ruleHandlers.resolveValues(rule, random)),
    };
  });
  return lines.map((line) => {
    const intersections = crossingCells(line, lines);
    // Evaluate: a block's value is the same in every candidate, so each is worked out once.
    const evaluated = new Map(
      line.blocks.map((block) => [
        block.id,
        evaluateRules(
          subscribedRules([cardSource(block, rulesForCard), ...passives], "score.beforeBlockValue"),
          { type: "score.beforeBlockValue", score: { line, intersections, block } },
          scorableValue(block),
        ),
      ]),
    );
    // Each card's eligibility (#423) says how much of its own bonus it brings whatever hand is
    // chosen: that part is left out while the hand is chosen, so it can't change the hand, and
    // is added once below at the hand's multiplier.
    const guaranteed = new Map(
      line.blocks.map((block) => {
        const own = evaluateRules(
          subscribedRules([cardSource(block, rulesForCard)], "score.beforeBlockValue"),
          { type: "score.beforeBlockValue", score: { line, intersections, block } },
          scorableValue(block),
        );
        const eligibility = scoringEligibilities.get(scoringEligibilityOf(block));
        return [
          block.id,
          {
            amount: eligibility.guaranteed(own.value - scorableValue(block)),
            joinsWhenOutside: eligibility.joinsWhenOutside,
            activations: own.activations,
          },
        ];
      }),
    );
    const result = evaluateLine(
      line.blocks,
      (block) => evaluated.get(block.id)!.value - guaranteed.get(block.id)!.amount,
    );
    // The chosen hand's cards bring their own line rules; a card outside it joins only if its
    // eligibility says so.
    const contributing = line.blocks.filter(({ id }) => result.contributingIds.includes(id));
    const joining = line.blocks.filter(
      ({ id }) => !result.contributingIds.includes(id) && guaranteed.get(id)!.joinsWhenOutside,
    );
    const sources = [...contributing, ...joining].map((block) => cardSource(block, rulesForCard));
    sources.push(...passives);
    const sharedPoints =
      [...guaranteed.values()].reduce((sum, { amount }) => sum + amount, 0) *
      handMultipliers[result.hand];
    const phases = linePhases.reduce(
      (previous, phase) => {
        const next = evaluateRules(
          subscribedRules(sources, phase),
          { type: phase, score: { line, intersections } },
          previous.value,
        );
        return { value: next.value, activations: [...previous.activations, ...next.activations] };
      },
      { value: result.points + sharedPoints, activations: [] as RuleActivation[] },
    );
    // The line is clamped at zero, then the after-clamp phase adds its flat bonuses.
    const clamped = Math.max(0, phases.value);
    const after = evaluateRules(
      subscribedRules(sources, afterClampPhase),
      { type: afterClampPhase, score: { line, intersections } },
      clamped,
    );
    // Commit: the chosen hand's contributing blocks, then the line phases.
    const activations = [
      ...result.contributingIds.flatMap((id) => evaluated.get(id)!.activations),
      ...joining.flatMap(({ id }) => guaranteed.get(id)!.activations),
      ...phases.activations,
      ...after.activations,
    ];
    return {
      line,
      blockIds: line.blocks.map(({ id }) => id),
      ...result,
      points: Math.max(0, Math.round(after.value)),
      activations,
    };
  });
}

/** For callers without the run's random source: fine until a rule tries to draw from it. */
function noRandomSource(): number {
  throw new Error("This rule draws a random value: pass the run's random source");
}

/** How many of a line's cells another line on a different axis also passes through. */
function crossingCells(line: Line, lines: readonly Line[]): number {
  const ownCells = new Set(line.cells.map(cellKey));
  return line.cells.filter((cell) =>
    lines.some(
      (other) =>
        other !== line &&
        other.axis !== line.axis &&
        other.cells.some(
          (crossing) => ownCells.has(cellKey(crossing)) && cellKey(crossing) === cellKey(cell),
        ),
    ),
  ).length;
}

/**
 * One passive's rules subscribed to `event`, evaluated in their listed order: the ones that
 * fired, each with the commands its effects collected (#170). Pure; the caller commits.
 */
export function passiveActivations(
  passive: PassiveBlock,
  event: Readonly<GameEvent>,
): RuleActivation[] {
  return evaluateRules(subscribedRules([passiveSource(passive)], event.type), event, 0).activations;
}
