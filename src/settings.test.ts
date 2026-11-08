import { describe, expect, it } from "vite-plus/test";
import type { SaveStorage } from "./save";
import {
  defaultSettings,
  loadSettings,
  prefersReducedMotion,
  resolveShadowQuality,
  saveSettings,
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
    const custom = { volume: 0.25, muted: true, motion: "reduced", shadows: "off" } as const;
    saveSettings(storage, custom);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it("falls back per field for invalid values", () => {
    const storage = memoryStorage();
    storage.setItem(
      settingsKey,
      JSON.stringify({ volume: 4, muted: "yes", motion: "full", shadows: "ultra" }),
    );
    expect(loadSettings(storage)).toEqual({ ...defaultSettings, motion: "full" });
    storage.setItem(settingsKey, "{broken");
    expect(loadSettings(storage)).toEqual(defaultSettings);
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
