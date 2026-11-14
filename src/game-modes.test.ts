import { describe, expect, it } from "vite-plus/test";
import {
  composeScenes,
  developerModes,
  gameModeRegistry,
  gameModeFor,
  gameModeFromParams,
  modeSceneId,
  sceneDefinitions,
  sceneNames,
  type SceneName,
  gameDialogs,
} from "./game-modes";
import { saveKey } from "./save";
import { createModeMusicBehaviours } from "./mode-music";
import { validateShopStock } from "./shop-stock-config";

describe("game modes composed from traits", () => {
  it("keeps every composed shop within its stock limits", () => {
    for (const id of gameModeRegistry.names()) {
      const shop = gameModeRegistry.get(id).traits.shop;
      if (shop) expect(validateShopStock(shop), id).toEqual([]);
    }
  });
  it("opens modes by id or alias, and the normal game otherwise", () => {
    expect(gameModeFor(null).id).toBe("game");
    expect(gameModeFor("dev2").id).toBe("dev2");
    expect(gameModeFor("dev").id).toBe("dev0");
    // Every developer room is dev followed by a number; the old names still open them.
    for (const id of gameModeRegistry.names().filter((name) => name !== "game"))
      expect(id).toMatch(/^dev\d+$/);
    expect(gameModeFor("dev-style").id).toBe("dev5");
    expect(gameModeFor("dev-custard").id).toBe("dev6");
    expect(gameModeFor("dev-attract").id).toBe("dev7");
    expect(gameModeFor("dev-balance").id).toBe("dev8");
    expect(gameModeFor("nonsense").id).toBe("game");
    expect(developerModes()).toEqual([
      "dev0",
      "dev1",
      "dev2",
      "dev3",
      "dev4",
      "dev5",
      "dev6",
      "dev7",
      "dev8",
      "dev9",
      "dev10",
      "dev11",
      "dev12",
      "dev13",
      "dev14",
      "dev15",
      "dev16",
      "dev17",
      "dev18",
      "dev19",
      "dev20",
    ]);
  });

  it("opens dev11 straight onto the title audition scene: background, title and music only", () => {
    const mode = gameModeFor("dev11");
    expect(mode.traits.onLoad).toBe("scene");
    expect(mode.startScene).toBe("title-audition");
    const scene = mode.scenes.find(({ id }) => id.endsWith("/title-audition"));
    expect(scene?.traits).toMatchObject({
      attractBackground: {},
      blockTitle: { text: "Poker Blocks", scale: 1 },
      musicCue: { operations: [{ op: "selectTrack", config: { plan: "title" } }] },
    });
    expect(scene?.traits).not.toHaveProperty("titleScreen");
  });

  it("opens dev13 on the menu block room, auditioning the game's menu items as word cubes (#303)", () => {
    const mode = gameModeFor("dev13");
    expect(mode.traits.onLoad).toBe("scene");
    expect(mode.startScene).toBe("menu-blocks");
    const scene = mode.scenes.find(({ id }) => id.endsWith("/menu-blocks"));
    const room = scene?.traits.devWordCubeRoom;
    expect(room?.items.map(({ label }) => label)).toEqual([
      "Continue",
      "New game",
      "Settings",
      "Start",
      "Cancel",
      "Resume",
      "Quit",
    ]);
    // One disabled example, explaining itself through its inspectable description.
    const disabled = room?.items.filter(({ enabled }) => enabled === false) ?? [];
    expect(disabled).toHaveLength(1);
    expect(disabled[0]?.description).toBeTruthy();
    expect(new Set(room?.items.map(({ action }) => action)).size).toBe(room?.items.length);
  });

  it("opens dev14 on the dialog room, composing every game dialog as its own trait (#347)", () => {
    const mode = gameModeFor("dev14");
    expect(mode.startScene).toBe("dialogs");
    const traits = mode.scenes.find(({ id }) => id.endsWith("/dialogs"))?.traits;
    expect(traits?.devDialogRoom?.seconds).toBeGreaterThan(0);
    expect(traits?.newGameDialog?.items.map(({ label }) => label)).toEqual(["Start", "Cancel"]);
    expect(traits?.pauseDialog?.items.map(({ label }) => label)).toEqual([
      "Resume",
      "Settings",
      "Quit",
    ]);
    for (const dialog of [traits?.titleMenuDialog, traits?.stageWonDialog, traits?.gameOverDialog])
      expect(dialog?.items.length).toBeGreaterThan(0);
  });

  it("opens a mode from ?mode=, falling back to the legacy ?room= alias", () => {
    const opened = (search: string) => gameModeFromParams(new URLSearchParams(search)).id;
    expect(opened("mode=dev2")).toBe("dev2");
    expect(opened("room=dev3")).toBe("dev3");
    expect(opened("room=dev")).toBe("dev0");
    expect(opened("mode=dev1&room=dev3")).toBe("dev1");
    expect(opened("")).toBe("game");
  });

  it("composes the balance editor only in its developer mode", () => {
    const editor = (mode: string) =>
      gameModeFor(mode).scenes.find(({ id }) => id.endsWith("/balance-editor"))?.traits
        .devShopBalanceEditor;
    expect(editor("game")).toBeUndefined();
    expect(editor("dev8")).toEqual({ backTo: "game" });
    expect(gameModeFor("dev8").traits.onLoad).toBe("scene");
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

  it("says what a page load does as configuration each mode is read for uniformly", () => {
    // `onLoad` is one value every mode carries, not a set of flags to check combination by
    // combination: the controller looks it up in a handler table.
    expect(gameModeFor(null).traits.onLoad).toBe("title");
    expect(gameModeFor("game").traits.onLoad).toBe("title");
    // dev1 opens in play but always deals a new run; dev2-dev4 continue their saved run.
    expect(gameModeFor("dev1").traits.onLoad).toBe("newRun");
    for (const id of ["dev2", "dev3", "dev4"]) {
      expect(gameModeFor(id).traits.onLoad).toBe("resume");
    }
  });

  it("keeps mode-wide configuration in traits and run setup out of them", () => {
    expect(gameModeFor(null).traits).toEqual({
      onLoad: "title",
      save: { key: saveKey },
      passiveRack: { capacity: 5 },
      shop: {
        minOffers: 5,
        maxOffers: 9,
        guaranteedPassives: 1,
        guaranteedCards: 1,
        itemSlots: 1,
      },
      music: { style: "ordinary" },
    });
    expect(gameModeFor(null).runSetup).toEqual([]);
    expect(gameModeFor("dev1").runSetup).toEqual([
      { step: "sandbox" },
      { step: "materialDeck", pool: "registered" },
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
        tableBackground: {},
        roundPanel: {},
        deckPanel: { opens: "openDeck" },
        dropTarget: {
          targets: [
            { target: "discard", priority: 10 },
            { target: "grid", priority: 0 },
            { target: "hand", priority: -10 },
          ],
        },
      });
      expect(traitsOf("game", stage)).not.toHaveProperty("coinsPanel");
      expect(traitsOf("game", stage)).not.toHaveProperty("shopStock");
    }
    expect(traitsOf("game", "shop")).toEqual({
      screen: { kind: "shop" },
      tableBackground: {},
      handView: {},
      selectable: { sources: [{ source: "hand" }, { source: "field" }] },
      sellBin: {},
      passiveRackView: { source: "rack" },
      coinsPanel: {},
      dropTargetGuide: {
        provider: "shopOffers",
        // One beam scale for every target, so the small BUY box's beams match the rack's.
        accept: { shape: "rectangle", colour: 0x65f4dd, beamScale: 400 },
        refuse: { shape: "cross", colour: 0xff3344, beamScale: 400 },
      },
      shopExit: {
        label: "Continue",
        presentation: {
          presenter: "wordCube",
          config: { material: "paper", description: "Leave the shop for the next stage." },
        },
      },
      shopStock: { source: "shop" },
      deckPanel: { opens: "openDeck" },
      runInPlay: {},
      enterSound: { sfx: "shop.open" },
      shopEntrance: {},
      musicResume: {
        operations: [{ op: "resumeTrack", config: { slot: "tableMusic", plan: "stage" } }],
      },
      keyAction: { key: "Escape", action: "openPause", sfx: "ui.click" },
    });
    // The title scene owns its own panel, with Continue gated on a save existing.
    expect(traitsOf("game", "title")).toEqual({
      screen: { kind: "title" },
      attractBackground: {},
      musicCue: { operations: [{ op: "selectTrack", config: { plan: "title" } }] },
      enterSound: { sfx: "ui.title.enter" },
      exitSound: { sfx: "ui.title.exit" },
      panelFooter: {
        links: [
          {
            label: "Get source code",
            href: "https://github.com/trebizondoculpepper/poker_blocks",
          },
          {
            label: "Report a bug",
            href: "https://github.com/trebizondoculpepper/poker_blocks/issues/new",
          },
        ],
      },
      blockTitle: {
        text: "Poker Blocks",
        scale: 0.85,
        precession: { seconds: 6, angle: 8.5, phaseDegrees: 67 },
        dance: {
          bounceCycle: "bar",
          bounceShape: "sine",
          bounceWindow: 0.2,
          bounceAttack: 0.2,
          bounce: 0.034,
          bounceTimeSpread: 0.03,
          bounceAngleSpread: 5.5,
          restAngleSpread: 0.8,
          tilt: 0,
        },
      },
      titleScreen: {},
      titleMenuDialog: gameDialogs.titleMenu,
      keyAction: { key: "Escape", action: "openPause", sfx: "ui.click" },
    });
    // The game over scene owns its screen and music cue, with no HUD panels or field input (#90).
    expect(traitsOf("game", "game-over")).toEqual({
      screen: { kind: "game-over" },
      tableBackground: {},
      resultMenu: {
        information: "runStats",
        showAfter: "statsReady",
        dialog: gameDialogs.gameOver,
      },
      musicCue: { operations: [{ op: "windDown" }] },
    });
  });

  it("shows Discard in play and Sell in the shop, with the hand in both (#118)", () => {
    for (const mode of gameModeRegistry.names()) {
      const traitsOf = (scene: SceneName) =>
        gameModeFor(mode).scenes.find(({ id }) => id === modeSceneId(mode, scene))!.traits;
      expect(traitsOf("title"), mode).not.toHaveProperty("handView");
      expect(traitsOf("title"), mode).not.toHaveProperty("discardBin");
      expect(traitsOf("title"), mode).not.toHaveProperty("sellBin");
      for (const scene of ["stage-1", "stage-2", "boss"] as const)
        expect(traitsOf(scene), `${mode} ${scene}`).toMatchObject({ handView: {}, discardBin: {} });
      expect(traitsOf("shop"), mode).toMatchObject({ handView: {}, sellBin: {} });
      expect(traitsOf("shop"), mode).not.toHaveProperty("discardBin");
    }
  });

  it("shows the rack in play and in the shop of modes with one, never on the title (#187)", () => {
    for (const mode of gameModeRegistry.names()) {
      const traitsOf = (scene: SceneName) =>
        gameModeFor(mode).scenes.find(({ id }) => id === modeSceneId(mode, scene))!.traits;
      expect(traitsOf("title"), mode).not.toHaveProperty("passiveRackView");
      const hasRack = Boolean(gameModeFor(mode).traits.passiveRack);
      for (const scene of ["stage-1", "stage-2", "boss", "shop"] as const)
        expect("passiveRackView" in traitsOf(scene), `${mode} ${scene}`).toBe(hasRack);
    }
  });

  it("shows the first-play prompt in the play scenes only, never on the title (#203)", () => {
    for (const mode of gameModeRegistry.names()) {
      const traitsOf = (scene: SceneName) =>
        gameModeFor(mode).scenes.find(({ id }) => id === modeSceneId(mode, scene))!.traits;
      expect(traitsOf("title"), mode).not.toHaveProperty("firstPlayPrompt");
      expect(traitsOf("shop"), mode).not.toHaveProperty("firstPlayPrompt");
      for (const scene of ["stage-1", "stage-2", "boss"] as const)
        expect(traitsOf(scene), `${mode} ${scene}`).toHaveProperty("firstPlayPrompt");
    }
  });

  it("lets a mode add a play-scene trait without disturbing the rest", () => {
    const boss = gameModeFor("dev4").scenes.find(({ id }) => id === "dev4/stage-1")!;
    expect(boss.traits).toEqual({
      screen: { kind: "stage-1" },
      roundPanel: { stage: "STAGE 1", actions: { lost: "End game" } },
      tableBackground: {},
      dropTarget: {
        targets: [
          { target: "discard", priority: 10 },
          { target: "grid", priority: 0 },
          { target: "hand", priority: -10 },
        ],
      },
      dragSource: { sources: [{ source: "hand" }] },
      boardGestures: { turnSound: "view.rotate" },
      firstPlayPrompt: expect.objectContaining({ colour: 0x65f4dd }),
      handView: {},
      selectable: { sources: [{ source: "hand" }, { source: "field" }] },
      discardBin: {},
      committedEventSounds: {},
      deckPanel: { opens: "openDeck" },
      runInPlay: {},
      keyAction: { key: "Escape", action: "openPause", sfx: "ui.click" },
      musicTrack: { operations: [{ op: "selectTrack", config: { plan: "stage" } }] },
      enterSound: { sfx: "round.start" },
      devManualBlockDestroyer: { cause: "manual" },
    });
    // Every mode lists every scene, so a mode never loses a scene it did not mention.
    expect(gameModeFor("dev4").scenes).toHaveLength(sceneNames.length);
  });

  it("composes every mode from the shared scene definitions, by reference", () => {
    for (const id of gameModeRegistry.names()) {
      const names = gameModeFor(id).scenes.map(({ traits }) => traits.screen?.kind);
      expect(names).toEqual(sceneDefinitions.map(({ name }) => name));
    }
    // A mode's additions land on its own scenes and never on the shared definition.
    const scenes = composeScenes("probe", [
      { scenes: ["shop"], traits: { roundPanel: { stage: "PROBE" } } },
    ]);
    expect(scenes.find(({ id }) => id === "probe/shop")!.traits).toHaveProperty("roundPanel");
    expect(sceneDefinitions.find(({ name }) => name === "shop")!.traits).not.toHaveProperty(
      "roundPanel",
    );
  });
});

describe("mode music lifecycle", () => {
  it("keeps quiet modes wound down and gives ordinary modes a track per stage", () => {
    const calls: string[] = [];
    const behaviours = createModeMusicBehaviours({
      windDown: () => calls.push("windDown"),
      run: () => calls.push("resumeStage"),
    });

    behaviours.quiet.settle();
    behaviours.quiet.resume([]);
    behaviours.ordinary.settle();
    behaviours.ordinary.resume([]);

    expect(calls).toEqual(["windDown", "windDown", "resumeStage"]);
    // Ordinary modes let a stage choose its music; quiet modes keep it wound down.
    expect(behaviours.ordinary.playsStages()).toBe(true);
    expect(behaviours.quiet.playsStages()).toBe(false);
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
