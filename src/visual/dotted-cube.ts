/**
 * An empty cube drawn as thick dots along its twelve edges (#156: the Nothingifier), like a
 * heavier ghost cube with nothing inside. The dots are one merged geometry with one material;
 * the faces are an invisible box, kept so the token can still be hit and picked up.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { passiveVisualBuilders } from "../passive-visual";

export type DottedCubeConfig = {
  colour: number;
  /** Dots along each edge, corners included. */
  dots?: number;
  /** A dot's radius, as a fraction of the cube's size. */
  radius?: number;
};

/** One geometry holding every dot along a unit cube's edges, centred on the origin. */
export function dottedCubeGeometry(size: number, dots = 7, radius = 0.045): THREE.BufferGeometry {
  const half = size / 2;
  const centres = new Map<string, THREE.Vector3>();
  // Each edge runs along one axis, at ± half on the other two.
  for (let axis = 0; axis < 3; axis++)
    for (const a of [-half, half])
      for (const b of [-half, half])
        for (let step = 0; step < dots; step++) {
          const point = [0, 0, 0];
          point[axis] = -half + (size * step) / (dots - 1);
          point[(axis + 1) % 3] = a;
          point[(axis + 2) % 3] = b;
          const centre = new THREE.Vector3(...point);
          // Corners are shared by three edges: one dot each.
          centres.set(
            centre
              .toArray()
              .map((n) => n.toFixed(5))
              .join(","),
            centre,
          );
        }
  const parts = [...centres.values()].map((centre) =>
    new THREE.SphereGeometry(radius * size, 8, 6).translate(centre.x, centre.y, centre.z),
  );
  const merged = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  return merged;
}

passiveVisualBuilders.register("dottedCube", (_appearance, size, raw) => {
  const config = raw as DottedCubeConfig;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const hidden = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const dotGeometry = dottedCubeGeometry(size, config.dots, config.radius);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: config.colour, toneMapped: false });
  const dots = new THREE.Mesh(dotGeometry, dotMaterial);
  // No drawn edges: the dots are the outline.
  const edges = new THREE.EdgesGeometry();
  return {
    geometry,
    materials: [hidden],
    textures: [],
    edges,
    faces: [],
    extras: [dots],
    dispose() {
      geometry.dispose();
      edges.dispose();
      hidden.dispose();
      dotGeometry.dispose();
      dotMaterial.dispose();
    },
  };
});
