import type { CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { materialOf } from "./materials";
import type { EventRule, RuleCommand } from "./event-rules";
import type { GameEvent, PassiveBlock, PassiveRule } from "./passives";
import { ruleHandlers } from "./rule-handlers";
import type { StageKind } from "./run-rules";
import { evaluateLine, findScoringLines, type Line, type ScoredLine } from "./scoring";
import { cellKey } from "./traits/attachable";
import { scorableValue } from "./traits/scorable";

/** Legacy predicates for discard and stage-won rules, until they move to event rules (#63 slice 3). */
function matches(
  rule: PassiveRule,
  context: {
    block?: CardBlock;
    discarded?: readonly CardBlock[];
    stage?: StageKind;
  },
): boolean {
  const condition = rule.condition;
  if (!condition) return true;
  switch (condition.kind) {
    case "material":
      return !!context.block && materialOf(context.block) === condition.value;
    case "suit":
      return (
        !!context.block &&
        condition.values.includes(context.block.traits.identity.suit.name as "hearts" | "diamonds")
      );
    case "rank-count":
      return (
        (context.discarded?.filter((block) => block.traits.identity.rank === condition.rank)
          .length ?? 0) >= condition.minimum
      );
    case "stage":
      return !!context.stage && condition.kinds.includes(context.stage);
  }
}

/** A passive's rule that fired for a scored line, reported so presentation can show it. */
export type PassiveActivation = {
  passiveId: string;
  on: string;
  /** On `score.beforeBlockValue`: the contributing block the rule changed. */
  blockId?: string;
  /** Commands the rule's effects collected, committed with the line. */
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
 * Coins one passive pays when a stage is won, judged on the blocks still in the hand: per
 * matching block (perMatch), or once if any block (or, with no condition, always).
 */
export function stageWonPassiveCoins(
  passive: PassiveBlock,
  hand: readonly CardBlock[],
  stage?: StageKind,
): number {
  let coins = 0;
  for (const rule of passive.traits.passive.rules ?? []) {
    if (rule.on !== "stage.won" || rule.effect.kind !== "add-coins") continue;
    // A stage condition tests the won stage itself, not the blocks left in the hand.
    if (rule.condition?.kind === "stage") {
      if (matches(rule, { stage })) coins += rule.effect.amount;
      continue;
    }
    if (!rule.condition) {
      coins += rule.effect.amount;
      continue;
    }
    const matching = hand.filter((block) => matches(rule, { block })).length;
    coins += rule.effect.amount * (rule.effect.perMatch ? matching : Number(matching > 0));
  }
  return coins;
}

/** One listener's outcome for a single discard action, in rack order. */
export function discardPassiveEffects(
  passive: PassiveBlock,
  discarded: readonly CardBlock[],
): { coins: number; grants: number } {
  let coins = 0;
  let grants = 0;
  for (const rule of passive.traits.passive.rules ?? []) {
    if (rule.on !== "discard.completed") continue;
    if (rule.effect.kind === "grant-unowned-passive") {
      if (matches(rule, { discarded })) grants++;
      continue;
    }
    if (rule.effect.kind !== "add-coins") continue;
    const matching = discarded.filter((block) => matches(rule, { block, discarded }));
    coins +=
      rule.effect.amount * (rule.effect.perMatch ? matching.length : Number(matching.length > 0));
  }
  return { coins, grants };
}
