import type { CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { materialOf } from "./materials";
import type { PassiveBlock, PassiveRule } from "./passives";
import { evaluateLine, findScoringLines, type Line, type ScoredLine } from "./scoring";
import { cellKey } from "./traits/attachable";
import { scorableValue } from "./traits/scorable";

function rulesFor(rack: readonly PassiveBlock[], on: PassiveRule["on"]): PassiveRule[] {
  return rack.flatMap((block) =>
    (block.traits.passive.rules ?? []).filter((rule) => rule.on === on),
  );
}

/** The same configured predicates are shared by scoring and discard events. */
function matches(
  rule: PassiveRule,
  context: {
    block?: CardBlock;
    line?: Line;
    intersections?: number;
    discarded?: readonly CardBlock[];
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
    case "line-length": {
      const length = context.line?.blocks.length ?? 0;
      return length >= (condition.minimum ?? 0) && length <= (condition.maximum ?? Infinity);
    }
    case "intersection":
      return (context.intersections ?? 0) > 0;
    case "rank-count":
      return (
        (context.discarded?.filter((block) => block.traits.identity.rank === condition.rank)
          .length ?? 0) >= condition.minimum
      );
  }
}

/** Pure calculation. Candidate five-card hands can call this without consuming any passive. */
export function scoreFieldWithPassives(
  field: readonly PlacedBlock[],
  rack: readonly PassiveBlock[],
): ScoredLine[] {
  const lines = findScoringLines(field);
  const blockRules = rulesFor(rack, "score.beforeBlockValue");
  const lineRules = rulesFor(rack, "score.beforeLineFinalized");
  return lines.map((line) => {
    const valueOf = (block: CardBlock): number => {
      let value = scorableValue(block);
      for (const rule of blockRules) {
        if (!matches(rule, { block, line })) continue;
        if (rule.effect.kind === "multiply-value") value *= rule.effect.factor;
        if (rule.effect.kind === "add-value") value += rule.effect.amount;
      }
      return value;
    };
    const result = evaluateLine(line.blocks, valueOf);
    const ownCells = new Set(line.cells.map(cellKey));
    const intersections = line.cells.filter((cell) =>
      lines.some(
        (other) =>
          other !== line &&
          other.axis !== line.axis &&
          other.cells.some(
            (crossing) => ownCells.has(cellKey(crossing)) && cellKey(crossing) === cellKey(cell),
          ),
      ),
    ).length;
    let points = result.points;
    for (const rule of lineRules) {
      if (!matches(rule, { line, intersections })) continue;
      if (rule.effect.kind === "multiply-line") points *= rule.effect.factor;
      if (rule.effect.kind === "add-line")
        points += rule.effect.amount * (rule.effect.perIntersection ? intersections : 1);
    }
    return {
      line,
      blockIds: line.blocks.map(({ id }) => id),
      ...result,
      points: Math.max(0, points),
    };
  });
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
