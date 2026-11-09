/**
 * The console's commands, and running a line, as in simulation_of_boring_things: a line
 * that starts with a command's name runs Quake-style (`music style-noir`); anything else is
 * JavaScript with the commands as functions and `game` in scope (`game.state.hand.length`).
 * The app is reached only through `ConsoleHost`, so this module is pure but for what the
 * host does.
 */
import { cardName, type CardBlock } from "../cards";
import type { GameRun } from "../game-run";
import { splitStatements, tokenise } from "./command-line";

/** What the console may do to the app. */
export type ConsoleHost = {
  game(): GameRun;
  /** The screen showing: title, settings or the game. */
  screen(): string;
  /** Press the HUD's next-action button (next stage, shop, new round). */
  next(): void;
  newGame(): void;
  /** Go to the main menu (the title screen). */
  home(): void;
  /**
   * Discard the open mode's saved run, then go to the title screen. Player settings are kept.
   * Continue is disabled afterwards, because there is no longer a game in progress.
   */
  hardReset(): void;
  /** The dev mode open now ("dev0", "dev1", ...), or null in the normal game. */
  mode(): string | null;
  /** The dev modes available. */
  modes(): readonly string[];
  /** Open a dev mode with a fresh run; null (or the current mode) restarts the current mode. */
  resetMode(mode: string | null): void;
  /** Decide the current stage now (a developer shortcut); false outside a stage. */
  forceOutcome(outcome: "won" | "lost"): boolean;
  /** Adjust persistent coins; negative values remove them. */
  adjustCoins(delta: number): number;
  musicTracks(): readonly string[];
  musicNow(): string | null;
  playMusic(id: string): void;
  stopMusic(): void;
  /** Clear the console's screen. */
  clear(): void;
  history(): readonly string[];
};

export type Printed = string | readonly string[] | void;

export type ConsoleCommand = {
  name: string;
  usage: string;
  help: string;
  complete?(host: ConsoleHost, args: readonly string[]): readonly string[];
  run(host: ConsoleHost, args: readonly string[]): Printed;
};

export type ConsoleLine = { text: string; tone: "echo" | "output" | "error" };

const fail = (text: string): never => {
  throw new Error(text);
};

const cards = (blocks: readonly CardBlock[]): string =>
  blocks.length ? blocks.map((b) => cardName(b.traits.identity)).join(", ") : "(none)";

