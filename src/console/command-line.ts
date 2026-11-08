/**
 * The console's command line (ported from simulation_of_boring_things):
 * splitting a line into statements and words, as Quake's console did, the
 * history, and Tab completion. Pure.
 */

/** A line's statements, split at each `;` outside quotes. */
export function splitStatements(line: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === ";") {
      out.push(line.slice(start, i));
      start = i + 1;
    }
  }
  out.push(line.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** A statement's words: split at spaces, quotes keeping spaces in one. */
export function tokenise(statement: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let any = false;
  for (const c of statement) {
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      any = true;
    } else if (/\s/.test(c)) {
      if (word || any) words.push(word);
      word = "";
      any = false;
    } else word += c;
  }
  if (word || any) words.push(word);
  return words;
}

/** The history kept: the last lines run, newest last. */
export const HISTORY_LINES = 100;

/** `history` with `line` added, a repeat of the last one not kept twice. */
export function remember(
  history: readonly string[],
  line: string,
  limit = HISTORY_LINES,
): string[] {
  const text = line.trim();
  if (!text || history[history.length - 1] === text) return [...history];
  const all = [...history, text];
  return all.slice(Math.max(0, all.length - limit));
}

/** The longest start every one of `words` shares. */
export function commonPrefix(words: readonly string[]): string {
  if (!words.length) return "";
  let prefix = words[0];
  for (const w of words)
    while (!w.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  return prefix;
}

export interface Completion {
  /** Where the word being completed starts in the line. */
  start: number;
  /** The word as typed so far. */
  word: string;
  /** The candidates it may become, in order. */
  matches: string[];
}

/**
 * What the word before `cursor` may become: `candidates` is given the
 * words before it (none for the command's own name) and gives what may
 * come next.
 */
export function completionsAt(
  line: string,
  cursor: number,
  candidates: (before: string[]) => readonly string[],
): Completion {
  const head = line.slice(0, cursor);
  // Only the statement the cursor is in.
  const statementStart = head.lastIndexOf(";") + 1;
  const statement = head.slice(statementStart);
  const match = /(\S*)$/.exec(statement);
  const word = match ? match[1] : "";
  const start = cursor - word.length;
  const before = tokenise(statement.slice(0, statement.length - word.length));
  const lower = word.toLowerCase();
  const matches = [...new Set(candidates(before))].filter((c) => c.toLowerCase().startsWith(lower));
  return { start, word, matches };
}

/** `line` with the word at `c` replaced by `text`, and where the cursor goes. */
export function applyCompletion(
  line: string,
  cursor: number,
  c: Completion,
  text: string,
  finished: boolean,
) {
  // A finished word gets its space, unless one follows already.
  const rest = line.slice(cursor);
  const inserted = finished && !rest.startsWith(" ") ? `${text} ` : text;
  return {
    line: line.slice(0, c.start) + inserted + rest,
    cursor: c.start + inserted.length + (finished && rest.startsWith(" ") ? 1 : 0),
  };
}
