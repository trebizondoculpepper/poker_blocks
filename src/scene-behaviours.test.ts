import { beatShapes } from "./dance/beat-shapes";
import { danceCycles } from "./dance/dance-floor";
import { createActionLog } from "./action-log";
import { describe, expect, it } from "vite-plus/test";
import { SceneManager, SceneTraitRegistry } from "./scenes";
import { sceneBehaviours, type SceneHost } from "./scene-behaviours";
import { gameModeFor, type SceneTraits } from "./game-modes";
import type { HudPanel } from "./hud-panels";
import type { ShopOffer } from "./shop-stock";

/** A host that records what the traits did, with no DOM or renderer behind it. */
function recordingHost() {
  const calls: string[] = [];
  const shown = new Set<HudPanel>();
  let deckClose = () => {};
  const host: SceneHost = {
    host: { dataset: {} } as HTMLElement,
    services: {
      renderer: {
        tableEntered: (entered) => void calls.push(`table:${entered}`),
        handEntered: (entered) => void calls.push(`hand:${entered}`),
      },
      blockTitles: {
        show: () => () => {},
        tuning: () => ({
          scale: 1,
          phaseDegrees: 180,
          precessionAngle: 7,
          precessionSeconds: 32,
          bounce: 0.008,
          bounceCycle: "bar",
          bounceShape: "envelope",
          bounceWindow: 0.75,
          bounceAttack: 0.5,
          bounceTimeSpread: 0,
          bounceAngleSpread: 0,
          restAngleSpread: 0,
        }),
        retune() {},
      },
      attract: {
        start: () => void calls.push("attract:start"),
        stop: () => void calls.push("attract:stop"),
        showTuning: () => void calls.push("attract:tuning"),
        hideTuning: () => void calls.push("attract:tuning-hide"),
      },
      firstPlay: {
        firstPlayCell: () => null,
        fieldCount: () => 0,
        candidateCell: () => null,
        busy: () => false,
        reducedMotion: () => false,
        placeObject: () => void calls.push("prompt:place"),
        removeObject: () => void calls.push("prompt:remove"),
        cubeSize: 2.4,
        danceFloor: { join: () => () => {} },
      },
      actionLog: createActionLog(),
      actionWatch: { state: () => ({}), header: () => [] },
      board: {
        blockAt: () => {
          calls.push("blockAt");
          return undefined;
        },
        destroy: () => false,
      },
      hud: {
        show: (panel) => void (shown.add(panel), calls.push(`show:${panel}`)),
        hide: (panel) => void (shown.delete(panel), calls.push(`hide:${panel}`)),
      },
      selectionBadge: { handEntered: (entered) => void calls.push(`badge:${entered}`) },
      bin: {
        discardBinEntered: (entered) => void calls.push(`bin:${entered}`),
        sellBinEntered: (entered) => void calls.push(`sellBin:${entered}`),
      },
      input: {
        enableDropTarget: ({ target }) => {
          calls.push(`target:${target}:on`);
          return () => void calls.push(`target:${target}:off`);
        },
        enableDragSource: ({ source }) => {
          calls.push(`source:${source}:on`);
          return () => void calls.push(`source:${source}:off`);
        },
        enableSelectSource: ({ source }) => {
          calls.push(`select:${source}:on`);
          return () => void calls.push(`select:${source}:off`);
        },
        enableBoardGestures: () => {
          calls.push("board:on");
          return () => void calls.push("board:off");
        },
        cancelGestures: () => void calls.push("gestures:cancel"),
      },
      deckView: {
        show: (blocks: readonly unknown[], close: () => void) => {
          calls.push(`deck:${blocks.length}`);
          deckClose = close;
        },
        hide: () => void calls.push("deck:hide"),
      },
      devShopBalanceEditor: {
        show: () => void calls.push("balance:show"),
        hide: () => void calls.push("balance:hide"),
      },
      devBlockDesigner: { show: () => {}, hide: () => {} },
      devContainedProof: {
        show: (backTo) => void calls.push(`proof:show:${backTo}`),
        hide: () => void calls.push("proof:hide"),
      },
      devCrystalComparison: {
        show: ({ backends }) => void calls.push(`crystal:show:${backends.join(",")}`),
        hide: () => void calls.push("crystal:hide"),
      },
      devWordCubeRoom: {
        show: ({ items }) => void calls.push(`cubes:show:${items.length}`),
        hide: () => void calls.push("cubes:hide"),
      },
      dialogs: {
        add: ({ title, items }, handlers) => {
          calls.push(`dialog:add:${title}`);
          calls.push(
            `choices:${items.map((item) => (handlers.availability(item) ? item.action : `${item.action}(disabled)`)).join(",")}`,
          );
          return () => void calls.push(`dialog:remove:${title}`);
        },
      },
      devDialogRoom: {
        show: ({ seconds }) => void calls.push(`dialogs:show:${seconds}`),
        hide: () => void calls.push("dialogs:hide"),
      },
      devObjectBrowser: {
        show: (backTo) => void calls.push(`browser:show:${backTo}`),
        hide: () => void calls.push("browser:hide"),
      },
      rack: {
        viewEntered: (entered, capacity) => void calls.push(`rack:${entered}:${capacity}`),
      },
      shop: {
        buyTarget: {} as HTMLElement,
        dragSource: { pick: () => null, begin: () => {}, move: () => {}, end: () => {} },
        dragVerdict: () => null,
        render: (offers: readonly ShopOffer[], visible: boolean) =>
          calls.push(`shop:${visible}:${offers.length}`),
        burnUnsold: () => Promise.resolve(),
        frame: () => undefined,
        dispose: () => undefined,
      },
      run: {
        hasSave: () => false,
        rackCapacity: () => 5,
        seed: () => 4242,
        shopStock: () => [{ kind: "card", block: {} as never }],
        deckBlocks: () => [],
        dispatch: (action) => void calls.push(`action:${action}`),
        reducedMotion: false,
        runStats: () => ({
          roundsCompleted: 2,
          totalScore: 900,
          bestRoundScore: 500,
          roundScore: 0,
          blocksPlayed: 40,
        }),
        stageReward: () => ({
          entries: [{ source: "stage.complete", label: "Stage complete bonus", coins: 4 }],
          balanceBefore: 1,
          balance: 5,
        }),
      },
      overlays: {
        showMenu: (label, choices) =>
          void calls.push(`menu:${label}:${choices.map(({ id }) => id).join(",")}`),
        hideMenu: () => void calls.push("menu:hide"),
        showSettings: () => void calls.push("settings:show"),
        hideSettings: () => void calls.push("settings:hide"),
        showGameOver: (stats, choices) =>
          void calls.push(`gameOver:${stats.totalScore}:${choices.map(({ id }) => id).join(",")}`),
        hideGameOver: () => void calls.push("gameOver:hide"),
        // Two arguments only: a stage result never carries the seed (#164).
        showStageWon: (...args: unknown[]) => {
          const [reward, next] = args as [{ balance: number }, { id: string }];
          calls.push(`stageWon:${reward.balance}:${next.id}${args.length > 2 ? ":seed" : ""}`);
        },
        hideStageWon: () => void calls.push("stageWon:hide"),
        showTitle: () => void calls.push("title:show"),
        choose: (action) => void calls.push(`choose:${action}`),
        hideTitle: () => void calls.push("title:hide"),
        showPanelFooter: (links, version) =>
          void calls.push(`footer:${version}:${links.map(({ label }) => label).join(",")}`),
        hidePanelFooter: () => void calls.push("footer:hide"),
      },
      cameraView: { beginShopEntrance: () => void calls.push("camera:shopEntrance") },
      audio: {
        setMusicFilter: (kind) => void calls.push(`filter:${kind}`),
        playStageMusic: (pool) => void calls.push(`stageMusic:${pool}`),
        playCue: (cue) => void calls.push(`cue:${cue}`),
      },
      version: "1.2.3",
      sound: (id) => void calls.push(`sound:${id}`),
    },
  };
  return { host, calls, shown, closeDeck: () => deckClose() };
}

