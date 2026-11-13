/**
 * The word-cube HUD action presenter (#780; doc/shop-continue-block.md): one word cube, in an
 * explicit writing material, drawn by the production block menus in the action's own HUD place.
 * Block menus bring the hidden semantic button, keyboard, pointer, touch, inspection and spring
 * feedback; the cube forwards its choice to the action command and plays no click of its own
 * (`sfx: null`), since the command owns its sounds. Disposing frees the cube, stage and canvas.
 */
import { hudActionPresenters } from "../hud-actions";
import type { BlockMaterial } from "../materials";
import { createBlockMenus, type BlockMenuOptions } from "./block-menus";

/** Its configuration: the cube's writing material and what it says it does. */
export type WordCubeActionConfig = { material?: BlockMaterial; description?: string };

hudActionPresenters.register("wordCube", (host, { label, config, activate, services }) => {
  const { material, description } = (config ?? {}) as WordCubeActionConfig;
  host.classList.add("block-menu-host", "hud-word-cube");
  // Only a bounded action region over the cube takes pointer input (#780 review): the rest of the
  // transparent stage passes input through to the table beneath, so hand blocks under its margin
  // can still be picked. The region forwards its pointer events to the cube stage's canvas.
  const region = document.createElement("div");
  region.className = "hud-word-cube-hit";
  region.dataset.interactive = "";
  const forward = (event: PointerEvent) => {
    host.querySelector("canvas")?.dispatchEvent(new PointerEvent(event.type, event));
  };
  const forwarded = ["pointermove", "pointerdown", "pointerup", "pointerleave"] as const;
  for (const type of forwarded) region.addEventListener(type, forward);
  const menus = createBlockMenus(host, (services ?? { spring: {} }) as BlockMenuOptions);
  let shown: ReturnType<typeof menus.show> | null = null;
  const show = (text: string) => {
    shown?.hide();
    shown = menus.show(
      {
        title: text,
        items: [
          {
            label: text,
            // Opaque: the cube hands it back, and this presenter forwards it to its one command.
            action: "activate",
            description,
            sfx: null,
            ...(material ? { material } : {}),
          },
        ],
        presentation: { panel: "none" },
      },
      { onAction: activate },
    );
  };
  let current = label;
  show(label);
  host.append(region);
  return {
    setLabel(text) {
      if (text === current) return;
      current = text;
      show(text);
    },
    dispose() {
      shown?.hide();
      menus.dispose();
      for (const type of forwarded) region.removeEventListener(type, forward);
      region.remove();
      host.classList.remove("block-menu-host", "hud-word-cube");
    },
  };
});
