/**
 * Numbers about a whole run, shown on the game over screen and saved with the run.
 * Pure: the run calls these as plays land and stages end.
 */
export type RunStats = {
  /** Rounds finished (all three stages won, reaching the shop). */
  roundsCompleted: number;
  /** Every point scored this run, across all stages. */
  totalScore: number;
  /** The best total for one round (its three stages), including the round in progress. */
  bestRoundScore: number;
  /** Points scored so far in the current round. */
  roundScore: number;
  /** Blocks placed on the field. */
  blocksPlayed: number;
};

export const emptyRunStats: RunStats = {
  roundsCompleted: 0,
  totalScore: 0,
  bestRoundScore: 0,
  roundScore: 0,
  blocksPlayed: 0,
};

/** A play landed `blocks` blocks (one, or a line) and scored `points`. */
export function recordPlay(stats: RunStats, points: number, blocks = 1): RunStats {
  const roundScore = stats.roundScore + points;
  return {
    ...stats,
    blocksPlayed: stats.blocksPlayed + blocks,
    totalScore: stats.totalScore + points,
    roundScore,
    bestRoundScore: Math.max(stats.bestRoundScore, roundScore),
  };
}

/** The boss stage was won: the round is complete and the next one starts from zero. */
export function recordRoundComplete(stats: RunStats): RunStats {
  return { ...stats, roundsCompleted: stats.roundsCompleted + 1, roundScore: 0 };
}

/** Read saved stats, falling back to zeros for older saves or bad values. */
export function parseRunStats(value: unknown): RunStats {
  const record = (value ?? {}) as Partial<Record<keyof RunStats, unknown>>;
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  return {
    roundsCompleted: count(record.roundsCompleted),
    totalScore: count(record.totalScore),
    bestRoundScore: count(record.bestRoundScore),
    roundScore: count(record.roundScore),
    blocksPlayed: count(record.blocksPlayed),
  };
}
