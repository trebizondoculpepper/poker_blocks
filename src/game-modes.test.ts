import { describe, expect, it } from "vite-plus/test";
import {
  developerModes,
  gameModeFor,
  gameModeFromParams,
  modeSceneId,
  sceneNames,
  type SceneName,
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

  it("decides from a trait whether a page opening in play resumes its saved run", () => {
    // Opening in play and continuing are independent decisions. dev1 opens in play but always
    // deals a new run; dev2-dev4 open in play and continue; the normal game opens on the title.
    for (const id of ["dev1", "dev2", "dev3", "dev4"]) {
      expect(gameModeFor(id).opensInPlay).toEqual({});
    }
    expect(gameModeFor("dev1").resumeSavedRun).toBeUndefined();
    for (const id of ["dev0", "dev2", "dev3", "dev4"]) {
      expect(gameModeFor(id).resumeSavedRun).toEqual({});
    }
    expect(gameModeFor(null).startScene).toBe("title");
    expect(gameModeFor(null).opensInPlay).toBeUndefined();
  });

  it("keeps mode-wide configuration in traits and run setup out of them", () => {
    expect(gameModeFor(null).traits).toEqual({
      save: { key: saveKey },
      passiveRack: { capacity: 5 },
      shop: { passiveOffers: 2, cardOffers: 3 },
      music: { style: "ordinary" },
    });
    expect(gameModeFor(null).runSetup).toEqual([]);
    expect(gameModeFor("dev1").runSetup).toEqual([
      { step: "sandbox" },
      { step: "materialDeck" },
      { step: "materialSample" },
    ]);
    expect(gameModeFor("dev0").runSetup).not.toContainEqual({ step: "sandbox" });
    expect(gameModeFor("dev2").runSetup).toContainEqual({ step: "startingPassives", count: 2 });
    expect(gameModeFor("dev3").runSetup).toEqual([{ step: "shopPreview", coins: 5 }]);
    expect(gameModeFor("dev4").runSetup).toContainEqual({
      step: "destructibleMix",
      share: 0.5,
      by: ["manual"],
    });
    expect(gameModeFor("dev1").traits.music.style).toBe("quiet");
    expect(gameModeFor(null).traits.music.style).toBe("ordinary");
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
    expect(gameModeFor(null).startScene).toBe("title");
  });

  it("composes HUD panels, field placement and shop stock into the scenes that need them", () => {
    const traitsOf = (mode: string, scene: SceneName) =>
      gameModeFor(mode).scenes.find(({ id }) => id === modeSceneId(mode, scene))!.traits;
    for (const stage of ["stage-1", "stage-2", "boss"] as const) {
      expect(traitsOf("game", stage)).toMatchObject({
        roundPanel: {},
        deckPanel: {},
        fieldPlacement: {},
      });
      expect(traitsOf("game", stage)).not.toHaveProperty("coinsPanel");
      expect(traitsOf("game", stage)).not.toHaveProperty("shopStock");
    }
    expect(traitsOf("game", "shop")).toEqual({
      screen: { kind: "shop" },
      coinsPanel: {},
      shopExit: {},
      shopStock: {},
    });
    // The title, stage-won and game-over scenes show no panels of their own.
    expect(traitsOf("game", "title")).toEqual({ screen: { kind: "title" } });
    expect(traitsOf("game", "game-over")).toEqual({ screen: { kind: "game-over" } });
  });

  it("lets a mode add a play-scene trait without disturbing the rest", () => {
    const boss = gameModeFor("dev4").scenes.find(({ id }) => id === "dev4/stage-1")!;
    expect(boss.traits).toEqual({
      screen: { kind: "stage-1" },
      roundPanel: {},
      deckPanel: {},
      fieldPlacement: {},
      devManualBlockDestroyer: { cause: "manual" },
    });
    // Every mode lists every scene, so a mode never loses a scene it did not mention.
    expect(gameModeFor("dev4").scenes).toHaveLength(sceneNames.length);
  });
});

describe("mode music lifecycle", () => {
  it("keeps quiet modes wound down and gives ordinary modes a track per stage", () => {
    const calls: string[] = [];
    const behaviours = createModeMusicBehaviours({
      windDown: () => calls.push("windDown"),
      resumeStage: () => calls.push("resumeStage"),
      playBoss: () => calls.push("boss"),
      playRandomStage: () => calls.push("random"),
    });

    behaviours.quiet.settle();
    behaviours.quiet.resume();
    behaviours.quiet.playStage("boss");
    behaviours.ordinary.settle();
    behaviours.ordinary.resume();
    behaviours.ordinary.playStage("boss");
    behaviours.ordinary.playStage("stage");

    expect(calls).toEqual(["windDown", "windDown", "windDown", "resumeStage", "boss", "random"]);
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
