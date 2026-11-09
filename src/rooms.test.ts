import { describe, expect, it } from "vite-plus/test";
import { devRooms, fieldPlacementActive, overlaysForPhase, roomFor, roomSceneId } from "./rooms";
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
      stage: { fieldPlacement: {}, overlays: { round: {}, deck: {} } },
      passiveRack: { capacity: 5 },
      shop: { passiveOffers: 2, cardOffers: 3, overlays: { coins: {}, shopExit: {} } },
    });
    expect(roomFor("dev2").traits.passiveRack).toEqual({ capacity: 5, startWith: 2 });
    expect(roomFor("dev1").traits.materialSample).toEqual({});
    expect(roomFor("dev0").traits.sandbox).toBeUndefined();
    expect(roomFor("dev3").traits.shopPreview).toEqual({ coins: 5 });
    expect(roomFor("dev3").traits.shop).toEqual({
      passiveOffers: 2,
      cardOffers: 3,
      overlays: { coins: {}, shopExit: {} },
    });
    expect(roomFor("dev3").traits.skipTitle).toEqual({ resume: true });
    expect(fieldPlacementActive(roomFor("dev3").traits, "stage")).toBe(true);
    expect(fieldPlacementActive(roomFor("dev3").traits, "shop")).toBe(false);
    expect(overlaysForPhase(roomFor(null).traits, "stage-1")).toEqual({ round: {}, deck: {} });
    expect(overlaysForPhase(roomFor(null).traits, "shop")).toEqual({
      coins: {},
      shopExit: {},
    });
  });

  it("gives every mode a registered scene set and an explicit start scene", () => {
    for (const id of ["game", ...devRooms()]) {
      const room = roomFor(id);
      expect(room.scenes.some(({ id: scene }) => scene === roomSceneId(id, room.startScene))).toBe(
        true,
      );
      expect(new Set(room.scenes.map(({ id: scene }) => scene)).size).toBe(room.scenes.length);
    }
    expect(roomFor("dev3").startScene).toBe("shop");
    expect(roomFor("dev1").startScene).toBe("stage-1");
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
