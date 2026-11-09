import { describe, expect, it } from "vite-plus/test";
import { devRooms, fieldPlacementActive, overlaysForPhase, roomFor, roomSceneId } from "./rooms";
import { createRoomMusicBehaviours } from "./room-music";

describe("rooms composed from traits", () => {
  it("opens rooms by id or alias, and the normal game otherwise", () => {
    expect(roomFor(null).id).toBe("game");
    expect(roomFor("dev2").id).toBe("dev2");
    expect(roomFor("dev").id).toBe("dev0");
    expect(roomFor("nonsense").id).toBe("game");
    expect(devRooms()).toEqual(["dev0", "dev1", "dev2", "dev3"]);
  });

  it("lists, links and restarts rooms through their console and restartable traits", async () => {
    const { consoleNames, roomLink, wantsRestart } = await import("./rooms");
    const restart = new URLSearchParams("room=dev2&restart=true");
    expect(consoleNames(roomFor(null))).toEqual([]);
    expect(consoleNames(roomFor("dev2"))).toEqual(["dev2"]);
    expect(wantsRestart(roomFor("dev2"), restart)).toBe(true);
    expect(wantsRestart(roomFor("dev2"), new URLSearchParams("room=dev2"))).toBe(false);
    expect(wantsRestart(roomFor(null), new URLSearchParams("restart=true"))).toBe(false);
    const base = "http://x/?room=dev2&restart=true&debug=1";
    expect(roomLink(roomFor("dev3"), base).search).toBe("?debug=1&room=dev3");
    expect(roomLink(roomFor(null), base).search).toBe("?restart=true&debug=1");
  });

  it("keeps each room's behaviour in its traits", () => {
    expect(roomFor(null).traits).toEqual({
      music: { mode: "ordinary" },
      stage: { fieldPlacement: {}, overlays: { round: {}, deck: {} } },
      passiveRack: { capacity: 5 },
      shop: { passiveOffers: 2, cardOffers: 3, overlays: { coins: {}, shopExit: {} } },
    });
    expect(roomFor(null).runConfig).toEqual({
      saveKey: "poker-blocks.run",
      resumeSavedRun: true,
      transformers: [],
    });
    expect(roomFor("dev2").traits.passiveRack).toEqual({ capacity: 5, startWith: 2 });
    expect(roomFor("dev1").runConfig.transformers).toEqual([
      { type: "sandbox" },
      { type: "materialDeck", reshuffle: "each-run" },
      { type: "materialSample" },
    ]);
    expect(roomFor("dev0").runConfig.transformers).not.toContainEqual({ type: "sandbox" });
    expect(roomFor("dev3").runConfig.transformers).toContainEqual({
      type: "shopPreview",
      coins: 5,
    });
    expect(roomFor("dev3").traits.shop).toEqual({
      passiveOffers: 2,
      cardOffers: 3,
      overlays: { coins: {}, shopExit: {} },
    });
    expect(roomFor("dev3").runConfig.resumeSavedRun).toBe(true);
    expect(roomFor("dev1").traits.music.mode).toBe("quiet");
    expect(roomFor(null).traits.music.mode).toBe("ordinary");
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

describe("room music lifecycle", () => {
  it("keeps quiet rooms wound down when their game screen resumes", () => {
    const calls: string[] = [];
    const behaviours = createRoomMusicBehaviours({
      windDown: () => calls.push("windDown"),
      resumeStage: () => calls.push("resumeStage"),
      playBoss: () => calls.push("boss"),
      playRandomStage: () => calls.push("random"),
    });

    behaviours.quiet.settle();
    behaviours.quiet.resume();
    behaviours.quiet.playStage(true);
    behaviours.ordinary.settle();
    behaviours.ordinary.resume();
    behaviours.ordinary.playStage(true);
    behaviours.ordinary.playStage(false);

    expect(calls).toEqual(["windDown", "windDown", "windDown", "resumeStage", "boss", "random"]);
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
