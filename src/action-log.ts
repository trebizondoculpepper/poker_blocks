/**
 * The action log: a rolling record of interaction events and the game's callbacks, with precise
 * timestamps, for debugging (drag and drop first). It records only while something has started
 * it (the `actionHistory` scene trait), so a mode that doesn't compose that trait pays nothing.
 *
 * Each entry has a `performance.now()` time and the frame it happened in, so two entries in the
 * same frame can be told apart from two a frame apart. Pointer moves are not stored one by one:
 * each run of moves is summarised in a single entry that updates as the pointer moves.
 * Recording never changes what the game does.
 */

export type ActionEntry = {
  /** `performance.now()` when it happened, in milliseconds. */
  at: number;
  /** The frame it happened in (the main loop's count). */
  frame: number;
  /** Where it came from: `pointer`, `input`, `state`, `window`, … */
  source: string;
  event: string;
  detail: string;
};

export type ActionLog = {
  /** Begin recording; returns a function that stops it (recording runs while any are started). */
  start(): () => void;
  readonly recording: boolean;
  record(source: string, event: string, detail?: string): void;
  /** A pointer move: folded into one running entry per run of moves. */
  move(x: number, y: number): void;
  /** The main loop advanced a frame. */
  tick(): void;
  entries(): readonly ActionEntry[];
};

export function createActionLog(
  limit = 100,
  now: () => number = () => performance.now(),
): ActionLog {
  const entries: ActionEntry[] = [];
  let starts = 0;
  let frame = 0;
  /** The current run of moves, while the last entry is that run's summary. */
  let moves: { entry: ActionEntry; count: number; first: number } | null = null;

  function push(entry: ActionEntry): void {
    entries.push(entry);
    if (entries.length > limit) entries.shift();
  }

  return {
    start() {
      starts++;
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        starts--;
      };
    },
    get recording() {
      return starts > 0;
    },
    record(source, event, detail = "") {
      if (starts === 0) return;
      moves = null;
      push({ at: now(), frame, source, event, detail });
    },
    move(x, y) {
      if (starts === 0) return;
      const at = now();
      if (!moves || entries[entries.length - 1] !== moves.entry) {
        moves = {
          entry: { at, frame, source: "pointer", event: "move", detail: "" },
          count: 0,
          first: at,
        };
        push(moves.entry);
      }
      moves.count++;
      moves.entry.detail = `×${moves.count} over ${(at - moves.first).toFixed(1)}ms, last at (${Math.round(x)},${Math.round(y)}) f${frame}`;
    },
    tick() {
      frame++;
    },
    entries: () => entries,
  };
}

/** The log as plain text, ready to paste: a header, then one entry per line, oldest first. */
export function formatActionLog(
  entries: readonly ActionEntry[],
  header: readonly [string, string][],
): string {
  const start = entries[0]?.at ?? 0;
  const lines = header.map(([key, value]) => `# ${key}: ${value}`);
  for (const { at, frame, source, event, detail } of entries)
    lines.push(
      `+${(at - start).toFixed(1).padStart(9)}ms f${String(frame).padEnd(6)} ${source.padEnd(8)} ${event}${detail ? `: ${detail}` : ""}`,
    );
  return `${lines.join("\n")}\n`;
}
