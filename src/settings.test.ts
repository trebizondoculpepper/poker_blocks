import { describe, expect, it } from "vite-plus/test";
import type { SaveStorage } from "./save";
import {
  defaultSettings,
  loadSettings,
  prefersReducedMotion,
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

  it("defaults the layout to landscape, including for settings saved before it existed (#119)", () => {
    expect(defaultSettings.layout).toBe("landscape");
    const storage = memoryStorage();
    storage.setItem(settingsKey, JSON.stringify({ volume: 0.4, shadows: "low" }));
    expect(loadSettings(storage).layout).toBe("landscape");
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
