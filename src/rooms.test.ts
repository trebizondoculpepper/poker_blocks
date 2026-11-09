import { describe, expect, it } from "vite-plus/test";
import { devRooms, roomFor } from "./rooms";
import { saveKey } from "./save";

describe("rooms composed from traits", () => {
  it("opens rooms by id or alias, and the normal game otherwise", () => {
    expect(roomFor(null).id).toBe("game");
    expect(roomFor("dev2").id).toBe("dev2");
    expect(roomFor("dev").id).toBe("dev0");
    expect(roomFor("nonsense").id).toBe("game");
    expect(devRooms()).toEqual(["dev0", "dev1", "dev2", "dev3"]);
  });

  it("keeps each room's behaviour in its traits", () => {
    expect(roomFor(null).traits).toEqual({
      save: { key: saveKey },
      passiveRack: { capacity: 5 },
    });
    expect(roomFor("dev2").traits.passiveRack).toEqual({ capacity: 5, startWith: 2 });
    expect(roomFor("dev1").traits.materialSample).toEqual({});
    expect(roomFor("dev0").traits.sandbox).toBeUndefined();
    expect(roomFor("dev3").traits.shopPreview).toEqual({ coins: 5 });
    expect(roomFor("dev3").traits.skipTitle).toEqual({ resume: true });
  });
});

describe("the passive rack trait's capacity", () => {
  it("is enforced by the session: a full rack takes no more, and filling stops at it", async () => {
    const { GameSession } = await import("./game-session");
    const { dealerRegistry } = await import("./dealer");
    const { standardDeck } = await import("./cards");
    const { demoSessionConfig } = await import("./session-config");
    const { createPassiveBlock } = await import("./passives");
    const game = new GameSession(
      dealerRegistry,
      { ...demoSessionConfig, rackCapacity: 2 },
      standardDeck,
      () => 0,
    );
    game.fillPassiveRack(5);
    expect(game.state.passiveRack).toHaveLength(2);
    expect(game.installPassive(createPassiveBlock("do-nothing", "passive.extra"))).toBe(false);
    game.sellPassive(game.state.passiveRack[0].id);
    expect(game.installPassive(createPassiveBlock("do-nothing", "passive.extra"))).toBe(true);
  });
});
