import type { SaveStorage } from "./save";

export type MotionSetting = "system" | "reduced" | "full";

export type ShadowSetting = "auto" | "high" | "low" | "off";

export type Settings = {
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  motion: MotionSetting;
  /** Shadow quality; "auto" picks low on touch devices, high elsewhere. */
  shadows: ShadowSetting;
};

export const defaultSettings: Settings = {
  volume: 0.7,
  muted: false,
  motion: "system",
  shadows: "auto",
};
export const settingsKey = "poker-blocks.settings";

/** Read settings, falling back field by field to the defaults for anything missing or invalid. */
export function loadSettings(storage: SaveStorage | null): Settings {
  let stored: Partial<Settings> = {};
  try {
    const raw = storage?.getItem(settingsKey);
    if (raw) stored = JSON.parse(raw) ?? {};
  } catch {
    stored = {};
  }
  const volume =
    typeof stored.volume === "number" && stored.volume >= 0 && stored.volume <= 1
      ? stored.volume
      : defaultSettings.volume;
  const muted = typeof stored.muted === "boolean" ? stored.muted : defaultSettings.muted;
  const motion = (["system", "reduced", "full"] as const).includes(stored.motion as MotionSetting)
    ? (stored.motion as MotionSetting)
    : defaultSettings.motion;
  const shadows = (["auto", "high", "low", "off"] as const).includes(
    stored.shadows as ShadowSetting,
  )
    ? (stored.shadows as ShadowSetting)
    : defaultSettings.shadows;
  return { volume, muted, motion, shadows };
}

export function saveSettings(storage: SaveStorage | null, settings: Settings): void {
  try {
    storage?.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Settings still apply for this visit; they just will not be remembered.
  }
}

/** Whether to reduce motion, given the setting and the system preference. */
export function prefersReducedMotion(setting: MotionSetting, systemReduced: boolean): boolean {
  return setting === "system" ? systemReduced : setting === "reduced";
}

/** The shadow quality to render, given the setting and whether the device is touch-first. */
export function resolveShadowQuality(
  setting: ShadowSetting,
  coarsePointer: boolean,
): "high" | "low" | "off" {
  if (setting !== "auto") return setting;
  return coarsePointer ? "low" : "high";
}
