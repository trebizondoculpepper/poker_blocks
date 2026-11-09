/**
 * The shared HUD frame (#116): one full-screen layout surface for the gameplay and shop
 * overlays, between the back canvas (room and table) and the front canvas (blocks, hand, drag).
 *
 * The frame is a grid of named **zones** inside the safe-area insets. The top centre is kept
 * for the passive rack and the bottom centre for the hand; the middle is the playfield or the
 * shop's stock, and status and controls sit in the edge zones. It is a layout surface, not a
 * clipping mask: playfield blocks are drawn over it, and the board can be turned to see a
 * covered control. Board zoom never moves it.
 *
 * The frame knows nothing about scenes, modes or what a panel is: a service places its element
 * in a zone, and the scene traits that show and hide panels stay as they are. The layout is
 * landscape (the default); portrait and the orientation choice are #119 and #120.
 */

/** The frame's zones, top to bottom and left to right. */
export const frameZones = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type FrameZone = (typeof frameZones)[number];

/** The frame's layouts; only landscape exists yet (#119 adds portrait). */
export type FrameLayout = "landscape";

export type HudFrame = {
  readonly element: HTMLElement;
  /** Put a panel or control in a zone, after anything already there. */
  place(panel: HTMLElement, zone: FrameZone): void;
  readonly layout: FrameLayout;
};

export function createHudFrame(host: HTMLElement, layout: FrameLayout = "landscape"): HudFrame {
  const element = document.createElement("div");
  element.className = "hud-frame";
  element.dataset.layout = layout;
  const zones = new Map<FrameZone, HTMLElement>();
  for (const name of frameZones) {
    const zone = document.createElement("div");
    zone.className = "hud-zone";
    zone.dataset.zone = name;
    zones.set(name, zone);
    element.append(zone);
  }
  host.append(element);
  return {
    element,
    layout,
    place(panel, zone) {
      zones.get(zone)!.append(panel);
    },
  };
}
