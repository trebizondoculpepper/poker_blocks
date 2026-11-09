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
  const host: SceneHost = {
    host: { dataset: {} } as HTMLElement,
    services: {
      renderer: {
        tableEntered: (entered) => void calls.push(`table:${entered}`),
        handEntered: (entered) => void calls.push(`hand:${entered}`),
      },
      attract: {
        start: () => void calls.push("attract:start"),
        stop: () => void calls.push("attract:stop"),
        showTuning: () => void calls.push("attract:tuning"),
        hideTuning: () => void calls.push("attract:tuning-hide"),
      },
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
      input: {
        setFieldActive: (active) => calls.push(`fieldActive:${active}`),
        cancelGestures: () => void calls.push("gestures:cancel"),
        discardBinEntered: (entered) => void calls.push(`bin:${entered}`),
        handEntered: (entered) => void calls.push(`handInput:${entered}`),
      },
      shop: {
        render: (offers: readonly ShopOffer[], visible: boolean) =>
          calls.push(`shop:${visible}:${offers.length}`),
        burnUnsold: () => Promise.resolve(),
        frame: () => undefined,
        dispose: () => undefined,
      },
      run: {
        hasSave: () => false,
        seed: () => 4242,
        shopStock: () => [{ kind: "card", block: {} as never }],
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
        showStageWon: (reward, next) => void calls.push(`stageWon:${reward.balance}:${next.id}`),
        hideStageWon: () => void calls.push("stageWon:hide"),
        showTitle: (items) =>
          void calls.push(
            `title:${items.map((item) => ((item as { disabled?: boolean }).disabled ? `${item.id}(disabled)` : item.id)).join(",")}`,
          ),
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
  return { host, calls, shown };
}

const scene = (id: string, traits: Partial<SceneTraits>) => ({ id, traits });

describe("scene traits own their behaviour", () => {
  it("keeps the hand and the discard bin while a menu is pushed over their scene (#183)", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { handView: {}, discardBin: {} }));
    scenes.register(scene("menu", { pausesBelow: { input: true, update: true } }));
    scenes.register(scene("title", {}));

    scenes.switchTo("stage");
    expect(calls).toEqual(["hand:true", "handInput:true", "bin:true"]);
    calls.length = 0;
    scenes.push("menu");
    scenes.pop();
    expect(calls.filter((call) => /^(hand|handInput|bin):/.test(call))).toEqual([]);
    scenes.switchTo("title");
    expect(calls.filter((call) => /^(hand|handInput|bin):/.test(call)).sort()).toEqual([
      "bin:false",
      "hand:false",
      "handInput:false",
    ]);
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

  it("turns field placement on in a play scene and off in the shop", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { fieldPlacement: {} }));
    scenes.register(scene("shop", { coinsPanel: {}, shopStock: {} }));

    scenes.switchTo("stage");
    scenes.switchTo("shop");
    expect(calls).toContain("fieldActive:true");
    expect(calls).toContain("fieldActive:false");
  });

  it("shows the shop's stock on entering the shop and hides it on leaving", () => {
    const { host, calls } = recordingHost();
    const scenes = new SceneManager(sceneBehaviours(), host);
    scenes.register(scene("stage", { roundPanel: { stage: "S" } }));
    scenes.register(scene("shop", { shopStock: {} }));

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
      "fieldPlacement",
      "shopStock",
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
    expect(calls).toEqual(["table:true", "settings:show", "gestures:cancel", "filter:highpass"]);
    calls.length = 0;
    scenes.pop();
    expect(calls).toEqual([
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
      "sound:ui.back",
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

  it("shows the items its scene declares, greying out Continue with no save (#10, #148)", () => {
    // Continue needs a save to be chosen, but stays on the title, disabled, without one.
    const without = stack(false);
    without.scenes.switchTo(title.id);
    expect(without.calls).toContain("title:continue(disabled),new,openSettings");

    const withSave = stack(true);
    withSave.scenes.switchTo(title.id);
    expect(withSave.calls).toContain("title:continue,new,openSettings");
  });

  it("hides the panel when its scene is left", () => {
    const { scenes, calls } = stack(true);
    scenes.switchTo(title.id);
    calls.length = 0;
    scenes.switchTo(stage.id);
    expect(calls).toContain("title:hide");
  });

  it("re-shows the items when it comes back in front, so Continue reflects the latest save", () => {
    const { scenes, calls } = stack(false);
    scenes.switchTo(title.id);
    scenes.push(stage.id);
    calls.length = 0;
    scenes.pop();
    // Coming back in front re-reads the conditions, so Continue is enabled once a save exists.
    expect(calls).toContain("title:continue(disabled),new,openSettings");
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