const scene = (id: string, traits: Partial<SceneTraits>) => ({ id, traits });

describe("scene traits own their behaviour", () => {
  it("shows the rack, sized from the run, while its scene is on the stack (#187)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { passiveRackView: { source: "rack" } }));
    scenes.register(scene("menu", { pausesBelow: { input: true, update: true } }));
    scenes.register(scene("title", {}));
    scenes.switchTo("stage");
    scenes.push("menu");
    scenes.pop();
    scenes.switchTo("title");
    expect(calls.filter((call) => call.startsWith("rack:"))).toEqual([
      "rack:true:5",
      "rack:false:5",
    ]);
  });

  it("keeps the hand and the discard bin while a menu is pushed over their scene (#183)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { handView: {}, discardBin: {} }));
    scenes.register(scene("menu", { pausesBelow: { input: true, update: true } }));
    scenes.register(scene("title", {}));

    scenes.switchTo("stage");
    // The input reaches the hand through the renderer's handShown (#278): no switch of its own.
    expect(calls).toEqual(["hand:true", "badge:true", "bin:true"]);
    calls.length = 0;
    scenes.push("menu");
    scenes.pop();
    expect(calls.filter((call) => /^(hand|handInput|bin):/.test(call))).toEqual([]);
    scenes.switchTo("title");
    expect(calls.filter((call) => /^(hand|handInput|bin):/.test(call)).sort()).toEqual([
      "bin:false",
      "hand:false",
    ]);
    // The selection badge leaves with the hand (#305).
    expect(calls).toContain("badge:false");
  });

  it("enables its drag sources while its scene shows, through menus, and never leaks one (#282)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    // Shared by two stages, as play scenes share one trait object through playSceneTraits.
    const dragSource = { sources: [{ source: "hand" }] };
    scenes.register(scene("stage-1", { dragSource }));
    scenes.register(scene("stage-2", { dragSource }));
    scenes.register(scene("menu", { pausesBelow: { input: true, update: true } }));
    scenes.register(scene("title", {}));
    const sources = () => calls.filter((call) => call.startsWith("source:"));

    scenes.switchTo("stage-1");
    expect(sources()).toEqual(["source:hand:on"]);
    scenes.push("menu");
    scenes.pop();
    expect(sources()).toEqual(["source:hand:on"]);
    scenes.switchTo("stage-2");
    scenes.switchTo("title");
    // Every enable is matched by a disable: nothing is left enabled.
    expect(sources().filter((call) => call.endsWith(":on")).length).toBe(
      sources().filter((call) => call.endsWith(":off")).length,
    );
    expect(sources().at(-1)).toBe("source:hand:off");
  });

  it("binds the board gestures while its scene shows, through menus, and unbinds them (#275)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { boardGestures: {} }));
    scenes.register(scene("menu", { pausesBelow: { input: true, update: true } }));
    scenes.register(scene("title", {}));
    const board = () => calls.filter((call) => call.startsWith("board:"));
    scenes.switchTo("stage");
    scenes.push("menu");
    scenes.pop();
    expect(board()).toEqual(["board:on"]);
    scenes.switchTo("title");
    expect(board()).toEqual(["board:on", "board:off"]);
  });

  it("composes Sell in the shop without exposing the Discard bin", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("shop", { sellBin: {}, handView: {} }));
    scenes.register(scene("title", {}));
    scenes.switchTo("shop");
    expect(calls).toContain("sellBin:true");
    expect(calls).not.toContain("bin:true");
    scenes.switchTo("title");
    expect(calls).toContain("sellBin:false");
  });

  it("mounts the draft editor only while its developer scene is active", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("balance", { devShopBalanceEditor: { backTo: "game" } }));
    scenes.register(scene("table", {}));
    scenes.switchTo("balance");
    expect(calls).toContain("balance:show");
    scenes.switchTo("table");
    expect(calls).toContain("balance:hide");
  });

  it("mounts the menu block room with its configured items only while its scene is active (#303)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    const items = [
      { label: "Resume", action: "resume" },
      { label: "Quit", action: "quitToTitle", enabled: false, description: "Not now." },
    ];
    scenes.register(scene("cubes", { devWordCubeRoom: { backTo: "game", items } }));
    scenes.register(scene("table", {}));
    scenes.switchTo("cubes");
    expect(calls).toContain("cubes:show:2");
    scenes.switchTo("table");
    expect(calls).toContain("cubes:hide");
  });

  it("hands each composed dialog to the dialogs service, and takes it away on exit (#347)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    const pause = { title: "Paused", items: [{ label: "Resume", action: "resume" }] };
    const newGame = { title: "New game?", items: [{ label: "Start", action: "confirmNewGame" }] };
    scenes.register(scene("room", { pauseDialog: pause, newGameDialog: newGame }));
    scenes.register(scene("table", {}));
    scenes.switchTo("room");
    expect(calls).toEqual(expect.arrayContaining(["dialog:add:Paused", "dialog:add:New game?"]));
    scenes.switchTo("table");
    expect(calls).toEqual(
      expect.arrayContaining(["dialog:remove:Paused", "dialog:remove:New game?"]),
    );
  });

  it("mounts the object browser only while its developer scene is active (dev9)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("browser", { devObjectBrowser: { backTo: "game" } }));
    scenes.register(scene("table", {}));
    scenes.switchTo("browser");
    expect(calls).toContain("browser:show:game");
    scenes.switchTo("table");
    expect(calls).toContain("browser:hide");
  });

  it("mounts the contained-components proof only while its developer scene is active (dev15)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("proof", { devContainedProof: { backTo: "game" } }));
    scenes.register(scene("table", {}));
    scenes.switchTo("proof");
    expect(calls).toContain("proof:show:game");
    scenes.switchTo("table");
    expect(calls).toContain("proof:hide");
  });

  it("lists the deck read-only and goes back from its Back button (#175)", () => {
    const { host, calls, closeDeck } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("table", {}));
    scenes.register(scene("deck", { deckView: {} }));
    scenes.switchTo("table");
    scenes.push("deck");
    expect(calls).toEqual(["deck:0"]);
    closeDeck();
    expect(calls).toContain("action:back");
    scenes.switchTo("table");
    expect(calls).toContain("deck:hide");
  });

  it("shows the won stage's paid rewards with its next action, and closes on exit (#91)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("table", {}));
    scenes.register(
      scene("reward", { stageWonScreen: { next: { id: "onward", label: "Onward" } } }),
    );

    scenes.switchTo("table");
    scenes.push("reward");
    expect(calls).toEqual(["stageWon:5:onward"]);
    calls.length = 0;
    scenes.switchTo("table");
    expect(calls).toEqual(["stageWon:hide"]);
  });

  it("shows the game over screen with the run's totals and its items, and hides it on exit (#90)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    const items = [
      { id: "again", label: "Again" },
      { id: "leave", label: "Leave" },
    ];
    scenes.register(scene("lost", { gameOverScreen: { items }, musicCue: { cue: "windDown" } }));
    scenes.register(scene("next", {}));

    scenes.switchTo("lost");
    expect(calls).toEqual(["gameOver:900:again,leave", "cue:windDown"]);
    calls.length = 0;
    scenes.switchTo("next");
    expect(calls).toEqual(["gameOver:hide"]);
  });

  it("marks the host with the scene in front again after a pushed scene pops (#35)", () => {
    const { host } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { screen: { kind: "stage-1" } }));
    scenes.register(scene("settings", { screen: { kind: "settings" } }));

    scenes.switchTo("stage");
    scenes.push("settings");
    expect(host.host.dataset.scene).toBe("settings");
    scenes.pop();
    expect(host.host.dataset.scene).toBe("stage-1");
  });

  it("shows and hides each HUD panel on the scene that composes it", () => {
    const { host, calls, shown } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { roundPanel: { stage: "S" }, deckPanel: {} }));
    scenes.register(scene("shop", { coinsPanel: {}, shopExit: { label: "Leave" } }));

    scenes.switchTo("stage");
    expect([...shown].sort()).toEqual(["deck", "round"]);
    scenes.switchTo("shop");
    expect([...shown].sort()).toEqual(["coins", "shopExit"]);
    expect(calls).toEqual([
      "show:round",
      "show:deck",
      "hide:deck",
      "hide:round",
      "show:coins",
      "show:shopExit",
    ]);
  });

  it("composes any subset of panels, leaving the others unchanged", () => {
    const { host, shown } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("a", { roundPanel: { stage: "S" } }));
    scenes.register(scene("b", { roundPanel: { stage: "S" }, coinsPanel: {} }));
    scenes.register(scene("c", { deckPanel: {} }));

    scenes.switchTo("b");
    expect([...shown].sort()).toEqual(["coins", "round"]);
    // Removing one panel leaves the other on show.
    scenes.switchTo("c");
    expect([...shown]).toEqual(["deck"]);
  });

  it("shows the shop's stock on entering the shop and hides it on leaving", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { roundPanel: { stage: "S" } }));
    scenes.register(scene("shop", { shopStock: { source: "shop" } }));

    scenes.switchTo("shop");
    scenes.switchTo("stage");
    expect(calls).toContain("shop:true:1");
    expect(calls).toContain("shop:false:0");
  });

  it("keeps pausesBelow registered and type-checked", () => {
    const { host } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("settings", { pausesBelow: { input: true, update: false } }));
    scenes.switchTo("settings");
    // The behaviour reports the configuration it was given, per operation.
    expect(
      sceneBehaviours<SceneHost>()
        .get("pausesBelow")
        .blocksBelow?.(host, { input: true, update: false }, "input"),
    ).toBe(true);
    expect(
      sceneBehaviours<SceneHost>()
        .get("pausesBelow")
        .blocksBelow?.(host, { input: true, update: false }, "update"),
    ).toBe(false);
  });

  it("registers every scene trait against its own config type", () => {
    const behaviours = sceneBehaviours<SceneHost>();
    for (const trait of [
      "screen",
      "roundPanel",
      "deckPanel",
      "coinsPanel",
      "shopExit",
      "shopStock",
      "sellBin",
      "pausesBelow",
      "devManualBlockDestroyer",
    ]) {
      expect(behaviours.has(trait)).toBe(true);
    }
    // The registry pairs each trait name with its own config, so a name no scene can compose
    // is rejected at the registration itself.
    const unknownTrait = () => {
      const registry = new SceneTraitRegistry<SceneTraits, SceneHost>();
      // @ts-expect-error "roundHud" is not a scene trait; the panel trait is "roundPanel"
      registry.register("roundHud", {});
    };
    expect(unknownTrait).toBeTypeOf("function");
  });
});

