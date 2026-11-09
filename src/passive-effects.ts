import type { PlacedBlock } from "./game-state";
import type { EventRule, RuleCommand } from "./event-rules";
import type { GameEvent, PassiveBlock } from "./passives";
import { ruleHandlers } from "./rule-handlers";
import { cardScoringRules } from "./materials";
import type { CardBlock } from "./cards";
import { evaluateLine, findScoringLines, type Line, type ScoredLine } from "./scoring";
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
const cardSource = (block: CardBlock): RuleSource => ({
  id: block.id,
  rules: cardScoringRules(block),
});

/**
 * The line's scoring phases after its hand is chosen, in order (doc/game.md, "Order of
 * operations"): multipliers, then powers, then the rack's line effects. Each phase runs the
 * contributing cards' own rules first, then the passives', so any source may use any phase.
 */
const linePhases = ["score.lineMultiply", "score.linePower", "score.beforeLineFinalized"];

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
  for (const { source, rule } of rules) {
    const frame = ruleHandlers.evaluate(rule, { event, workingValue: value, commands: [] });
    value = frame.workingValue ?? value;
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
): PassiveScoredLine[] {
  const lines = findScoringLines(field);
  const passives = rack.map(passiveSource);
  return lines.map((line) => {
    const intersections = crossingCells(line, lines);
    // Evaluate: a block's value is the same in every candidate, so each is worked out once.
    const evaluated = new Map(
      line.blocks.map((block) => [
        block.id,
        evaluateRules(
          subscribedRules([cardSource(block), ...passives], "score.beforeBlockValue"),
          { type: "score.beforeBlockValue", score: { line, intersections, block } },
          scorableValue(block),
        ),
      ]),
    );
    const result = evaluateLine(line.blocks, (block) => evaluated.get(block.id)!.value);
    // Only the chosen hand's cards bring their own line rules.
    const contributing = line.blocks.filter(({ id }) => result.contributingIds.includes(id));
    const sources = [...contributing.map(cardSource), ...passives];
    const phases = linePhases.reduce(
      (previous, phase) => {
        const next = evaluateRules(
          subscribedRules(sources, phase),
          { type: phase, score: { line, intersections } },
          previous.value,
        );
        return { value: next.value, activations: [...previous.activations, ...next.activations] };
      },
      { value: result.points, activations: [] as RuleActivation[] },
    );
    // Commit: the chosen hand's contributing blocks, then the line phases.
    const activations = [
      ...result.contributingIds.flatMap((id) => evaluated.get(id)!.activations),
      ...phases.activations,
    ];
    return {
      line,
      blockIds: line.blocks.map(({ id }) => id),
      ...result,
      points: Math.max(0, Math.round(phases.value)),
      activations,
    };
  });
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
