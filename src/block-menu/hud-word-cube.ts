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
  return {
    setLabel(text) {
      if (text === current) return;
      current = text;
      show(text);
    },
    dispose() {
      shown?.hide();
      menus.dispose();
      host.classList.remove("block-menu-host", "hud-word-cube");
    },
  };
});
