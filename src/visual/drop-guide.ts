/**
 * Laser drop guides (#498): a guide shape drawn with the game's laser beams (src/visual/laser-
 * outline.ts), to show where a dragged offer can go (a rectangle) or that it can't (a red X).
 * Shapes are registered recipes of line segments on a width × height rectangle in the guide's own
 * plane (`dropGuideShapes`), so a guide never names a target or what is dragged.
 *
 * The guide is presentation only. It is never hit-tested (its meshes ignore raycasts), so it can't
 * intercept input. `setBounds` resizes it to a target's live bounds, rebuilding its beams only when
 * the size actually changes. Placing it over a target (screen or camera space, layout changes) is
 * the caller's job (#500). Reduced motion holds the beams' haze still; `dispose` frees everything.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import { createLaserLines, type LaserOutlineConfig } from "./laser-outline";

/** Line segments (pairs of points) for a shape on a `width` × `height` rectangle, centred. */
export const dropGuideShapes = new Registry<(width: number, height: number) => THREE.Vector3[]>(
  "drop guide shape",
);
/** The target's outline. */
dropGuideShapes.register("rectangle", (width, height) => {
  const [x, y] = [width / 2, height / 2];
  const corners = [
    new THREE.Vector3(-x, -y, 0),
    new THREE.Vector3(x, -y, 0),
    new THREE.Vector3(x, y, 0),
    new THREE.Vector3(-x, y, 0),
  ];
  return corners.flatMap((corner, i) => [corner, corners[(i + 1) % 4]!]);
});
/** A large X across the target: two crossing diagonals. */
dropGuideShapes.register("cross", (width, height) => {
  const [x, y] = [width / 2, height / 2];
  return [
    new THREE.Vector3(-x, -y, 0),
    new THREE.Vector3(x, y, 0),
    new THREE.Vector3(-x, y, 0),
    new THREE.Vector3(x, -y, 0),
  ];
});

export type DropGuideConfig = {
  shape: string;
  colour: number;
  /** Beam thickness and haze, as the laser outline takes them. */
  laser?: Partial<LaserOutlineConfig>;
};

/** A laser drop guide of a registered shape; size it with `setBounds`. */
export function createDropGuide(config: DropGuideConfig) {
  const object = new THREE.Group();
  // Never hit-tested: a guide shows where to drop, it never takes the drop.
  object.raycast = () => {};
  let beams: ReturnType<typeof createLaserLines> | null = null;
  let segments: THREE.BufferGeometry | null = null;
  let size = { width: 0, height: 0 };
  const clear = () => {
    beams?.dispose();
    segments?.dispose();
    beams = null;
    segments = null;
  };
  return {
    object,
    /** Fit the guide to a target of this size; beams rebuild only when the size changes. */
    setBounds(width: number, height: number) {
      if (width === size.width && height === size.height) return;
      size = { width, height };
      clear();
      if (width <= 0 || height <= 0) return;
      segments = new THREE.BufferGeometry().setFromPoints(
        dropGuideShapes.get(config.shape)(width, height),
      );
      beams = createLaserLines(segments, config.colour, Math.max(width, height), config.laser);
      beams.object.traverse((child) => {
        child.raycast = () => {};
      });
      object.add(beams.object);
    },
    update(seconds: number, reducedMotion = false) {
      beams?.update(seconds, reducedMotion);
    },
    dispose() {
      clear();
      object.removeFromParent();
    },
  };
}
