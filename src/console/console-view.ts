/**
 * The developer console, ported from simulation_of_boring_things: Quake's, dropped down
 * over the top of the view by the key left of 1 (` or ~), the log above a `]` prompt. It
 * takes the keyboard while it is down; the same key or Esc puts it away. Up and Down walk
 * the history (kept in localStorage), Tab completes, PageUp and PageDown scroll.
 */
import { applyCompletion, commonPrefix, completionsAt, remember } from "./command-line";
import type { Completion } from "./command-line";
import { candidates, runLine } from "./commands";
import type { ConsoleHost, ConsoleLine } from "./commands";

const HISTORY_KEY = "poker-blocks.console-history";
const SCREEN_LINES = 1000;

/** The console key: backquote/tilde, or the key left of 1 on ISO keyboards. */
export function isConsoleKey(code: string, key: string): boolean {
  if (code === "Backquote" || key === "~" || key === "`") return true;
  return code === "IntlBackslash" && ["§", "±", "¬"].includes(key);
}

const loadHistory = (): string[] => {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
};
const saveHistory = (history: readonly string[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Not kept: the console still works.
  }
};

export type GameConsole = {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  print(lines: readonly ConsoleLine[]): void;
  dispose(): void;
};

export function createConsole(
  hostOptions: Omit<ConsoleHost, "clear" | "history" | "say">,
): GameConsole {
  const panel = document.createElement("div");
  panel.className = "game-console";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Console");
  const screen = document.createElement("div");
  screen.className = "game-console-log";
  screen.setAttribute("role", "log");
  const row = document.createElement("label");
  row.className = "game-console-row";
  const prompt = document.createElement("span");
  prompt.textContent = "]";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("aria-label", "Console command");
  row.append(prompt, input);
  panel.append(screen, row);
  // Below the panel, the rest of the view: a click there keeps the console.
  const catcher = document.createElement("div");
  catcher.className = "game-console-catcher";
  catcher.hidden = true;
  catcher.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.focus();
  });
  document.body.append(catcher, panel);

  let history = loadHistory();
  // Where Up and Down are in the history; history.length is the line being typed.
  let at = history.length;
  let draft = "";
  // A Tab completion being cycled: its matches and which one is shown.
  let cycling: { completion: Completion; index: number } | null = null;

  const print = (lines: readonly ConsoleLine[]) => {
    const near = screen.scrollHeight - screen.scrollTop - screen.clientHeight < 40;
    for (const line of lines) {
      const div = document.createElement("div");
      div.className = `game-console-line is-${line.tone}`;
      div.textContent = line.text;
      screen.append(div);
    }
    while (screen.childElementCount > SCREEN_LINES) screen.firstElementChild?.remove();
    if (near) screen.scrollTop = screen.scrollHeight;
  };

  const host: ConsoleHost = {
    ...hostOptions,
    clear: () => screen.replaceChildren(),
    say: (text, tone) => print([{ text, tone }]),
    history: () => history,
  };

  print([
    { text: "Poker Blocks console. help lists the commands; ~ or Esc closes.", tone: "output" },
  ]);

  const isOpen = () => !panel.hidden;
  const open = () => {
    if (isOpen()) return;
    panel.hidden = false;
    catcher.hidden = false;
    screen.scrollTop = screen.scrollHeight;
    input.focus();
  };
  const close = () => {
    if (!isOpen()) return;
    panel.hidden = true;
    catcher.hidden = true;
    input.blur();
    cycling = null;
  };

  const submit = () => {
    const line = input.value;
    input.value = "";
    cycling = null;
    print([{ text: `] ${line}`, tone: "echo" }]);
    if (line.trim()) {
      history = remember(history, line);
      saveHistory(history);
    }
    at = history.length;
    draft = "";
    print(runLine(host, line));
    screen.scrollTop = screen.scrollHeight;
  };

  const setInput = (line: string, cursor: number) => {
    input.value = line;
    input.setSelectionRange(cursor, cursor);
  };

  const complete = () => {
    const cursor = input.selectionStart ?? input.value.length;
    if (cycling) {
      // Tab again: the next match in turn, in place of the last one shown.
      const { completion } = cycling;
      cycling.index = (cycling.index + 1) % completion.matches.length;
      const next = completion.matches[cycling.index];
      setInput(
        input.value.slice(0, completion.start) + next + input.value.slice(cursor),
        completion.start + next.length,
      );
      return;
    }
    const c = completionsAt(input.value, cursor, (before) => candidates(host, before));
    if (!c.matches.length) return;
    if (c.matches.length === 1) {
      const done = applyCompletion(input.value, cursor, c, c.matches[0], true);
      setInput(done.line, done.cursor);
      return;
    }
    const prefix = commonPrefix(c.matches);
    if (prefix.length > c.word.length) {
      const done = applyCompletion(input.value, cursor, c, prefix, false);
      setInput(done.line, done.cursor);
    } else {
      // Nothing more in common: show them, and Tab again cycles.
      print([{ text: c.matches.join("  "), tone: "output" }]);
      cycling = { completion: c, index: -1 };
    }
  };

  // Heard first, on the window: the console key from anywhere but another field; and,
  // while it is down, everything typed is its own.
  /** Moves through the history: -1 for older, +1 for newer. */
  const browseHistory = (step: number) => {
    if (at === history.length) draft = input.value;
    at = Math.max(0, Math.min(history.length, at + step));
    const line = at === history.length ? draft : history[at];
    setInput(line, line.length);
  };
  const scrollPage = (step: number) => screen.scrollBy({ top: step * screen.clientHeight * 0.8 });
  /**
   * The command line's keys. "handled" means the key keeps its tab-completion cycle
   * running instead of resetting it.
   */
  const lineKeys: Record<string, () => "handled" | void> = {
    Enter: () => submit(),
    Tab: () => {
      complete();
      return "handled";
    },
    ArrowUp: () => browseHistory(-1),
    ArrowDown: () => browseHistory(1),
    PageUp: () => scrollPage(-1),
    PageDown: () => scrollPage(1),
  };
  const keydown = (event: KeyboardEvent) => {
    if (isConsoleKey(event.code, event.key) && !event.ctrlKey && !event.metaKey) {
      const elsewhere =
        event.target !== input &&
        (event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement);
      if (elsewhere || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        if (isOpen()) close();
        else open();
      }
      return;
    }
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.target !== input) {
      // Typing elsewhere goes to the command line, but not a modifier or a shortcut, or
      // while text is selected (so it can be copied from the log).
      const selecting = (window.getSelection()?.toString() ?? "") !== "";
      const modifier = ["Meta", "Control", "Alt", "Shift", "OS"].includes(event.key);
      if (!modifier && !event.metaKey && !event.ctrlKey && !selecting) input.focus();
    } else if (Object.hasOwn(lineKeys, event.key)) {
      event.preventDefault();
      if (lineKeys[event.key]() === "handled") {
        event.stopImmediatePropagation();
        return;
      }
    }
    cycling = null;
    event.stopImmediatePropagation();
  };
  const keyup = (event: KeyboardEvent) => {
    if (isOpen()) event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", keydown, true);
  window.addEventListener("keyup", keyup, true);

  return {
    open,
    close,
    get isOpen() {
      return isOpen();
    },
    print,
    dispose() {
      close();
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      panel.remove();
      catcher.remove();
    },
  };
}
