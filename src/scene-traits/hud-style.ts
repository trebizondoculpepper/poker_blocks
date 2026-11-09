/**
 * HUD style scene traits (#121).
 *
 * - `hudStyle` applies one registered style (src/hud-styles.ts) while its scene is on the stack.
 *   It is the production path: once the owner chooses, the gameplay and shop scenes compose it.
 * - `devHudStyleAudition` (testing only) shows a small selector that switches between the
 *   listed styles immediately. The choice outlives scene changes, so gameplay and shop can be
 *   compared under the same style.
 *
 * Neither knows any style by name: styles are data, and switching only swaps properties.
 */
import { applyHudStyle, clearHudStyle, hudStyles } from "../hud-styles";
import type { SceneTraitBehaviour } from "../scenes";

export type HudStyleConfig = { style: string };
export type DevHudStyleAuditionConfig = { styles: readonly string[] };

/** Applies its style on entering and removes it on leaving. */
export function hudStyle<Context extends { host: HTMLElement }>(): SceneTraitBehaviour<
  Context,
  HudStyleConfig
> {
  return {
    enter: ({ host }, { style }) => applyHudStyle(host, style),
    exit: ({ host }) => clearHudStyle(host),
  };
}

/** The audition's selector; the chosen style is kept across the scenes that compose it. */
export function devHudStyleAudition<Context extends { host: HTMLElement }>(): SceneTraitBehaviour<
  Context,
  DevHudStyleAuditionConfig
> {
  let chosen: string | undefined;
  let panel: HTMLElement | undefined;
  return {
    enter({ host }, { styles }) {
      chosen ??= styles[0];
      panel?.remove();
      panel = document.createElement("div");
      panel.className = "dev-hud-style-audition";
      panel.setAttribute("role", "radiogroup");
      panel.setAttribute("aria-label", "HUD style audition");
      const buttons = styles.map((name) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = hudStyles.get(name).label;
        button.setAttribute("role", "radio");
        button.addEventListener("click", () => choose(name));
        return { name, button };
      });
      const choose = (name: string) => {
        chosen = name;
        applyHudStyle(host, name);
        for (const entry of buttons)
          entry.button.setAttribute("aria-checked", String(entry.name === name));
      };
      panel.append(...buttons.map(({ button }) => button));
      host.append(panel);
      choose(chosen!);
    },
    exit({ host }) {
      panel?.remove();
      panel = undefined;
      clearHudStyle(host);
    },
  };
}
