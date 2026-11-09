import { describe, expect, it } from "vite-plus/test";
import { SceneManager, SceneTraitRegistry } from "./scenes";
import { sceneBehaviours, type SceneHost } from "./scene-behaviours";
import type { SceneTraits } from "./game-modes";
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
      run: { shopStock: () => [{ kind: "card", block: {} as never }] },
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
