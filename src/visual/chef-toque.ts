/**
 * Le Chef's token (#378): a chef's toque, the hat itself and no cube around it. It is turned on
 * a lathe from a profile (a band, then a puffed, pleated crown) and fits inside the bounds of a
 * standard passive cube of `size`, so the rack, shop and inspector place it like any token.
 * Hit testing keeps using the passive's own bounds, not the hat's outline.
 */
import * as THREE from "three";
import { passiveVisualBuilders } from "../passive-visual";

/** The hat's silhouette, from the brim up, as (radius, height) in a unit cube. */
const profile: [number, number][] = [
  [0, -0.5],
  [0.28, -0.5],
  [0.3, -0.46],
  [0.3, -0.1],
  [0.36, -0.06],
  [0.44, 0.04],
  [0.48, 0.18],
  [0.46, 0.32],
  [0.38, 0.44],
  [0.22, 0.5],
  [0, 0.5],
];

passiveVisualBuilders.register("chefToque", (_appearance, size) => {
  const points = profile.map(([radius, height]) => new THREE.Vector2(radius * size, height * size));
  const lathe = new THREE.LatheGeometry(points, 28);
  // Pleats: the crown's surface rises and falls a little around its circumference.
  const position = lathe.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    if (point.y <= -0.08 * size) continue;
    const angle = Math.atan2(point.z, point.x);
    const pleat = 1 + 0.035 * Math.cos(angle * 7);
    position.setXYZ(i, point.x * pleat, point.y, point.z * pleat);
  }
  lathe.computeVertexNormals();
  const geometry = lathe.toNonIndexed();
  lathe.dispose();
  geometry.clearGroups();
  geometry.addGroup(0, geometry.getAttribute("position").count, 0);
  const cloth = new THREE.MeshStandardMaterial({ color: 0xf8f6f0, roughness: 0.85, metalness: 0 });
  // Only the strongest creases as outline, so the rack's edge lines don't scribble over it.
  const edges = new THREE.EdgesGeometry(geometry, 60);
  return {
    geometry,
    materials: [cloth],
    textures: [],
    edges,
    faces: [],
    dispose() {
      geometry.dispose();
      edges.dispose();
      cloth.dispose();
    },
  };
});
