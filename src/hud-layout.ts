/**
 * Where the gameplay HUD sits in the shared frame (#117): one table of placements, so no panel
 * positions itself, and nothing here depends on the scene, mode or phase (each panel's scene
 * trait still decides whether it shows). The shop's own layout is #118.
 *
 * The passive rack keeps the top centre but is not placed in the frame: it is drawn above the
 * front canvas, over the blocks, and the frame is under it. The hand is drawn on the front
 * canvas at the bottom centre.
 */
import type { FrameZone } from "./hud-frame";
import type { HudPanel } from "./hud-panels";

/** A HUD element the frame places: a panel, the Discard bin or the menu button. */
export type HudElement = HudPanel | "discard" | "menu";

/** Each element's zone, in the order it fills that zone. */
export const gameplayHudZones: readonly { element: HudElement; zone: FrameZone }[] = [
  // Stage, score and target first, then coins beside them (shown in the shop).
  { element: "round", zone: "top-left" },
  { element: "coins", zone: "top-left" },
  { element: "menu", zone: "top-right" },
  { element: "discard", zone: "bottom-left" },
  { element: "deck", zone: "bottom-right" },
];
