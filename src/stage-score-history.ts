/**
 * Per-stage score history as model data (#1063; doc/line-goes-up.md, "Stage history is model
 * data"). A stage starts with the point (play 0, total 0); each committed scoring play appends one
 * entry from the scoring commit itself, never from presentation. Discards, refusals, previews and
 * loading append nothing. The value is plain, immutable and saved through the normal codec.
 */

/** One committed scoring play. */
export type StageScoreEntry = {
  /** The committed action that scored, so a duplicate publication never appends twice. */
  actionId: string;
  /** One-based play index within the stage. */
  play: number;
  /** Points this play awarded (may be zero). */
  delta: number;
  /** Stage total after this play. */
  total: number;
};

export type StageScoreHistory = {
  /** Opaque: changes each time a stage initializes its history. */
  generation: number;
  /** The stage's resolved play allowance (`StageRules.plays`). */
  plays: number;
  targetScore: number;
  /**
   * The first known point. A new stage starts at (0, 0); a migrated legacy save starts at its
   * saved checkpoint, and the samples before it are unavailable (`complete` is false).
   */
  start: { play: number; total: number };
  complete: boolean;
  entries: readonly StageScoreEntry[];
};

/** A fresh history for a stage that is starting, with its configured allowance and target. */
export function startStageHistory(
  rules: { plays: number; targetScore: number },
  previous?: StageScoreHistory,
): StageScoreHistory {
  return {
    generation: (previous?.generation ?? 0) + 1,
    plays: rules.plays,
    targetScore: rules.targetScore,
    start: { play: 0, total: 0 },
    complete: true,
    entries: [],
  };
}

/** The last known point: the latest entry, or the start. */
export function latestPoint(history: StageScoreHistory): { play: number; total: number } {
  const last = history.entries.at(-1);
  return last ? { play: last.play, total: last.total } : history.start;
}

/**
 * Append one committed scoring play. Returns the history unchanged when this action already
 * appended (exactly once per committed action).
 */
export function appendStagePlay(
  history: StageScoreHistory,
  play: { actionId: string; delta: number },
): StageScoreHistory {
  if (history.entries.some(({ actionId }) => actionId === play.actionId)) return history;
  const last = latestPoint(history);
  return {
    ...history,
    entries: [
      ...history.entries,
      {
        actionId: play.actionId,
        play: last.play + 1,
        delta: play.delta,
        total: last.total + play.delta,
      },
    ],
  };
}

/**
 * The history for a save written before it existed: the authoritative current score and used
 * plays as the known checkpoint, earlier samples unavailable. Null when the allowance can't be
 * resolved, so the view reports unavailable rather than guessing.
 */
export function legacyStageHistory(
  round: { score: number; targetScore: number; movesLeft: number },
  plays: number | null,
): StageScoreHistory | null {
  if (plays === null || !Number.isFinite(plays) || plays < round.movesLeft) return null;
  return {
    generation: 1,
    plays,
    targetScore: round.targetScore,
    start: { play: plays - round.movesLeft, total: round.score },
    complete: plays === round.movesLeft && round.score === 0,
    entries: [],
  };
}

const finiteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const count = (value: unknown): value is number =>
  finiteNonnegative(value) && Number.isInteger(value);

/**
 * Validate a saved history: finite nonnegative values, ordered unique plays and actions, and each
 * total equal to the previous total plus its delta. Null when invalid.
 */
export function parseStageHistory(value: unknown): StageScoreHistory | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const start = record.start as Record<string, unknown> | undefined;
  if (
    !count(record.generation) ||
    !count(record.plays) ||
    !finiteNonnegative(record.targetScore) ||
    typeof record.complete !== "boolean" ||
    typeof start !== "object" ||
    start === null ||
    !count(start.play) ||
    !finiteNonnegative(start.total) ||
    !Array.isArray(record.entries)
  )
    return null;
  const entries: StageScoreEntry[] = [];
  const actions = new Set<string>();
  let last = { play: start.play, total: start.total };
  for (const raw of record.entries as unknown[]) {
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.actionId !== "string" ||
      actions.has(entry.actionId) ||
      entry.play !== last.play + 1 ||
      !finiteNonnegative(entry.delta) ||
      !finiteNonnegative(entry.total) ||
      entry.total !== last.total + entry.delta
    )
      return null;
    actions.add(entry.actionId);
    entries.push({
      actionId: entry.actionId,
      play: entry.play,
      delta: entry.delta,
      total: entry.total,
    });
    last = { play: entry.play, total: entry.total };
  }
  return {
    generation: record.generation,
    plays: record.plays,
    targetScore: record.targetScore,
    start: { play: start.play, total: start.total },
    complete: record.complete,
    entries,
  };
}
