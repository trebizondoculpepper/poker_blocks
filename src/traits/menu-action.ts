import { defineTrait } from "../core/trait";
import { playSfx } from "../audio/sfx";
import type { SoundEffectId } from "../audio/sfx-registry";
import { availability } from "./availability";

export type InteractionState = { enabled: boolean; hovered: boolean; pressed: boolean };
/** Actions are opaque data. The scene receives menu.action and dispatches through its own flow. */
export const menuAction = defineTrait({
  name: "menuAction",
  // `sfx` is the sound choosing it plays (#949): a click, or Back's sound for a leaving choice;
  // null when the action it forwards already owns its sound (#780), so it never plays twice.
  defaults: { action: "", enabled: true, sfx: "ui.click" as SoundEffectId | null },
  setup({ block, settings }) {
    let hovered = false;
    let pressed = false;
    const publish = () =>
      block.emit("interaction.state", {
        enabled: settings.enabled,
        hovered,
        pressed,
      } satisfies InteractionState);
    const stops = [
      block.on("input.enter", () => {
        if (!hovered && settings.enabled) playSfx("ui.hover");
        hovered = true;
        publish();
      }),
      block.on("input.leave", () => {
        hovered = false;
        publish();
      }),
      block.on("input.press", () => {
        hovered = true;
        pressed = true;
        publish();
      }),
      block.on("input.cancel", () => {
        pressed = false;
        hovered = false;
        publish();
      }),
      block.on("input.release", () => {
        const activate = pressed && hovered;
        pressed = false;
        publish();
        if (!activate) return;
        if (!settings.enabled) {
          playSfx("action.denied");
          return;
        }
        if (settings.sfx) playSfx(settings.sfx);
        block.emit("menu.action", settings.action);
      }),
      block.on("input.enabled", (value) => {
        settings.enabled = availability(value).enabled;
        pressed = false;
        publish();
      }),
    ];
    return () => stops.forEach((stop) => stop());
  },
});
