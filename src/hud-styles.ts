/**
 * HUD visual styles (#121): each is plain data, the `--hud-*` CSS custom properties it sets on
 * the scene host. The panel and shop rules read those properties with today's look as their
 * fallbacks, so a style restyles typography, borders, colours and ornament without touching
 * layout, and no code or CSS rule names a style. A production scene adopts one by composing the
 * `hudStyle` trait with its name; the developer audition switches between several.
 */
import { Registry } from "./core/registry";

export type HudStyle = {
  /** What the audition calls it. */
  label: string;
  /** CSS custom property → value, each one beginning `--hud-`. */
  properties: Readonly<Record<string, string>>;
};

export const hudStyles = new Registry<HudStyle>("HUD style");

const decoGold = "#d8b45a";
hudStyles.register("artDeco", {
  label: "Art Deco casino",
  properties: {
    "--hud-panel-bg": "#0e1512ee",
    "--hud-panel-border": `3px double ${decoGold}`,
    "--hud-panel-radius": "2px",
    "--hud-button-radius": "2px",
    "--hud-action-radius": "1px",
    "--hud-ink": "#f5ead0",
    "--hud-accent": decoGold,
    "--hud-action-ink": "#14100a",
    "--hud-rule": `linear-gradient(90deg, transparent, ${decoGold}, transparent)`,
    "--hud-font": '"Futura", "Avenir Next", "Century Gothic", sans-serif',
    "--hud-heading-font": '"Didot", "Bodoni 72", "Playfair Display", Georgia, serif',
    "--hud-heading-spacing": "0.28em",
    "--hud-action-spacing": "0.14em",
    "--hud-shadow": `0 0 0 1px #0008, 0 12px 30px #000a, inset 0 0 18px ${decoGold}22`,
    "--hud-target-border": `2px solid ${decoGold}`,
    // Stepped gold fans in each corner.
    "--hud-ornament": [135, 225, 315, 45]
      .map(
        (angle) =>
          `linear-gradient(${angle}deg, ${decoGold}55 0 7px, transparent 7px 10px, ${decoGold}33 10px 13px, transparent 13px)`,
      )
      .join(", "),
  },
});

const draftInk = "#e9f1ff";
hudStyles.register("preCad", {
  label: "Pre-CAD engineering",
  properties: {
    "--hud-panel-bg": "#163a66ee",
    "--hud-panel-border": `1px solid ${draftInk}`,
    "--hud-panel-radius": "0",
    "--hud-button-radius": "0",
    "--hud-action-radius": "0",
    "--hud-ink": draftInk,
    "--hud-accent": "#ffffff",
    "--hud-action-ink": "#163a66",
    "--hud-rule": `repeating-linear-gradient(90deg, ${draftInk} 0 6px, transparent 6px 10px)`,
    "--hud-font": '"American Typewriter", "Courier New", monospace',
    "--hud-heading-font": '"DIN Condensed", "Arial Narrow", "Helvetica Neue", sans-serif',
    "--hud-heading-spacing": "0.32em",
    "--hud-action-spacing": "0.2em",
    "--hud-shadow": `4px 4px 0 #0b1f38`,
    "--hud-target-border": `1px dashed ${draftInk}`,
    // A drafting grid under the content.
    "--hud-ornament": `linear-gradient(${draftInk}1a 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, ${draftInk}1a 1px, transparent 1px) 0 0 / 12px 12px`,
  },
});

/** Set a style's properties on an element (replacing any style it had). */
export function applyHudStyle(element: HTMLElement, name: string): void {
  clearHudStyle(element);
  for (const [property, value] of Object.entries(hudStyles.get(name).properties))
    element.style.setProperty(property, value);
}

/** Remove every HUD style property from an element. */
export function clearHudStyle(element: HTMLElement): void {
  for (const name of hudStyles.names())
    for (const property of Object.keys(hudStyles.get(name).properties))
      element.style.removeProperty(property);
}