describe("the pause menu's scene traits (#87)", () => {
  const pause = gameModeFor("game").scenes.find(({ id }) => id === "game/pause")!;
  const settings = gameModeFor("game").scenes.find(({ id }) => id === "game/settings")!;
  const stage = gameModeFor("game").scenes.find(({ id }) => id === "game/stage-1")!;
  const title = gameModeFor("game").scenes.find(({ id }) => id === "game/title")!;

  function stack() {
    const recorded = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), recorded.host);
    for (const scene of [pause, settings, stage, title]) scenes.register(scene);
    return { ...recorded, scenes };
  }
  const escape = { type: "keydown", key: "Escape" };

  it("shows Resume, Settings and Quit to title in a run, muffled, and hides them on leaving", () => {
    const { scenes, calls } = stack();
    scenes.switchTo(stage.id);
    calls.length = 0;
    scenes.push(pause.id);
    // Opening it also ends any drag under way on the table (#124).
    expect(calls).toEqual([
      "table:true",
      "menu:Paused:resume,openSettings,quitToTitle",
      "footer:1.2.3:Get source code,Report a bug",
      "gestures:cancel",
      "filter:lowpass",
    ]);
    calls.length = 0;
    scenes.pop();
    expect(calls).toEqual(["filter:null", "footer:hide", "menu:hide", "table:false"]);
  });

  it("leaves out Quit to title over the title screen", () => {
    const { scenes, calls } = stack();
    scenes.switchTo(title.id);
    scenes.push(pause.id);
    expect(calls).toContain("menu:Paused:resume,openSettings");
  });

  it("Settings over the pause menu swaps to the high-pass, and Back restores the low-pass", () => {
    const { scenes, calls } = stack();
    scenes.switchTo(stage.id);
    scenes.push(pause.id);
    calls.length = 0;
    scenes.push(settings.id);
    expect(calls).toEqual([
      "table:true",
      "settings:show",
      "gestures:cancel",
      "filter:highpass",
      "sound:ui.settings.enter",
    ]);
    calls.length = 0;
    scenes.pop();
    expect(calls).toEqual([
      // Leaving Settings plays its own sound.
      "sound:ui.settings.exit",
      "filter:null",
      "settings:hide",
      // Settings does not compose `tableBackground`: the pause menu under it already drew the
      // table, and a scene pushed over one must not turn it off on the way out.
      "table:false",
      "menu:Paused:resume,openSettings,quitToTitle",
      // The pause panel's footer comes back with the panel it belongs to.
      "footer:1.2.3:Get source code,Report a bug",
      "filter:lowpass",
    ]);
  });

  it("routes Escape to the scene in front: open the menu, resume, or go back", () => {
    const { scenes, calls } = stack();
    scenes.switchTo(stage.id);
    calls.length = 0;
    expect(scenes.dispatch(escape)).toBe(true);
    scenes.push(pause.id);
    scenes.dispatch(escape);
    scenes.push(settings.id);
    scenes.dispatch(escape);
    expect(calls.filter((call) => /^(action|sound):/.test(call))).toEqual([
      "sound:ui.click",
      "action:openPause",
      "sound:ui.back",
      "action:resume",
      // Settings plays its own sound coming in, and its Escape adds none: leaving it plays
      // `ui.settings.exit` (only when the stage actually pops it, which this test doesn't).
      "sound:ui.settings.enter",
      "action:back",
    ]);
    // Other keys, and a held key's auto-repeat, pass through untouched.
    expect(scenes.dispatch({ type: "keydown", key: "a" })).toBe(false);
    expect(scenes.dispatch({ type: "keydown", key: "Escape", repeat: true })).toBe(false);
  });

  it("stops input and updates reaching the stage under the menu", () => {
    const { scenes, calls } = stack();
    scenes.switchTo(stage.id);
    scenes.push(pause.id);
    calls.length = 0;
    scenes.dispatch(escape);
    // Only the pause menu's own key action ran; the stage's never did.
    expect(calls).toEqual(["sound:ui.back", "action:resume"]);
  });
});

