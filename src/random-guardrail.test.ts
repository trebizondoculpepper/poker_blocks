/**
 * Guardrail: gameplay randomness goes through the session randomizer (#134).
 *
 * A run must be replayable from its seed, which only holds if every gameplay random choice
 * draws from the session's stream in a fixed order. This test fails when a module starts
 * calling `Math.random` without being on the list below, so a new source of randomness cannot
 * bypass the stream by accident.
 *
 * Presentation randomness is deliberately exempt: the wobble of a placed block, which music
 * track plays, and a sound's variation would otherwise make a replay depend on how long
 * someone looked at the table. See doc/randomness.md.
 */
import { describe, expect, it } from "vite-plus/test";

/** Files allowed to call `Math.random`, each for a stated reason. */
const allowed: Readonly<Record<string, string>> = {
  "src/random.ts": "creating a session's secret seed",
  "src/letter-block.ts":
    "cosmetic writing materials; callers can inject a scene seed without consuming the run stream",
  "src/motion.ts": "the idle wobble of a block: presentation",
  "src/audio/music-plan.ts": "which track plays: presentation",
  "src/audio/music-controller.ts": "shuffling the music queue: presentation",
  "src/audio/sfx.ts": "a sound's variation: presentation",
  "src/tools/listening-room/main.ts": "a developer tool outside the game",
  "src/attract-scene.ts":
    "the title's cosmetic attract sequence: must not touch the session stream",
  // These take an injected `random` and the session always supplies its own stream. The
  // default only covers a caller that has no session (a test fixture, a scratch dealer).
  "src/deal.ts": "default for a caller with no session; the game passes the stream",
  "src/dealer.ts": "default for a caller with no session; the game passes the stream",
  "src/game-run.ts": "default for a caller with no session; the game passes the stream",
  "src/material-sampler.ts": "default for a caller with no session; the game passes the stream",
  "src/shop-stock.ts": "default for a caller with no session; the game passes the stream",
};

const sources = Object.entries(
  import.meta.glob<string>(["./**/*.ts", "!./**/*.test.ts", "!./**/*.d.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).map(([path, text]) => [`src/${path.slice(2)}`, text] as const);
const textOf = (file: string) => sources.find(([name]) => name === file)?.[1] ?? "";

describe("gameplay randomness goes through the session randomizer (#134)", () => {
  it("has no Math.random outside the allowed presentation and platform code", () => {
    const offenders = sources
      .filter(([, text]) => /Math\.random/.test(text))
      .map(([file]) => file)
      .filter((file) => !(file in allowed));
    expect(
      offenders,
      "Use the session randomizer (`src/random.ts`) with a context, or add a documented exemption.",
    ).toEqual([]);
  });

  it("keeps the allowed list honest: an entry that no longer calls Math.random is stale", () => {
    const calls = (file: string) => /Math\.random/.test(textOf(file));
    const stale = Object.keys(allowed).filter((file) => calls(file) === false);
    expect(stale, "Remove these from the allowed list in src/random-guardrail.test.ts").toEqual([]);
  });
});
