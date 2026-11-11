/**
 * Settling scoops (#382): a few solid spheres that fall toward whichever side of their container
 * is lowest as the block turns (three Neapolitan scoops, for one), configured rather than named.
 *
 * A tiny rigid-body step per frame: gravity toward world down (turned into the container's own
 * space from the shared frame), damping, walls with a margin of each sphere's radius, and
 * pairwise separation so the scoops rest against one another rather than overlapping. No fluid
 * simulation and no residue. Cost is constant: a handful of spheres, one draw call each.
 * Under reduced motion they come to rest at once each frame instead of rolling.
 */
import * as THREE from "three";
import { containedContents, containedLayers } from "./contained";

export type SettlingScoopsConfig = {
  /** Each scoop's colour (hex): one sphere per entry. */
  colours: readonly number[];
  /** A scoop's radius, as a fraction of the interior's width. */
  radius: number;
  /** Gravity, in interior widths per second per second. */
  gravity: number;
  /** Velocity kept per second (0 to 1): lower settles sooner. */
  damping: number;
  /** Surface roughness of the scoops. */
  roughness: number;
};

/** One step of the scoops' motion, exported for tests. Positions and velocities are mutated. */
export function stepScoops(
  positions: THREE.Vector3[],
  velocities: THREE.Vector3[],
  down: THREE.Vector3,
  radius: number,
  limit: number,
  gravity: number,
  damping: number,
  delta: number,
): void {
  const keep = Math.pow(damping, delta);
  positions.forEach((p, i) => {
    const v = velocities[i]!;
    v.addScaledVector(down, gravity * delta).multiplyScalar(keep);
    p.addScaledVector(v, delta);
    for (const axis of ["x", "y", "z"] as const) {
      if (Math.abs(p[axis]) > limit) {
        p[axis] = Math.sign(p[axis]) * limit;
        v[axis] = 0;
      }
    }
  });
  // Pairwise separation, a few passes, so stacked scoops rest on one another.
  const gap = new THREE.Vector3();
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        gap.subVectors(b, a);
        const distance = gap.length();
        const overlap = radius * 2 - distance;
        if (overlap <= 0) continue;
        if (distance < 1e-9) gap.set(1, 0, 0);
        gap.normalize().multiplyScalar(overlap / 2);
        a.sub(gap).clampScalar(-limit, limit);
        b.add(gap).clampScalar(-limit, limit);
      }
}

containedContents.register("settlingScoops", (boundary, raw) => {
  const config = raw as SettlingScoopsConfig;
  const width = boundary.halfSize * 2;
  const radius = config.radius * width;
  const limit = boundary.halfSize - radius;
  const geometry = new THREE.SphereGeometry(radius, 24, 16);
  const count = config.colours.length;
  // Start spread across the middle, slightly staggered so no two lie exactly in line with the
  // fall (they can slide past one another); the first frames drop them to the lowest side.
  const positions = config.colours.map(
    (_, i) =>
      new THREE.Vector3(
        (i - (count - 1) / 2) * radius * 2.1,
        0.01 * i,
        (i % 2 ? 1 : -1) * 0.02 * width,
      ),
  );
  const velocities = positions.map(() => new THREE.Vector3());
  const meshes = config.colours.map((colour, i) => {
    const material = new THREE.MeshStandardMaterial({ color: colour, roughness: config.roughness });
    // The scoops share one geometry, released with their materials (dispose is idempotent).
    material.addEventListener("dispose", () => geometry.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(positions[i]!).multiplyScalar(boundary.volumeScale);
    mesh.scale.setScalar(boundary.volumeScale);
    mesh.renderOrder = containedLayers.contentsOpaque;
    return mesh;
  });
  const down = new THREE.Vector3();
  const inverse = new THREE.Quaternion();
  return {
    meshes,
    capabilities: {},
    update({ delta, rotation, reducedMotion }) {
      down.set(0, -1, 0).applyQuaternion(inverse.copy(rotation).invert());
      // Reduced motion: many short steps at once, so the scoops are simply at rest.
      const steps = reducedMotion ? 60 : 1;
      for (let s = 0; s < steps; s++)
        stepScoops(
          positions,
          velocities,
          down,
          radius,
          limit,
          config.gravity * width,
          config.damping,
          reducedMotion ? 0.05 : delta,
        );
      meshes.forEach((mesh, i) =>
        mesh.position.copy(positions[i]!).multiplyScalar(boundary.volumeScale),
      );
    },
  };
});
