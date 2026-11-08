import { describe, expect, it } from "vite-plus/test";
import type { SaveStorage } from "./save";
import {
  defaultSettings,
  loadSettings,
  prefersReducedMotion,
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
    saveSettings(storage, { volume: 0.25, muted: true, motion: "reduced" });
    expect(loadSettings(storage)).toEqual({ volume: 0.25, muted: true, motion: "reduced" });
  });

  it("falls back per field for invalid values", () => {
    const storage = memoryStorage();
    storage.setItem(settingsKey, JSON.stringify({ volume: 4, muted: "yes", motion: "full" }));
    expect(loadSettings(storage)).toEqual({ ...defaultSettings, motion: "full" });
    storage.setItem(settingsKey, "{broken");
    expect(loadSettings(storage)).toEqual(defaultSettings);
  });

  it("resolves reduced motion against the system preference", () => {
    expect(prefersReducedMotion("system", true)).toBe(true);
    expect(prefersReducedMotion("system", false)).toBe(false);
    expect(prefersReducedMotion("reduced", false)).toBe(true);
    expect(prefersReducedMotion("full", true)).toBe(false);
  });
});