describe("the title screen's scene trait (#88)", () => {
  const title = gameModeFor("game").scenes.find(({ id }) => id === "game/title")!;
  const stage = gameModeFor("game").scenes.find(({ id }) => id === "game/stage-1")!;

  function stack(hasSave: boolean) {
    const recorded = recordingHost();
    recorded.host.services.run.hasSave = () => hasSave;
    const scenes = new SceneManager(sceneBehaviours(), recorded.host);
    scenes.register(title);
    scenes.register(stage);
    return { ...recorded, scenes };
  }

  it("shows its dialog's choices, greying out Continue with no save (#10, #148, #529)", () => {
    // Continue needs a save to be chosen, but stays on the title, disabled, without one.
    const without = stack(false);
    without.scenes.switchTo(title.id);
    expect(without.calls).toContain("choices:continue(disabled),new,openSettings");

    const withSave = stack(true);
    withSave.scenes.switchTo(title.id);
    expect(withSave.calls).toContain("choices:continue,new,openSettings");
  });

  it("hides the panel when its scene is left", () => {
    const { scenes, calls } = stack(true);
    scenes.switchTo(title.id);
    calls.length = 0;
    scenes.switchTo(stage.id);
    expect(calls).toContain("title:hide");
    expect(calls).toContain("dialog:remove:Poker Blocks");
  });

  it("re-shows the items when it comes back in front, so Continue reflects the latest save", () => {
    const { scenes, calls } = stack(false);
    scenes.switchTo(title.id);
    scenes.push(stage.id);
    calls.length = 0;
    scenes.pop();
    // Coming back in front re-reads the conditions, so Continue is enabled once a save exists.
    expect(calls).toContain("choices:continue(disabled),new,openSettings");
  });
});

