import type { PlacedBlock } from "./game-state";
import type { EventRule, RuleCommand } from "./event-rules";
import type { GameEvent, PassiveBlock } from "./passives";
import { ruleHandlers } from "./rule-handlers";
import { evaluateLine, findScoringLines, type Line, type ScoredLine } from "./scoring";
import { cellKey } from "./traits/attachable";
import { scorableValue } from "./traits/scorable";

/** A passive's rule that fired, reported so presentation can show it. */
export type PassiveActivation = {
  passiveId: string;
  on: string;
  /** On `score.beforeBlockValue`: the contributing block the rule changed. */
  blockId?: string;
  /** Commands the rule's effects collected, for the game run to commit. */
  commands: readonly RuleCommand[];
};

export type PassiveScoredLine = ScoredLine & { activations: readonly PassiveActivation[] };

/** Each installed passive's event rules subscribed to `on`, in rack order then listed order. */
function subscribedRules(
  rack: readonly PassiveBlock[],
  on: string,
): { passive: PassiveBlock; rule: EventRule }[] {
  return rack.flatMap((passive) =>
    (passive.traits.passive.eventRules ?? [])
      .filter((rule) => rule.on === on)
      .map((rule) => ({ passive, rule })),
  );
}

/**
 * Run the subscribed rules over a working value, left to right, each seeing the value the
 * previous one left. Pure: it returns the result and the rules that fired, applying nothing.
 */
function evaluateRules(
  rules: readonly { passive: PassiveBlock; rule: EventRule }[],
  event: GameEvent,
  start: number,
): { value: number; activations: PassiveActivation[] } {
  const activations: PassiveActivation[] = [];
  let value = start;
  for (const { passive, rule } of rules) {
    const frame = ruleHandlers.evaluate(rule, { event, workingValue: value, commands: [] });
    value = frame.workingValue ?? value;
    if (frame.fired)
      activations.push({
        passiveId: passive.id,
        on: rule.on,
        blockId: event.score?.block?.id,
        commands: frame.commands,
      });
  }
  return { value, activations };
}

/**
 * Score every line with the rack's scoring rules (#139). Pure: candidate hands in a long line
 * evaluate block values without committing anything; only the chosen hand's contributing blocks
 * and the line's own rules report activations, once.
 */
export function scoreFieldWithPassives(
  field: readonly PlacedBlock[],
  rack: readonly PassiveBlock[],
): PassiveScoredLine[] {
  const lines = findScoringLines(field);
  const blockRules = subscribedRules(rack, "score.beforeBlockValue");
  const lineRules = subscribedRules(rack, "score.beforeLineFinalized");
  return lines.map((line) => {
    const intersections = crossingCells(line, lines);
    // Evaluate: a block's value is the same in every candidate, so each is worked out once.
    const evaluated = new Map(
      line.blocks.map((block) => [
        block.id,
        evaluateRules(
          blockRules,
          { type: "score.beforeBlockValue", score: { line, intersections, block } },
          scorableValue(block),
        ),
      ]),
    );
    const result = evaluateLine(line.blocks, (block) => evaluated.get(block.id)!.value);
    const finalized = evaluateRules(
      lineRules,
      { type: "score.beforeLineFinalized", score: { line, intersections } },
      result.points,
    );
    // Commit: only the chosen hand's contributing blocks, then the line's rules.
    const activations = [
      ...result.contributingIds.flatMap((id) => evaluated.get(id)!.activations),
      ...finalized.activations,
    ];
    return {
      line,
      blockIds: line.blocks.map(({ id }) => id),
      ...result,
      points: Math.max(0, finalized.value),
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
): PassiveActivation[] {
  return evaluateRules(subscribedRules([passive], event.type), event, 0).activations;
}
