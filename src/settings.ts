import type { SaveStorage } from "./save";

export type MotionSetting = "system" | "reduced" | "full";

export type ShadowSetting = "auto" | "high" | "low" | "off";

/**
 * The HUD frame's layout: a fixed choice (#119), or "auto", which follows the viewport's shape
 * (#120). A fixed choice is never overridden by the device's orientation.
 */
export type LayoutSetting = "auto" | "landscape" | "portrait";

export type Settings = {
  /** 0 to 1. */
  volume: number;
  /** Master mute: silences sound effects and music together. */
  muted: boolean;
  /** Sound effects on or off, under the master mute. */
  sfx: boolean;
  /** Music on or off, under the master mute. */
  music: boolean;
  motion: MotionSetting;
  /** Shadow quality; "auto" picks low on touch devices, high elsewhere. */
  shadows: ShadowSetting;
  /** The HUD layout for gameplay and the shop; automatic by default (#120). */
  layout: LayoutSetting;
};

export const defaultSettings: Settings = {
  volume: 0.7,
  muted: false,
  sfx: true,
  music: true,
  motion: "system",
  shadows: "auto",
  layout: "auto",
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
  const sfx = typeof stored.sfx === "boolean" ? stored.sfx : defaultSettings.sfx;
  const music = typeof stored.music === "boolean" ? stored.music : defaultSettings.music;
  const motion = (["system", "reduced", "full"] as const).includes(stored.motion as MotionSetting)
    ? (stored.motion as MotionSetting)
    : defaultSettings.motion;
  const shadows = (["auto", "high", "low", "off"] as const).includes(
    stored.shadows as ShadowSetting,
  )
    ? (stored.shadows as ShadowSetting)
    : defaultSettings.shadows;
  const layout = (["auto", "landscape", "portrait"] as const).includes(
    stored.layout as LayoutSetting,
  )
    ? (stored.layout as LayoutSetting)
    : defaultSettings.layout;
  return { volume, muted, sfx, music, motion, shadows, layout };
}

export function saveSettings(storage: SaveStorage | null, settings: Settings): void {
  try {
    storage?.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Settings still apply for this visit; they just will not be remembered.
  }
}

/** Which audio channels are silent: the master mute silences both. */
export function silencedAudio(settings: Pick<Settings, "muted" | "sfx" | "music">): {
  sfx: boolean;
  music: boolean;
} {
  return { sfx: settings.muted || !settings.sfx, music: settings.muted || !settings.music };
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

/**
 * The layout to show (#120): a fixed choice as chosen; "auto" picks landscape for a viewport
 * wider than tall and portrait for one taller than wide. A square viewport keeps the current
 * layout, so it never flips back and forth.
 */
export function resolveLayout(
  setting: LayoutSetting,
  viewport: { width: number; height: number },
  current: "landscape" | "portrait",
): "landscape" | "portrait" {
  if (setting !== "auto") return setting;
  if (viewport.width === viewport.height) return current;
  return viewport.width > viewport.height ? "landscape" : "portrait";
}
