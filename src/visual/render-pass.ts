/**
 * A per-frame render pass a look needs before the main render, such as a background capture
 * (doc/profiler-render-passes.md, "Case declares, host owns"). Whoever draws the look (a developer
 * room, the profiler) creates one pass per renderer and owns it: the pass's render targets belong
 * to that instance, so two renderers never sample each other's capture, and `dispose` frees only
 * them. Shared, immutable maps and programs stay with the look.
 */
import * as THREE from "three";

/** The presentation time a tool passes each frame. */
export type FrameTime = { delta: number; reducedMotion: boolean };

/** The renderer methods a pass uses (a THREE.WebGLRenderer fits). */
export type PassRenderer = Pick<
  THREE.WebGLRenderer,
  | "render"
  | "clear"
  | "getRenderTarget"
  | "setRenderTarget"
  | "getClearColor"
  | "setClearColor"
  | "getClearAlpha"
  | "getDrawingBufferSize"
>;

/** What a pass is given each frame: `hide` holds the objects drawn with the look. */
export type PassFrame = FrameTime & {
  renderer: PassRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  hide: THREE.Object3D;
};

export type RenderPass = {
  render(frame: PassFrame): void;
  /** Free this pass's own targets. */
  dispose(): void;
};

/**
 * Run `draw`, then put back the render target, clear colour and alpha, camera layers and scene
 * background it may change, even if it throws.
 */
export function preservingRenderState(
  { renderer, scene, camera }: Pick<PassFrame, "renderer" | "scene" | "camera">,
  draw: () => void,
): void {
  const target = renderer.getRenderTarget();
  const colour = renderer.getClearColor(new THREE.Color());
  const alpha = renderer.getClearAlpha();
  const mask = camera.layers.mask;
  const background = scene.background;
  try {
    draw();
  } finally {
    scene.background = background;
    camera.layers.mask = mask;
    renderer.setClearColor(colour, alpha);
    renderer.setRenderTarget(target);
  }
}
