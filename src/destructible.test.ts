import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameRun } from "./game-run";
import { gameModeFor } from "./game-modes";
import { devManualBlockDestroyer } from "./scene-traits/dev-manual-block-destroyer";
import { demoRunRules, sandboxRunRules } from "./run-rules";
import { inspectBlock } from "./traits/inspectable";
import { blockCanDestroy } from "./block-trait-behaviours";
import { withDevDestructibleMix } from "./traits/destructible";

describe("the destructible trait", () => {
  it("only lets the causes it names destroy a block", () => {
    const [plain, marked] = [
      standardDeck[0],
      {
        ...standardDeck[1],
        traits: { ...standardDeck[1].traits, destructible: { by: ["manual" as const] } },
      },
    ];
    expect(blockCanDestroy(plain, "manual")).toBe(false);
    expect(blockCanDestroy(marked, "manual")).toBe(true);
  });

  it("marks a stable share of a deck, and says so in the description", () => {
    const deck = withDevDestructibleMix(standardDeck, { share: 0.5, by: ["manual"] });
    const marked = deck.filter((card) => blockCanDestroy(card, "manual"));
    expect(marked.length).toBeGreaterThan(10);
    expect(marked.length).toBeLessThan(42);
    const again = withDevDestructibleMix(standardDeck, { share: 0.5, by: ["manual"] });
    expect(again.filter((card) => blockCanDestroy(card, "manual")).map(({ id }) => id)).toEqual(
      marked.map(({ id }) => id),
    );
    expect(inspectBlock(marked[0])?.split("\n")[0]).toMatch(/Destructible$/);
    expect(withDevDestructibleMix(standardDeck)).toEqual(standardDeck);
  });
});

describe("GameRun.destroyBlock", () => {
  const session = () => {
    const deck = standardDeck.map((card) => ({
      ...card,
      traits: { ...card.traits, destructible: { by: ["manual" as const] } },
    }));
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), deck, () => 0);
    game.play({ cardId: game.state.hand[0].id });
    return game;
  };

  it("removes the block and leaves the score, plays and discards alone", () => {
    const game = session();
    const [placed] = game.state.field;
    const { score, movesLeft, discardsLeft } = game.state.round;
    expect(game.destroyBlock(placed.block.id, "manual")).toEqual(placed);
    expect(game.state.field).toEqual([]);
    // Destroyed for good (#659): not in the discard pile, so it can never come back.
    expect(game.state.discardPile).not.toContain(placed.block);
    expect(game.state.round).toMatchObject({ score, movesLeft, discardsLeft });
  });

  it("refuses blocks that are not on the field or not destructible", () => {
    const game = new GameRun(dealerRegistry, demoRunRules, standardDeck, () => 0);
    game.play({ cardId: game.state.hand[0].id });
    expect(game.destroyBlock(game.state.field[0].block.id, "manual")).toBeNull();
    expect(game.destroyBlock("no-such-block", "manual")).toBeNull();
    expect(game.state.field).toHaveLength(1);
  });
});

describe("a run with a destroyed block", () => {
  it("still saves and loads", async () => {
    const { fromSaveRecord, toSaveRecord } = await import("./save");
    const deck = standardDeck.map((card) => ({
      ...card,
      traits: { ...card.traits, destructible: { by: ["manual" as const] } },
    }));
    const game = new GameRun(dealerRegistry, sandboxRunRules(demoRunRules), deck, () => 0);
    game.play({ cardId: game.state.hand[0].id });
    game.destroyBlock(game.state.field[0].block.id, "manual");
    const record = JSON.parse(JSON.stringify(toSaveRecord(game.snapshot())));
    expect(fromSaveRecord(record, deck, dealerRegistry)?.state.field).toEqual([]);
  });
});

describe("DevManualBlockDestroyer", () => {
  const calls: string[] = [];
  const context = {
    services: {
      board: {
        blockAt: (x: number) => (x > 0 ? "7-hearts" : undefined),
        destroy: (id: string, cause: string) => calls.push(`${id} ${cause}`) > 0,
      },
    },
  };
  const trait = devManualBlockDestroyer<typeof context>();
  const event = (type: string, clientX: number) => ({ type, clientX, clientY: 0 });

  it("destroys the block under a double-click with its cause, and consumes the event", () => {
    expect(trait.handles!(context, { cause: "manual" }, event("dblclick", 5))).toBe(true);
    expect(calls).toEqual(["7-hearts manual"]);
  });

  it("ignores other input and double-clicks on empty space", () => {
    expect(trait.handles!(context, { cause: "manual" }, event("click", 5))).toBe(false);
    expect(trait.handles!(context, { cause: "manual" }, event("dblclick", -5))).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("is composed only into dev4's play scenes", () => {
    const dev4 = gameModeFor("dev4");
    const traitsOf = (name: string) =>
      dev4.scenes.find(({ id }) => id.endsWith(`/${name}`))!.traits;
    expect(traitsOf("stage-1").devManualBlockDestroyer).toEqual({ cause: "manual" });
    expect(traitsOf("shop").devManualBlockDestroyer).toBeUndefined();
    for (const mode of ["game", "dev0", "dev1", "dev2", "dev3"])
      expect(gameModeFor(mode).scenes.some(({ traits }) => traits.devManualBlockDestroyer)).toBe(
        false,
      );
  });
});