export const COMMANDS: readonly ConsoleCommand[] = [
  {
    name: "help",
    usage: "[command]",
    help: "list the commands, or say what one does",
    complete: () => COMMANDS.map((c) => c.name),
    run(_host, args) {
      // A command's name may be several words (`hard reset`), so the whole tail is the name.
      const name = args.join(" ");
      if (name) {
        const c = COMMAND_BY_NAME.get(name.toLowerCase());
        if (!c) return fail(`help: no command "${name}"`);
        return `${c.name} ${c.usage}  ${c.help}`.replace(/ {3,}/, "  ");
      }
      return [
        "Commands (Tab completes; ; separates; anything else is JavaScript, with these as functions and game in scope):",
        ...COMMANDS.map((c) => `  ${`${c.name} ${c.usage}`.padEnd(24)}${c.help}`),
      ];
    },
  },
  {
    name: "clear",
    usage: "",
    help: "clear the screen",
    run: (host) => host.clear(),
  },
  {
    name: "echo",
    usage: "<text>",
    help: "print the text",
    run: (_host, args) => args.join(" "),
  },
  {
    name: "history",
    usage: "",
    help: "the lines typed, oldest first",
    run: (host) => host.history().map((l, i) => `${String(i + 1).padStart(3)}  ${l}`),
  },
  {
    name: "status",
    usage: "",
    help: "the screen, phase, score and what is left",
    run(host) {
      const game = host.game();
      const { round, hand, deck, field, discardPile, coins } = game.state;
      return [
        `screen ${host.screen()}  round ${game.round}  phase ${game.phase}  dealer ${game.dealer.name}`,
        `score ${round.score} / ${round.targetScore}  moves ${round.movesLeft}  discards ${round.discardsLeft}`,
        `hand ${hand.length}  deck ${deck.length}  field ${field.length}  discarded ${discardPile.length}  coins ${coins}`,
        `music ${host.musicNow() ?? "(silent)"}`,
      ];
    },
  },
  {
    name: "hand",
    usage: "",
    help: "the cards in hand, left to right",
    run: (host) => cards(host.game().state.hand),
  },
  {
    name: "field",
    usage: "",
    help: "the cards on the table, with their cells",
    run(host) {
      const field = host.game().state.field;
      if (!field.length) return "(empty)";
      return field.map(
        ({ block, cell }) =>
          `  ${cardName(block.traits.identity)}  (${cell.x}, ${cell.y}, ${cell.z})`,
      );
    },
  },
  {
    name: "deck",
    usage: "",
    help: "the cards left in the deck, in draw order",
    run: (host) => cards(host.game().state.deck),
  },
  {
    name: "coins",
    usage: "[+N|-N]",
    help: "show coins, add coins (+N), or remove coins (-N)",
    run(host, [amount]) {
      if (amount === undefined) return `${host.game().state.coins} coins`;
      if (!/^[+-]\d+$/.test(amount)) return fail("coins: use +N or -N, for example coins +5");
      const delta = Number(amount);
      if (!Number.isSafeInteger(delta)) return fail("coins: amount is too large");
      return `${host.adjustCoins(delta)} coins`;
    },
  },
  {
    name: "next",
    usage: "",
    help: "press the next-action button: next stage, shop or round",
    run(host) {
      host.next();
      return `phase ${host.game().phase}`;
    },
  },
  {
    name: "win",
    usage: "",
    help: "meet this stage's target now (Next stage appears)",
    run(host) {
      if (!host.forceOutcome("won")) return fail("win: only during a stage");
      return "stage won";
    },
  },
  {
    name: "lose",
    usage: "",
    help: "lose this stage and go straight to game over",
    run(host) {
      if (!host.forceOutcome("lost")) return fail("lose: only during a stage");
      host.next();
      return `phase ${host.game().phase}`;
    },
  },
  {
    name: "home",
    usage: "",
    help: "go to the main menu",
    run(host) {
      host.home();
      return "main menu";
    },
  },
  {
    name: "reset",
    usage: "[mode]",
    help: "restart the current mode (rerolls dev2 passives), or open a fresh dev mode: reset dev2",
    complete: (host, args) => (args.length ? [] : host.modes()),
    run(host, [mode]) {
      const target = mode ? mode.toLowerCase() : host.mode();
      if (target && !host.modes().includes(target))
        return fail(`reset: no mode "${mode}" (modes are ${host.modes().join(", ")})`);
      host.resetMode(target);
      return target ? `resetting ${target}` : "new run";
    },
  },
  {
    name: "hard reset",
    usage: "",
    help: "discard the saved run and go to the title screen (settings are kept)",
    run(host) {
      host.hardReset();
      return "run discarded";
    },
  },
  {
    name: "newgame",
    usage: "",
    help: "start a new run",
    run(host) {
      host.newGame();
      return "new run";
    },
  },
  {
    name: "music",
    usage: "[list|stop|<track>]",
    help: "what is playing, the loops, or switch to one",
    complete: (host, args) => (args.length ? [] : ["list", "stop", ...host.musicTracks()]),
    run(host, [word]) {
      if (!word) return host.musicNow() ?? "(silent)";
      if (word === "list") {
        const now = host.musicNow();
        return host.musicTracks().map((id) => `${id === now ? "*" : " "} ${id}`);
      }
      if (word === "stop") {
        host.stopMusic();
        return "music stopped";
      }
      if (!host.musicTracks().includes(word))
        return fail(`music: no track "${word}" (music list shows them)`);
      host.playMusic(word);
      return `switching to ${word} on the next bar`;
    },
  },
];

const COMMAND_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

