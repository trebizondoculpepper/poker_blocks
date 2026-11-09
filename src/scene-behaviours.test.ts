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
      },
      shop: {
        render: (offers: readonly ShopOffer[], visible: boolean) =>
          calls.push(`shop:${visible}:${offers.length}`),
        burnUnsold: () => Promise.resolve(),
        frame: () => undefined,
        dispose: () => undefined,
      },
      run: {
        shopStock: () => [{ kind: "card", block: {} as never }],
        dispatch: (action) => void calls.push(`action:${action}`),
      },
      overlays: {
        showMenu: (label, choices) =>
          void calls.push(`menu:${label}:${choices.map(({ id }) => id).join(",")}`),
        hideMenu: () => void calls.push("menu:hide"),
        showSettings: () => void calls.push("settings:show"),
        hideSettings: () => void calls.push("settings:hide"),
      },
      audio: { setMusicFilter: (kind) => void calls.push(`filter:${kind}`) },
    },
  };
  return { host, calls, shown };
}

const scene = (id: string, traits: Partial<SceneTraits>) => ({ id, traits });

describe("scene traits own their behaviour", () => {
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
    scenes.register(scene("stage", { roundPanel: {}, deckPanel: {} }));
    scenes.register(scene("shop", { coinsPanel: {}, shopExit: {} }));

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
    scenes.register(scene("a", { roundPanel: {} }));
    scenes.register(scene("b", { roundPanel: {}, coinsPanel: {} }));
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
    scenes.register(scene("stage", { roundPanel: {} }));
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
    expect(calls).toEqual(["menu:Paused:resume,openSettings,quitToTitle", "filter:lowpass"]);
    calls.length = 0;
    scenes.pop();
    expect(calls).toEqual(["filter:null", "menu:hide"]);
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
    expect(calls).toEqual(["settings:show", "filter:highpass"]);
    calls.length = 0;
    scenes.pop();
    expect(calls).toEqual([
      "filter:null",
      "settings:hide",
      "menu:Paused:resume,openSettings,quitToTitle",
      "filter:lowpass",
    ]);
  });

  it("routes Escape to the scene in front: open the menu, resume, or go back", () => {
    const { scenes, calls } = stack();
    scenes.switchTo(stage.id);
    expect(scenes.dispatch(escape)).toBe(true);
    scenes.push(pause.id);
    scenes.dispatch(escape);
    scenes.push(settings.id);
    scenes.dispatch(escape);
    expect(calls.filter((call) => call.startsWith("action:"))).toEqual([
      "action:openPause",
      "action:resume",
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
    expect(calls).toEqual(["action:resume"]);
  });
});