describe("play scenes start their own music (#92)", () => {
  const scenesOf = (name: string) =>
    gameModeFor("game").scenes.find(({ id }) => id === `game/${name}`)!;

  it("a stage starts a random vibe and the boss its loop, as each comes in front", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    for (const name of ["stage-1", "stage-2", "boss", "pause"]) scenes.register(scenesOf(name));
    scenes.switchTo(scenesOf("stage-1").id);
    scenes.switchTo(scenesOf("boss").id);
    expect(calls.filter((call) => call.startsWith("stageMusic:"))).toEqual([
      "stageMusic:stage",
      "stageMusic:boss",
    ]);
  });

  it("doesn't restart the music when the pause menu closes over a stage", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    for (const name of ["stage-1", "pause"]) scenes.register(scenesOf(name));
    scenes.switchTo(scenesOf("stage-1").id);
    calls.length = 0;
    scenes.push(scenesOf("pause").id);
    scenes.pop();
    expect(calls.filter((call) => call.startsWith("stageMusic:"))).toEqual([]);
  });
});

describe("the shop scene's own arrival (#93)", () => {
  const scenesOf = (name: string) =>
    gameModeFor("game").scenes.find(({ id }) => id === `game/${name}`)!;

  it("plays its sound and camera entrance as it comes in front; a stage plays its start", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    for (const name of ["stage-1", "shop"]) scenes.register(scenesOf(name));
    scenes.switchTo(scenesOf("stage-1").id);
    expect(calls).toContain("sound:round.start");
    calls.length = 0;
    scenes.switchTo(scenesOf("shop").id);
    expect(calls).toContain("sound:shop.open");
    expect(calls).toContain("camera:shopEntrance");
  });

  it("keeps the camera still when motion is reduced", () => {
    const { host, calls } = recordingHost();
    (host.services.run as { reducedMotion: boolean }).reducedMotion = true;
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scenesOf("shop"));
    scenes.switchTo(scenesOf("shop").id);
    expect(calls).not.toContain("camera:shopEntrance");
  });
});