/**
 * The command a statement runs: the longest command name whose words the statement starts
 * with. Names are data, so a multi-word command (`hard reset`) needs no special case, and a
 * word that happens to be a command's only start (`reset` in "reset dev2") still matches.
 */
export function commandFor(statement: string): { command: ConsoleCommand; args: string[] } | null {
  try {
    const words = tokenise(statement);
    for (let count = words.length; count > 0; count--) {
      const command = COMMAND_BY_NAME.get(words.slice(0, count).join(" ").toLowerCase());
      if (command) return { command, args: words.slice(count) };
    }
  } catch {
    // Not a command line: an unquoted unterminated string is the evaluator's to report.
  }
  return null;
}

/** Whether a line starts with a command, without treating a tokenising failure as one. */
function matchesCommand(statement: string): boolean {
  return commandFor(statement) !== null;
}

/** What the word being completed may become, given the words before it. */
export function candidates(host: ConsoleHost, before: readonly string[]): readonly string[] {
  if (!before.length) return COMMANDS.map((c) => c.name);
  return COMMAND_BY_NAME.get(before[0].toLowerCase())?.complete?.(host, before.slice(1)) ?? [];
}

/** A value as the console shows it. */
export function formatValue(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [`[function ${value.name || "anonymous"}]`];
  try {
    const text = JSON.stringify(value, null, 2);
    return (text ?? Object.prototype.toString.call(value)).split("\n");
  } catch {
    // Circular or unserialisable: name its type instead.
    return [Object.prototype.toString.call(value)];
  }
}

/** Evaluate JavaScript with the commands as functions and `game` in scope. */
export function evaluate(
  source: string,
  host: ConsoleHost,
  print: (lines: string[]) => void,
): unknown {
  const scope: Record<string, unknown> = {};
  for (const c of COMMANDS) {
    // Only a name that is a valid identifier can be a JavaScript binding; `hard reset` is a
    // command line, not a callable in the scope.
    if (!/^[\w$]+$/.test(c.name)) continue;
    scope[c.name] = (...args: unknown[]) => {
      const printed = c.run(
        host,
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))),
      );
      if (printed !== undefined) print(typeof printed === "string" ? [printed] : [...printed]);
    };
  }
  scope.game = host.game();
  const names = Object.keys(scope);
  let fn: (...args: unknown[]) => unknown;
  try {
    // oxlint-disable-next-line typescript/no-implied-eval -- the console evaluates typed JavaScript
    fn = new Function(...names, `"use strict"; return (${source}\n);`) as typeof fn;
  } catch {
    // oxlint-disable-next-line typescript/no-implied-eval -- the console evaluates typed JavaScript
    fn = new Function(...names, `"use strict"; ${source}`) as typeof fn;
  }
  return fn(...names.map((n) => scope[n]));
}

/**
 * Run a line typed at the console: each statement as a command if it starts with one's
 * name, else the whole line as JavaScript. Returns what it prints, errors included.
 */
export function runLine(host: ConsoleHost, line: string): ConsoleLine[] {
  const out: ConsoleLine[] = [];
  const print = (lines: string[], tone: ConsoleLine["tone"] = "output") =>
    out.push(...lines.map((text) => ({ text, tone })));
  const statements = splitStatements(line);
  // A command is only considered when the line is not a call expression, and tokenising is
  // skipped entirely when it is: a broken JavaScript line must reach the evaluator to report
  // its own error, not fail while deciding whether it is a command.
  const javascript = /^[\w$]+\s*\(/.test(line.trim()) || !matchesCommand(statements[0] ?? "");
  try {
    if (javascript) {
      if (line.trim()) print(formatValue(evaluate(line, host, print)));
      return out;
    }
    for (const statement of statements) {
      const match = commandFor(statement);
      if (!match) {
        print([`no command "${tokenise(statement)[0] ?? ""}" (help lists them)`], "error");
        continue;
      }
      const printed = match.command.run(host, match.args);
      if (printed !== undefined) print(typeof printed === "string" ? [printed] : [...printed]);
    }
  } catch (e) {
    print([e instanceof Error ? e.message : String(e)], "error");
  }
  return out;
}
