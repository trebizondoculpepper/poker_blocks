/**
 * Background-decoration host (#1373; doc/room-scenery.md, "Source audit and selected projection"
 * and "Render ordering, shadows and occlusion"). Stationary scenery, such as a framed picture,
 * lives in this host's own scene under an orthographic layout camera, so it never moves with
 * gameplay zoom, field framing, field rotation or the table following the field.
 *
 * - **Layout, not camera movement.** The camera's height is a fixed number of layout units and
 *   its width follows the visible surface's aspect. Each mount names a normalized anchor (0..1
 *   across and up the surface) plus an offset in layout units; a resize recomputes positions from
 *   these, never resetting a mount's own animation (its children keep their local pose).
 * - **Owned resources.** The host owns its scene, lights and camera; each mount owns only the
 *   holder it adds. Disposing a mount removes its holder and leaves the caller's object to its
 *   owner. A disposed host draws nothing.
 * - **Rendering.** `render` draws the host's scene into whatever target is current, preserving
 *   the colour already there (the backdrop) and using its own depth (cleared first), so it never
 *   compares depth with the gameplay camera's.
 *
 * It knows nothing of charts, stages or modes: a scene trait or service mounts what it owns.
 */
import * as THREE from "three";

/** Where a mount sits: a normalized anchor on the surface and an offset from it, in layout units. */
export type DecorationLayout = {
  /** 0 is the left/bottom edge, 1 the right/top. */
  anchor: readonly [number, number];
  /** Layout units from the anchor (+x right, +y up). */
  offset?: readonly [number, number];
  /** Toward (+) or away from (−) the camera, in layout units; 0 by default. */
  depth?: number;
};

export type DecorationMount = {
  /** Change where it sits; takes effect at once. */
  setLayout(layout: DecorationLayout): void;
  /** Remove it from the host; its object stays its owner's. */
  dispose(): void;
};

/** The renderer methods a pass uses (a THREE.WebGLRenderer fits). */
export type DecorationRenderer = Pick<
  THREE.WebGLRenderer,
  "render" | "clearDepth" | "getDrawingBufferSize"
> & { autoClear: boolean };

/** Layout units across the surface's height (default 10). */
export const defaultLayoutHeight = 10;

export function createBackgroundDecorationHost(options: { layoutHeight?: number } = {}) {
  const height = options.layoutHeight ?? defaultLayoutHeight;
  const scene = new THREE.Scene();
  // Its own light, so a mounted picture reads the same wherever the table's lamp points.
  const ambient = new THREE.AmbientLight(0xffffff, 1.6);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(-2, 3, 5);
  scene.add(ambient, key);
  const camera = new THREE.OrthographicCamera(-1, 1, height / 2, -height / 2, 0.1, 100);
  camera.position.set(0, 0, 50);
  const size = new THREE.Vector2();
  let width = height;
  const mounts = new Set<{ holder: THREE.Object3D; layout: DecorationLayout }>();
  let disposed = false;

  const place = (entry: { holder: THREE.Object3D; layout: DecorationLayout }) => {
    const [ax, ay] = entry.layout.anchor;
    const [ox, oy] = entry.layout.offset ?? [0, 0];
    entry.holder.position.set(
      (ax - 0.5) * width + ox,
      (ay - 0.5) * height + oy,
      entry.layout.depth ?? 0,
    );
  };

  /** Fit the camera to a surface of this pixel size: height fixed, width by aspect. */
  const resize = (pixels: { x: number; y: number }) => {
    const aspect = pixels.y > 0 ? pixels.x / pixels.y : 1;
    width = height * aspect;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    mounts.forEach(place);
  };

  return {
    scene,
    camera,
    /** The layout units the surface is wide and high now. */
    get extent() {
      return { width, height };
    },
    /** Mount `object` at `layout`; it is held, not owned. */
    mount(object: THREE.Object3D, layout: DecorationLayout): DecorationMount {
      const holder = new THREE.Group();
      holder.add(object);
      scene.add(holder);
      const entry = { holder, layout };
      mounts.add(entry);
      place(entry);
      let gone = false;
      return {
        setLayout(next) {
          if (gone) return;
          entry.layout = next;
          place(entry);
        },
        dispose() {
          if (gone) return;
          gone = true;
          mounts.delete(entry);
          holder.remove(object);
          scene.remove(holder);
        },
      };
    },
    resize,
    /**
     * Draw the decorations into the current target over what is there (the backdrop), on a
     * fresh depth buffer. Auto-clear is put back even if the draw throws.
     */
    render(renderer: DecorationRenderer): void {
      if (disposed || mounts.size === 0) return;
      renderer.getDrawingBufferSize(size);
      if (size.x * height !== width * size.y) resize(size);
      const autoClear = renderer.autoClear;
      try {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = autoClear;
      }
    },
    /** Release the host's own scene and lights; mounted objects stay their owners'. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of mounts) entry.holder.removeFromParent();
      mounts.clear();
      scene.clear();
      key.dispose();
      ambient.dispose();
    },
  };
}

export type BackgroundDecorationHost = ReturnType<typeof createBackgroundDecorationHost>;
