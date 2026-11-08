import { rankValue, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { scorableValue } from "./traits/scorable";
import { cellKey, type Cell } from "./traits/attachable";

// Pure scoring primitives (issue #3). Nothing here touches the UI, sound or GameState;
// accumulating a stage total from these results is the dealer's job.

export type Axis = "x" | "y" | "z";

export type HandType =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush";

/** Provisional multipliers from doc/game.md; the counted cards' points are multiplied by these. */
export const handMultipliers: Readonly<Record<HandType, number>> = {
  "high-card": 1,
  pair: 2,
  "two-pair": 2,
  "three-of-a-kind": 3,
  straight: 3,
  flush: 4,
  "full-house": 5,
  "four-of-a-kind": 7,
  "straight-flush": 9,
};

/** A maximal gap-free run of two or more placed blocks, in cell order along its axis. */
export type Line = {
  axis: Axis;
  cells: readonly Cell[];
  blocks: readonly CardBlock[];
};

export type LineEvaluation = {
  hand: HandType;
  /** Ids of the blocks whose points count; kickers are left out. */
  contributingIds: readonly string[];
  points: number;
};

export type ScoredLine = LineEvaluation & {
  line: Line;
  blockIds: readonly string[];
};

const axes: readonly Axis[] = ["x", "y", "z"];

/** Every maximal line along X, then Y, then Z; each line once, starting from its lowest cell. */
export function findScoringLines(field: readonly PlacedBlock[]): Line[] {
  const byCell = new Map(field.map((placed) => [cellKey(placed.cell), placed]));
  const lines: Line[] = [];
  for (const axis of axes) {
    const starts = field
      .filter(({ cell }) => !byCell.has(cellKey(step(cell, axis, -1))))
      .sort((a, b) => compareCells(a.cell, b.cell));
    for (const start of starts) {
      const cells: Cell[] = [];
      const blocks: CardBlock[] = [];
      let cell: Cell = start.cell;
      for (let next = byCell.get(cellKey(cell)); next; next = byCell.get(cellKey(cell))) {
        cells.push(next.cell);
        blocks.push(next.block);
        cell = step(cell, axis, 1);
      }
      if (blocks.length >= 2) lines.push({ axis, cells, blocks });
    }
  }
  return lines;
}

function step(cell: Cell, axis: Axis, delta: number): Cell {
  return { ...cell, [axis]: cell[axis] + delta };
}

function compareCells(a: Cell, b: Cell): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}

/** The numeric base score of one line. Deterministic; never changes any total. */
export function scoreLine(blocks: readonly CardBlock[]): number {
  return evaluateLine(blocks).points;
}

/**
 * Best hand for a line. Lines of 0 or 1 block score 0. A line of 6+ takes the five-card
 * subset with the highest points; on a tie the stronger hand type wins, then the first
 * subset in line order (a provisional rule to confirm, see doc/game.md).
 */
export function evaluateLine(
  blocks: readonly CardBlock[],
  valueOf: (block: CardBlock) => number = scorableValue,
): LineEvaluation {
  if (blocks.length < 2) return { hand: "high-card", contributingIds: [], points: 0 };
  if (blocks.length <= 5) return evaluateHand(blocks, valueOf);
  let best: LineEvaluation | null = null;
  for (const subset of combinations(blocks, 5)) {
    const candidate = evaluateHand(subset, valueOf);
    if (!best || isBetter(candidate, best)) best = candidate;
  }
  return best!;
}

function isBetter(a: LineEvaluation, b: LineEvaluation): boolean {
  if (a.points !== b.points) return a.points > b.points;
  return handOrder.indexOf(a.hand) > handOrder.indexOf(b.hand);
}

const handOrder = Object.keys(handMultipliers) as HandType[];

/** Classify two to five cards and total the points of the cards that count. */
export function evaluateHand(
  blocks: readonly CardBlock[],
  valueOf: (block: CardBlock) => number = scorableValue,
): LineEvaluation {
  const groups = rankGroups(blocks);
  const sizes = groups.map((group) => group.length);
  const five = blocks.length === 5;
  const flush = five && new Set(blocks.map((b) => b.traits.identity.suit.name)).size === 1;
  const straight = five && sizes.length === 5 && isStraight(blocks);

  const result = (hand: HandType, counted: readonly CardBlock[]): LineEvaluation => ({
    hand,
    contributingIds: counted.map(({ id }) => id),
    points: counted.reduce((sum, block) => sum + valueOf(block), 0) * handMultipliers[hand],
  });

  if (straight && flush) return result("straight-flush", blocks);
  if (sizes[0] === 4) return result("four-of-a-kind", groups[0]);
  if (sizes[0] === 3 && sizes[1] === 2) return result("full-house", blocks);
  if (flush) return result("flush", blocks);
  if (straight) return result("straight", blocks);
  if (sizes[0] === 3) return result("three-of-a-kind", groups[0]);
  if (sizes[0] === 2 && sizes[1] === 2) return result("two-pair", [...groups[0], ...groups[1]]);
  if (sizes[0] === 2) return result("pair", groups[0]);
  return result("high-card", [highest(blocks, valueOf)]);
}

/** Cards grouped by rank, largest group first, then highest rank first. */
function rankGroups(blocks: readonly CardBlock[]): CardBlock[][] {
  const byRank = new Map<string, CardBlock[]>();
  for (const block of blocks) {
    const rank = block.traits.identity.rank;
    byRank.set(rank, [...(byRank.get(rank) ?? []), block]);
  }
  return [...byRank.values()].sort(
    (a, b) =>
      b.length - a.length ||
      rankValue(b[0].traits.identity.rank) - rankValue(a[0].traits.identity.rank),
  );
}

function highest(blocks: readonly CardBlock[], valueOf: (block: CardBlock) => number): CardBlock {
  return blocks.reduce((best, block) => (valueOf(block) > valueOf(best) ? block : best));
}

/** Ace is high only (10-J-Q-K-A); whether A-2-3-4-5 counts is still an open question. */
function isStraight(blocks: readonly CardBlock[]): boolean {
  const values = blocks.map((b) => rankValue(b.traits.identity.rank)).sort((a, b) => a - b);
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function* combinations<T>(items: readonly T[], size: number, start = 0): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= items.length - size; i++) {
    for (const rest of combinations(items, size - 1, i + 1)) yield [items[i], ...rest];
  }
}

/** Score every line, as happens after each play, in discovery order. */
export function scoreField(field: readonly PlacedBlock[]): ScoredLine[] {
  return findScoringLines(field).map((line) => ({
    line,
    blockIds: line.blocks.map(({ id }) => id),
    ...evaluateLine(line.blocks),
  }));
}

/** Positive-scoring lines, lowest first so the strongest plays last; ties keep discovery order. */
export function presentationOrder(lines: readonly ScoredLine[]): ScoredLine[] {
  return lines.filter(({ points }) => points > 0).sort((a, b) => a.points - b.points);
}
