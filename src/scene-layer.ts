/**
 * Scene layers (#189): a background trait brings the canvas it draws on. The canvas is in the
 * page only while a scene composing that trait is on the stack, so a scene without the trait
 * has no such layer at all, not a hidden or transparent one covering something else.
 *
 * The mount is counted, like the other counted scene traits: a menu pushed over a scene keeps
 * its layers, and the last scene to leave removes them.
 */

/** A layer mounted while any scene composing its trait is on the stack. */
export type SceneLayer = {
  /** A scene composing the trait came to the front, or left. */
  entered(entered: boolean): void;
  /** Whether the layer is in the page now. */
  readonly mounted: boolean;
};

export function createSceneLayer(mount: () => void, unmount: () => void): SceneLayer {
  let scenes = 0;
  return {
    entered(entered) {
      const before = scenes;
      scenes = Math.max(0, scenes + (entered ? 1 : -1));
      if (before === 0 && scenes > 0) mount();
      if (before > 0 && scenes === 0) unmount();
    },
    get mounted() {
      return scenes > 0;
    },
  };
}

/**
 * Where background layers mount: one element at the bottom of the scene's stacking order. It
 * draws nothing itself; the background traits' canvases go into it, ordered by CSS, so
 * every background sits under the HUD and the blocks whatever mounts first.
 */
export function createBackgroundLayers(host: HTMLElement): HTMLElement {
  const layers = document.createElement("div");
  layers.className = "background-layers";
  layers.setAttribute("aria-hidden", "true");
  host.append(layers);
  return layers;
}
