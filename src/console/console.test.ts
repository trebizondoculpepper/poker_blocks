import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "../cards";
import { dealerRegistry } from "../dealer";
import { GameRun } from "../game-run";
import { demoRunRules } from "../run-rules";
import { completionsAt, remember, splitStatements, tokenise } from "./command-line";
import { candidates, runLine, type ConsoleHost } from "./commands";
import { isConsoleKey } from "./console-view";

function fakeHost(copies = true) {
  const game = new GameRun(dealerRegistry, demoRunRules, standardDeck);
  const calls: string[] = [];
  let now: string | null = null;
  const host: ConsoleHost = {
    game: () => game,
    screen: () => "game",
    next: () => void calls.push("next"),
    newGame: () => void calls.push("new"),
    home: () => void calls.push("home"),
    hardReset: () => void calls.push("hardReset"),
    mode: () => null,
    modes: () => ["dev0", "dev1", "dev2", "dev3"],
    resetMode: (mode: string | null) => void calls.push(`reset ${mode}`),
    forceOutcome: (outcome: "won" | "lost") => game.forceOutcome(outcome),
    adjustCoins: (delta) => game.adjustCoins(delta),
    musicTracks: () => ["style-noir", "solitaire-boss"],
    musicNow: () => now,
    playMusic: (id) => void (now = id),
    stopMusic: () => void (now = null),
    snapshot: () => '{\n  "schema": 1\n}',
    copyText: async (text) => {
      calls.push(`copy ${text.length}`);
      return copies;
    },
    say: (text, tone) => void calls.push(`${tone}: ${text}`),
    clear: () => void calls.push("clear"),
    history: () => ["help", "status"],
  };
  return { host, calls, game, text: (line: string) => runLine(host, line).map((l) => l.text) };
}

describe("debug snapshot (#987)", () => {
  it("prints the snapshot and reports a copy", async () => {
    const { text, calls } = fakeHost();
    expect(text("debug snapshot")).toEqual(["{", '  "schema": 1', "}"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toContain("output: snapshot copied to the clipboard");
  });
  it("says to select the text when the clipboard refuses", async () => {
    const { text, calls } = fakeHost(false);
    text("debug snapshot");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toContain("error: could not copy: select the snapshot text above instead");
  });
});

describe("the console key", () => {
  it("is backquote or tilde", () => {
    expect(isConsoleKey("Backquote", "`")).toBe(true);
    expect(isConsoleKey("Backquote", "~")).toBe(true);
    expect(isConsoleKey("KeyA", "a")).toBe(false);
  });
});

describe("the command line", () => {
  it("splits statements and words like Quake", () => {
    expect(splitStatements('echo "a;b"; help')).toEqual(['echo "a;b"', "help"]);
    expect(tokenise('echo "two words" x')).toEqual(["echo", "two words", "x"]);
  });

  it("keeps history without an immediate repeat", () => {
    expect(remember(["a"], "a")).toEqual(["a"]);
    expect(remember(["a"], "b")).toEqual(["a", "b"]);
  });

  it("completes command names and music tracks", () => {
    const { host } = fakeHost();
    const at = (line: string) =>
      completionsAt(line, line.length, (before) => candidates(host, before)).matches;
    expect(at("mu")).toEqual(["music"]);
    expect(at("music sol")).toEqual(["solitaire-boss"]);
  });
});

describe("the commands", () => {
  it("lists the commands", () => {
    expect(fakeHost().text("help")[0]).toMatch(/^Commands/);
  });

  it("reports the game's status", () => {
    const { text } = fakeHost();
    const lines = text("status");
    expect(lines[0]).toMatch(/phase stage-1/);
    expect(lines[2]).toMatch(/^hand \d+/);
  });

  it("wins or loses the stage on demand", () => {
    const { text, calls, game } = fakeHost();
    expect(text("win")).toEqual(["stage won"]);
    expect(game.state.round.score).toBeGreaterThanOrEqual(game.state.round.targetScore);
    const lost = fakeHost();
    lost.text("lose");
    expect(lost.game.state.round.movesLeft).toBe(0);
    expect(lost.calls).toContain("next");
    expect(calls).not.toContain("next");
  });

  it("adds and removes coins without allowing a negative balance", () => {
    const { text, game } = fakeHost();
    expect(text("coins")).toEqual(["0 coins"]);
    expect(text("coins +5")).toEqual(["5 coins"]);
    expect(text("coins -2")).toEqual(["3 coins"]);
    expect(text("coins -8")).toEqual(["0 coins"]);
    expect(text("coins 4")[0]).toMatch(/use \+N or -N/);
    expect(game.state.coins).toBe(0);
  });

  it("resets a dev mode by name, or the current game", () => {
    const { text, calls } = fakeHost();
    expect(text("reset dev2")).toEqual(["resetting dev2"]);
    expect(text("reset")).toEqual(["new run"]);
    expect(text("reset dev9")[0]).toMatch(/no mode/);
    expect(calls).toEqual(["reset dev2", "reset null"]);
  });

  it("recognises a multi-word command, and leaves single-word ones alone (#149)", () => {
    const { text, calls } = fakeHost();
    expect(text("hard reset")).toEqual(["run discarded"]);
    expect(calls).toEqual(["hardReset"]);
    calls.length = 0;
    // `reset` must still mean reset, not be shadowed by the longer name.
    expect(text("reset")).toEqual(["new run"]);
    expect(calls).toEqual(["reset null"]);
  });

  it("goes home to the main menu", () => {
    const { text, calls } = fakeHost();
    expect(text("home")).toEqual(["main menu"]);
    expect(calls).toEqual(["home"]);
  });

  it("switches music and refuses unknown tracks", () => {
    const { text } = fakeHost();
    text("music style-noir");
    expect(text("music")).toEqual(["style-noir"]);
    expect(text("music nope")[0]).toMatch(/no track/);
    expect(text("music list")).toContain("* style-noir");
  });

  it("runs several statements and reports unknown ones", () => {
    const { text, calls } = fakeHost();
    expect(text("clear; echo hi")).toEqual(["hi"]);
    expect(calls).toEqual(["clear"]);
  });

  it("evaluates anything else as JavaScript with game in scope", () => {
    const { text, game } = fakeHost();
    expect(text("game.state.hand.length")).toEqual([String(game.state.hand.length)]);
    expect(text("1 +")[0]).toMatch(/Unexpected|SyntaxError|expected/i);
    expect(text('echo("from js")')).toEqual(["from js"]);
  });
});
