/**
 * HUD action presenters (#780; doc/shop-continue-block.md). A HUD action (the shop's exit) is
 * configured with a registered presenter and its configuration; the HUD mounts that presenter in
 * the action's own place while a scene composes it, and disposes it when the scene leaves. Every
 * presenter forwards activation to the one action command it is given, once, and plays no sound
 * of its own: the command owns those. Nothing here knows which action it presents.
 */
import { Registry } from "./core/registry";

export type MountedHudAction = {
  /** Show this label (the HUD's current text for the action). */
  setLabel(label: string): void;
  dispose(): void;
};

/** Mount a presenter in `host` for a label, calling `activate` when it is chosen. */
export type HudActionPresenter = (
  host: HTMLElement,
  options: { label: string; config: unknown; activate: () => void; services: unknown },
) => MountedHudAction;

export const hudActionPresenters = new Registry<HudActionPresenter>("HUD action presenter");

/** A HUD action's presentation: a registered presenter and its configuration. */
export type HudActionPresentation = { presenter: string; config?: unknown };

/** The default: an ordinary HTML button. */
export const buttonPresentation: HudActionPresentation = { presenter: "button" };

hudActionPresenters.register("button", (host, { label, activate }) => {
  const button = document.createElement("button");
  button.className = "hud-action";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", activate);
  host.append(button);
  return {
    setLabel(text) {
      button.textContent = text;
    },
    dispose() {
      button.removeEventListener("click", activate);
      button.remove();
    },
  };
});
