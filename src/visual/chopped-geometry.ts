/**
 * A crudely chopped hunk (meat): a subdivided box with a few cleaver cuts taking off corners
 * and edges, and shallow dents over its surfaces. Everything only removes material, so a hunk
 * stays inside its cell and never pokes into a neighbour.
 *
 * Every displacement is a function of a vertex's position alone, so the box's duplicated edge
 * vertices (one per face) move together and the surface never cracks. The six faces keep their
 * groups and UVs, so each face still gets its own material. The shape is seeded by the block's
 * art, so every hunk differs and the same block is always the same shape.
 */
import * as THREE from "three";

/** How a hunk is chopped: cuts, how deep they go and how dented the surfaces are. */
export type ChopSettings = {
  /** Cleaver cuts: each a flat plane slicing off a corner or an edge. */
  cuts: readonly [min: number, max: number];
  /** How deep a cut goes, as a fraction of the block's side. */
  depth: readonly [min: number, max: number];
  /** How deep the dents go, as a fraction of the block's side. */
  dent: number;
};

/** A small seeded random source (FNV-1a hash of the seed, then xorshift). */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function choppedGeometry(
  size: number,
  segments: number,
  chop: ChopSettings,
  seed: string,
): THREE.BufferGeometry {
  const random = seededRandom(`chop-${seed}`);
  const between = ([min, max]: readonly [number, number]) => min + (max - min) * random();
  const geometry = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const half = size / 2;

  // Each cut is a plane facing one of the box's corners (a different corner each, so every
  // cut shows), tilted at random so some take off more of an edge than others. It sits `depth`
  // inside the block's furthest point in that direction; anything beyond is pushed back onto it.
  const corners = [-1, 1]
    .flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z] as const)))
    .map((corner) => ({ corner, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ corner }) => corner);
  const cuts = corners.slice(0, Math.round(between(chop.cuts))).map(([x, y, z]) => {
    const normal = new THREE.Vector3(
      x * (0.35 + random() * 0.85),
      y * (0.35 + random() * 0.85),
      z * (0.35 + random() * 0.85),
    ).normalize();
    const furthest = half * (Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z));
    return { normal, limit: furthest - between(chop.depth) * size };
  });

  // Dents: a smooth field of three seeded waves, in [0, 1], pressing in toward the centre.
  const waves = Array.from({ length: 3 }, () => ({
    direction: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5)
      .normalize()
      .multiplyScalar((2 + random() * 3) / size),
    phase: random() * Math.PI * 2,
  }));
  const dentAt = (point: THREE.Vector3) =>
    waves.reduce(
      (sum, { direction, phase }) => sum + Math.sin(direction.dot(point) * Math.PI + phase),
      0,
    ) /
      6 +
    0.5;

  const positions = geometry.getAttribute("position");
  const point = new THREE.Vector3();
  const inward = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index);
    for (const { normal, limit } of cuts) {
      const beyond = normal.dot(point) - limit;
      if (beyond > 0) point.addScaledVector(normal, -beyond);
    }
    inward.copy(point).normalize();
    point.addScaledVector(inward, -chop.dent * size * dentAt(point));
    positions.setXYZ(index, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
