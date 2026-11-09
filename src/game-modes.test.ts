import { describe, expect, it } from "vite-plus/test";
import {
  developerModes,
  fieldPlacementActive,
  overlaysForPhase,
  gameModeFor,
  gameModeFromParams,
  modeSceneId,
} from "./game-modes";
import { saveKey } from "./save";
import { createModeMusicBehaviours } from "./mode-music";

describe("game modes composed from traits", () => {
  it("opens modes by id or alias, and the normal game otherwise", () => {
    expect(gameModeFor(null).id).toBe("game");
    expect(gameModeFor("dev2").id).toBe("dev2");
    expect(gameModeFor("dev").id).toBe("dev0");
    expect(gameModeFor("nonsense").id).toBe("game");
    expect(developerModes()).toEqual(["dev0", "dev1", "dev2", "dev3", "dev4"]);
  });

  it("opens a mode from ?mode=, falling back to the legacy ?room= alias", () => {
    const opened = (search: string) => gameModeFromParams(new URLSearchParams(search)).id;
    expect(opened("mode=dev2")).toBe("dev2");
    expect(opened("room=dev3")).toBe("dev3");
    expect(opened("room=dev")).toBe("dev0");
    expect(opened("mode=dev1&room=dev3")).toBe("dev1");
    expect(opened("")).toBe("game");
  });

  it("lists, links and restarts modes through their console and restartable traits", async () => {
    const { modeConsoleNames, modeLink, wantsRestart } = await import("./game-modes");
    const restart = new URLSearchParams("room=dev2&restart=true");
    expect(modeConsoleNames(gameModeFor(null))).toEqual([]);
    expect(modeConsoleNames(gameModeFor("dev2"))).toEqual(["dev2"]);
    expect(wantsRestart(gameModeFor("dev2"), restart)).toBe(true);
    expect(wantsRestart(gameModeFor("dev2"), new URLSearchParams("room=dev2"))).toBe(false);
    expect(wantsRestart(gameModeFor(null), new URLSearchParams("restart=true"))).toBe(false);
    const base = "http://x/?room=dev2&restart=true&debug=1";
    expect(modeLink(gameModeFor("dev3"), base).search).toBe("?debug=1&mode=dev3");
    expect(modeLink(gameModeFor(null), base).search).toBe("?restart=true&debug=1");
  });

  it("keeps each mode's behaviour in its traits", () => {
    expect(gameModeFor(null).traits).toEqual({
      save: { key: saveKey },
      stage: { fieldPlacement: {}, overlays: { round: {}, deck: {} } },
      passiveRack: { capacity: 5 },
      shop: { passiveOffers: 2, cardOffers: 3, overlays: { coins: {}, shopExit: {} } },
    });
    expect(gameModeFor("dev2").traits.passiveRack).toEqual({ capacity: 5, startWith: 2 });
    expect(gameModeFor("dev1").traits.materialSample).toEqual({});
    expect(gameModeFor("dev0").traits.sandbox).toBeUndefined();
    expect(gameModeFor("dev3").traits.shopPreview).toEqual({ coins: 5 });
    expect(gameModeFor("dev3").traits.shop).toEqual({
      passiveOffers: 2,
      cardOffers: 3,
      overlays: { coins: {}, shopExit: {} },
    });
    expect(gameModeFor("dev3").traits.skipTitle).toEqual({ resume: true });
    expect(gameModeFor("dev1").musicStyle).toBe("quiet");
    expect(gameModeFor(null).musicStyle).toBe("ordinary");
    expect(fieldPlacementActive(gameModeFor("dev3").traits, "stage")).toBe(true);
    expect(fieldPlacementActive(gameModeFor("dev3").traits, "shop")).toBe(false);
    expect(overlaysForPhase(gameModeFor(null).traits, "stage-1")).toEqual({ round: {}, deck: {} });
    expect(overlaysForPhase(gameModeFor(null).traits, "shop")).toEqual({
      coins: {},
      shopExit: {},
    });
  });

  it("gives every mode a registered scene set and an explicit start scene", () => {
    for (const id of ["game", ...developerModes()]) {
      const mode = gameModeFor(id);
      expect(mode.scenes.some(({ id: scene }) => scene === modeSceneId(id, mode.startScene))).toBe(
        true,
      );
      expect(new Set(mode.scenes.map(({ id: scene }) => scene)).size).toBe(mode.scenes.length);
    }
    expect(gameModeFor("dev3").startScene).toBe("shop");
    expect(gameModeFor("dev1").startScene).toBe("stage-1");
    expect(gameModeFor("dev4").scenes.find(({ id }) => id === "dev4/stage-1")?.traits).toEqual({
      screen: { kind: "stage-1" },
      devManualBlockDestroyer: { cause: "manual" },
    });
  });
});

describe("mode music lifecycle", () => {
  it("keeps quiet modes wound down when their game screen resumes", () => {
    const calls: string[] = [];
    const behaviours = createModeMusicBehaviours({
      windDown: () => calls.push("windDown"),
      resumeStage: () => calls.push("resumeStage"),
    });

    behaviours.quiet.settle();
    behaviours.quiet.resume();
    behaviours.ordinary.settle();
    behaviours.ordinary.resume();

    expect(calls).toEqual(["windDown", "windDown", "resumeStage"]);
  });
});

describe("the passive rack trait's capacity", () => {
  it("is enforced by the run: a full rack takes no more, and filling stops at it", async () => {
    const { GameRun } = await import("./game-run");
    const { dealerRegistry } = await import("./dealer");
    const { standardDeck } = await import("./cards");
    const { demoRunRules } = await import("./run-rules");
    const { createPassiveBlock } = await import("./passives");
    const game = new GameRun(
      dealerRegistry,
      { ...demoRunRules, rackCapacity: 2 },
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
