import { describe, expect, it } from "vite-plus/test";
import type { SaveStorage } from "./save";
import {
  defaultSettings,
  loadSettings,
  prefersReducedMotion,
  landscapeAspect,
  resolveLayout,
  resolveShadowQuality,
  saveSettings,
  silencedAudio,
  settingsKey,
} from "./settings";

function memoryStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("settings", () => {
  it("defaults when nothing is stored or storage is missing", () => {
    expect(loadSettings(memoryStorage())).toEqual(defaultSettings);
    expect(loadSettings(null)).toEqual(defaultSettings);
  });

  it("persists and reloads settings", () => {
    const storage = memoryStorage();
    const custom = {
      volume: 0.25,
      muted: true,
      sfx: false,
      music: true,
      motion: "reduced",
      shadows: "off",
      layout: "portrait",
    } as const;
    saveSettings(storage, custom);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it("falls back per field for invalid values", () => {
    const storage = memoryStorage();
    storage.setItem(
      settingsKey,
      JSON.stringify({
        volume: 4,
        muted: "yes",
        sfx: 0,
        music: "no",
        motion: "full",
        shadows: "ultra",
        layout: "sideways",
      }),
    );
    expect(loadSettings(storage)).toEqual({ ...defaultSettings, motion: "full" });
    storage.setItem(settingsKey, "{broken");
    expect(loadSettings(storage)).toEqual(defaultSettings);
  });

  it("defaults the layout to automatic, including for settings saved before it existed (#120)", () => {
    expect(defaultSettings.layout).toBe("auto");
    const storage = memoryStorage();
    storage.setItem(settingsKey, JSON.stringify({ volume: 0.4, shadows: "low" }));
    expect(loadSettings(storage).layout).toBe("auto");
    storage.setItem(settingsKey, JSON.stringify({ layout: "landscape" }));
    expect(loadSettings(storage).layout).toBe("landscape");
  });

  it("resolves the automatic layout from the viewport's shape (#120)", () => {
    const wide = { width: 1280, height: 800 };
    const tall = { width: 390, height: 844 };
    const square = { width: 1250, height: 1000 };
    expect(resolveLayout("auto", wide, "portrait")).toBe("landscape");
    expect(resolveLayout("auto", tall, "landscape")).toBe("portrait");
    // At the threshold ratio, the layout showing is kept, so it never flips.
    expect(resolveLayout("auto", square, "landscape")).toBe("landscape");
    expect(resolveLayout("auto", square, "portrait")).toBe("portrait");
    // Turning the device re-evaluates: the same call with the new shape.
    expect(resolveLayout("auto", tall, resolveLayout("auto", wide, "portrait"))).toBe("portrait");
  });

  it("treats narrow landscape windows as portrait, below a 1.25 aspect ratio (#238)", () => {
    expect(landscapeAspect).toBe(1.25);
    expect(resolveLayout("auto", { width: 600, height: 510 }, "landscape")).toBe("portrait");
    expect(resolveLayout("auto", { width: 800, height: 800 }, "landscape")).toBe("portrait");
    expect(resolveLayout("auto", { width: 1251, height: 1000 }, "portrait")).toBe("landscape");
    expect(resolveLayout("auto", { width: 1249, height: 1000 }, "landscape")).toBe("portrait");
    // Common landscape screens stay landscape.
    for (const [width, height] of [
      [1280, 800],
      [1024, 768],
      [844, 390],
      [800, 600],
    ])
      expect(resolveLayout("auto", { width, height }, "portrait"), `${width}x${height}`).toBe(
        "landscape",
      );
  });

  it("keeps a fixed layout whatever the viewport's shape (#119)", () => {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      expect(resolveLayout("landscape", viewport, "portrait")).toBe("landscape");
      expect(resolveLayout("portrait", viewport, "landscape")).toBe("portrait");
    }
  });

  it("keeps settings saved before the sound effects and music toggles, with both on", () => {
    const storage = memoryStorage();
    storage.setItem(settingsKey, JSON.stringify({ volume: 0.4, muted: false, motion: "full" }));
    expect(loadSettings(storage)).toMatchObject({ volume: 0.4, sfx: true, music: true });
  });

  it("silences each audio channel by its toggle, and both under the master mute", () => {
    expect(silencedAudio({ muted: false, sfx: true, music: true })).toEqual({
      sfx: false,
      music: false,
    });
    expect(silencedAudio({ muted: false, sfx: false, music: true })).toEqual({
      sfx: true,
      music: false,
    });
    expect(silencedAudio({ muted: false, sfx: true, music: false })).toEqual({
      sfx: false,
      music: true,
    });
    expect(silencedAudio({ muted: true, sfx: true, music: true })).toEqual({
      sfx: true,
      music: true,
    });
  });

  it("resolves auto shadows by device", () => {
    expect(resolveShadowQuality("auto", false)).toBe("high");
    expect(resolveShadowQuality("auto", true)).toBe("low");
    expect(resolveShadowQuality("off", false)).toBe("off");
    expect(resolveShadowQuality("high", true)).toBe("high");
  });

  it("resolves reduced motion against the system preference", () => {
    expect(prefersReducedMotion("system", true)).toBe(true);
    expect(prefersReducedMotion("system", false)).toBe(false);
    expect(prefersReducedMotion("reduced", false)).toBe(true);
    expect(prefersReducedMotion("full", true)).toBe(false);
  });
});
