/**
 * Glass container shells (#331): two existing glass designs as visible shells around the same
 * interior boundary as the plastic shell (src/visual/contained.ts), so any contents can sit in
 * any of them by changing configuration only.
 *
 * - `framedGlass`: the fire block's open iron frame (the material's own `ironFrame` artwork and
 *   `iron` surface) with a glossy glass sheen in its openings (#203). Its frame is thicker than
 *   plastic, so its interior starts further in.
 * - `stainedLantern`: the retired glass block (removed in f99d307, restored here only as a
 *   shell): a pane of hand-made glass in a lead-and-steel came on each face, each pane tinted
 *   (the material's own `leadedGlass` artwork). See-through by the texture's alpha, as the glass
 *   was in the hand; its old refraction on the table is not restored (limitations in
 *   doc/game-architecture.md).
 *
 * Neither knows what is inside it, and no contents know which shell they are in.
 */
import * as THREE from "three";
import { additiveSheen } from "./additive-light";
import { containedLayers, containerShells, type ShellHandler } from "./contained";

/** The fire block's frame and panes as a shell. */
export type FramedGlassConfig = {
  /** Where its interior starts, inside the frame. */
  inset: number;
  /** The panes' reflection strength. */
  glass: number;
};

const framedGlass: ShellHandler = ({ geometry, environment, faceTexture, ownSurface }, raw) => {
  const config = raw as FramedGlassConfig;
  // Additive and black-based, so the panes only add reflections and never hide the contents.
  const panes = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      metalness: 0,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMap: environment,
      envMapIntensity: config.glass,
      transparent: true,
      ...additiveSheen,
      depthWrite: false,
    }),
  );
  panes.material.userData.reflective = true;
  // Just inside the frame's outer surface, so the bars sit proud of the glass.
  panes.scale.setScalar(0.97);
  panes.renderOrder = containedLayers.gloss;
  return { faces: ownSurface(faceTexture()), meshes: [panes], inset: config.inset };
};

/** The retired stained-glass lantern as a shell. */
export type StainedLanternConfig = {
  /** Where its interior starts, inside the came. */
  inset: number;
  /** Each pane's tint, in BoxGeometry face order (+x, −x, +y, −y, +z, −z). */
  tints: readonly number[];
};

const stainedLantern: ShellHandler = ({ environment, faceTexture }, raw) => {
  const config = raw as StainedLanternConfig;
  const texture = faceTexture();
  const panes = config.tints.map(
    (tint) =>
      new THREE.MeshPhysicalMaterial({
        map: texture,
        color: tint,
        roughness: 0.06,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMap: environment,
        envMapIntensity: 1.2,
        transparent: true,
        depthWrite: false,
      }),
  );
  return { faces: panes, meshes: [], inset: config.inset };
};

containerShells.register("framedGlass", framedGlass);
containerShells.register("stainedLantern", stainedLantern);
