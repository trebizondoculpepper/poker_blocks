import { defineTrait } from "../core/trait";
import { playSfx } from "../audio/sfx";
import { availability } from "./availability";

export type InteractionState = { enabled: boolean; hovered: boolean; pressed: boolean };
/** Actions are opaque data. The scene receives menu.action and dispatches through its own flow. */
export const menuAction = defineTrait({
  name: "menuAction",
  defaults: { action: "", enabled: true },
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
        playSfx("ui.click");
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
