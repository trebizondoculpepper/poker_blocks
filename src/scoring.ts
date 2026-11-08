import { ranks, type CardBlock } from "./cards";
import type { PlacedBlock } from "./game-state";
import { cellKey, type Cell } from "./traits/attachable";

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
  | "straight-flush"
  | "five-of-a-kind";

/**
 * Provisional base score per hand type. The scoring formula is an open design
 * question (doc/game.md, "Hand value"); these numbers exist so a round can be
 * played and won, and are expected to be tuned or replaced.
 */
export const handBaseScores: Readonly<Record<HandType, number>> = {
  "high-card": 1,
  pair: 4,
  "two-pair": 10,
  "three-of-a-kind": 15,
  straight: 25,
  flush: 25,
  "full-house": 35,
  "four-of-a-kind": 50,
  "straight-flush": 80,
  "five-of-a-kind": 100,
};

/** Hand types from weakest to strongest; used to pick the best hand. */
export const handRanking: readonly HandType[] = [
  "high-card",
  "pair",
  "two-pair",
  "three-of-a-kind",
  "straight",
  "flush",
  "full-house",
  "four-of-a-kind",
  "straight-flush",
  "five-of-a-kind",
];

export type Line = {
  axis: Axis;
  blocks: readonly CardBlock[];
};

export type LineScore = {
  line: Line;
  hand: HandType;
  score: number;
};

const axes: readonly Axis[] = ["x", "y", "z"];

/** Every unbroken run of two or more placed blocks along each axis. */
export function findLines(field: readonly PlacedBlock[]): Line[] {
  const byCell = new Map(field.map((placed) => [cellKey(placed.cell), placed]));
  const lines: Line[] = [];
  for (const axis of axes) {
    for (const placed of field) {
      // Start a run only at its lowest cell, so each run is found once.
      if (byCell.has(cellKey(step(placed.cell, axis, -1)))) continue;
      const blocks: CardBlock[] = [];
      let cell: Cell = placed.cell;
      for (let next = byCell.get(cellKey(cell)); next; next = byCell.get(cellKey(cell))) {
        blocks.push(next.block);
        cell = step(cell, axis, 1);
      }
      if (blocks.length >= 2) lines.push({ axis, blocks });
    }
  }
  return lines;
}

function step(cell: Cell, axis: Axis, delta: number): Cell {
  return { ...cell, [axis]: cell[axis] + delta };
}

/** The best hand a line makes; lines over five blocks use their best five cards. */
export function evaluateLine(blocks: readonly CardBlock[]): HandType {
  if (blocks.length <= 5) return evaluateHand(blocks);
  let best: HandType = "high-card";
  for (const hand of combinations(blocks, 5)) {
    const type = evaluateHand(hand);
    if (handRanking.indexOf(type) > handRanking.indexOf(best)) best = type;
  }
  return best;
}

/** Classify up to five cards. Straights and flushes need exactly five. */
export function evaluateHand(blocks: readonly CardBlock[]): HandType {
  const counts = new Map<string, number>();
  for (const { traits } of blocks) {
    counts.set(traits.identity.rank, (counts.get(traits.identity.rank) ?? 0) + 1);
  }
  const groups = [...counts.values()].sort((a, b) => b - a);
  const five = blocks.length === 5;
  const flush = five && new Set(blocks.map((b) => b.traits.identity.suit.name)).size === 1;
  const straight = five && groups.length === 5 && isStraight(blocks);

  if (groups[0] >= 5) return "five-of-a-kind";
  if (straight && flush) return "straight-flush";
  if (groups[0] === 4) return "four-of-a-kind";
  if (groups[0] === 3 && groups[1] === 2) return "full-house";
  if (flush) return "flush";
  if (straight) return "straight";
  if (groups[0] === 3) return "three-of-a-kind";
  if (groups[0] === 2 && groups[1] === 2) return "two-pair";
  if (groups[0] === 2) return "pair";
  return "high-card";
}

/**
 * Aces count high or low; straights do not wrap (K-A-2 is not a straight).
 * This is a provisional answer to open question 10 in doc/game.md.
 */
function isStraight(blocks: readonly CardBlock[]): boolean {
  const values = blocks.map((b) => ranks.indexOf(b.traits.identity.rank)).sort((a, b) => a - b);
  const consecutive = (list: number[]) => list.every((v, i) => i === 0 || v === list[i - 1] + 1);
  if (consecutive(values)) return true;
  // Ace-high: treat the ace (index 0) as 13.
  return values[0] === 0 && consecutive([...values.slice(1), 13]);
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

/** Score every line on the field, as happens after each play. */
export function scoreField(field: readonly PlacedBlock[]): LineScore[] {
  return findLines(field).map((line) => {
    const hand = evaluateLine(line.blocks);
    return { line, hand, score: handBaseScores[hand] };
  });
}