describe("developer word tuning", () => {
  it("routes sliders to the live title without resetting the other value, and releases the panel", () => {
    const { host, calls } = recordingHost();
    let controls: readonly import("./attract-tuning-panel").TuningControl[] = [];
    const updates: import("./scene-traits/block-title").BlockTitleTuning[] = [];
    host.services.attract.showTuning = (next) => {
      controls = next ?? [];
    };
    host.services.blockTitles.retune = (next) => {
      updates.push(next);
    };
    const behaviour = sceneBehaviours<SceneHost>().get("devAttractTuning");
    behaviour.enter!(host, {});
    expect(controls.map(({ label }) => label)).toEqual([
      "Word size",
      "Word phase difference (degrees)",
      "Precession angle (degrees)",
      "Precession period (s)",
      "Bounce",
      "Bounce cycle",
      "Bounce shape",
      "Bounce window (share of cycle)",
      "Bounce attack (envelope: share of the bump spent rising)",
      "Bounce time messiness (std dev, beats)",
      "Bounce angle messiness (std dev, degrees)",
      "Initial angle messiness (std dev, degrees)",
    ]);
    // The bounce cycle is picked by its position among the registered dance cycles.
    const cycles = danceCycles.names();
    expect(controls.map(({ value }) => value)).toEqual([
      1,
      180,
      7,
      32,
      0.008,
      cycles.indexOf("bar"),
      beatShapes.names().indexOf("envelope"),
      0.75,
      0.5,
      0,
      0,
      0,
    ]);
    expect(controls[5]!.format?.(cycles.indexOf("fourBars"))).toBe("fourBars");
    const base = {
      scale: 1,
      phaseDegrees: 180,
      precessionAngle: 7,
      precessionSeconds: 32,
      bounce: 0.008,
      bounceCycle: "bar",
      bounceShape: "envelope",
      bounceWindow: 0.75,
      bounceAttack: 0.5,
      bounceTimeSpread: 0,
      bounceAngleSpread: 0,
      restAngleSpread: 0,
    };
    controls[0]!.onChange(0.75);
    controls[1]!.onChange(90);
    controls[2]!.onChange(12);
    controls[3]!.onChange(60);
    controls[4]!.onChange(0.05);
    controls[5]!.onChange(cycles.indexOf("beat"));
    expect(updates).toEqual([
      { ...base, scale: 0.75 },
      { ...base, scale: 0.75, phaseDegrees: 90 },
      { ...base, scale: 0.75, phaseDegrees: 90, precessionAngle: 12 },
      { ...base, scale: 0.75, phaseDegrees: 90, precessionAngle: 12, precessionSeconds: 60 },
      {
        ...base,
        scale: 0.75,
        phaseDegrees: 90,
        precessionAngle: 12,
        precessionSeconds: 60,
        bounce: 0.05,
      },
      {
        ...base,
        scale: 0.75,
        phaseDegrees: 90,
        precessionAngle: 12,
        precessionSeconds: 60,
        bounce: 0.05,
        bounceCycle: "beat",
      },
    ]);
    controls[7]!.onChange(0.5);
    controls[8]!.onChange(0.25);
    expect(updates.at(-1)).toMatchObject({ bounceWindow: 0.5, bounceAttack: 0.25 });
    controls[9]!.onChange(0.08);
    controls[10]!.onChange(6);
    expect(updates.at(-1)).toMatchObject({ bounceTimeSpread: 0.08, bounceAngleSpread: 6 });
    controls[11]!.onChange(1.5);
    expect(updates.at(-1)).toMatchObject({ restAngleSpread: 1.5 });
    behaviour.exit!(host, {});
    expect(calls).toContain("attract:tuning-hide");
  });
});
