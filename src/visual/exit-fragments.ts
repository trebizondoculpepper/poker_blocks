/**
 * Shred and splinter (#443): two exit effects built on one shared fragment emitter. A fragment is
 * a small mesh of a registered shape (`fragmentShapes`) launched from the departing block, falling
 * under gravity, slowed by drag, tumbling and fading out. What makes a shred a shred is only its
 * default data: many light paper scraps with strong drag that flutter down. A splinter is a few
 * thin slivers that tumble and drop. Neither looks at the block's material; a material picks one
 * by name and may override any setting.
 *
 * Shapes are built once and shared (never disposed); each effect makes one material and frees it
 * on dispose. Counts are bounded. Randomness is cosmetic. Under reduced motion nothing shows.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import { exitEffects, type ExitEffectInstance, type ExitVisual } from "./exit-presentation";

/** A fragment shape for a unit block, built once on first use and shared. */
export const fragmentShapes = new Registry<() => THREE.BufferGeometry>("fragment shape");
const builtShapes = new Map<string, THREE.BufferGeometry>();
const shape = (name: string) => {
  const cached = builtShapes.get(name);
  if (cached) return cached;
  const made = fragmentShapes.get(name)();
  builtShapes.set(name, made);
  return made;
};
/** A torn paper scrap: a thin irregular quad. */
fragmentShapes.register(
  "scrap",
  () =>
    new THREE.ShapeGeometry(
      new THREE.Shape([
        new THREE.Vector2(-0.07, -0.05),
        new THREE.Vector2(0.06, -0.07),
        new THREE.Vector2(0.08, 0.04),
        new THREE.Vector2(-0.03, 0.07),
      ]),
    ),
);
/** A wood splinter: a long thin sliver. */
fragmentShapes.register("splinter", () => new THREE.BoxGeometry(0.03, 0.03, 0.28));

export type FragmentConfig = {
  shape: string;
  count: number;
  speed: [number, number];
  lift: number;
  gravity: number;
  /** Air resistance per second: 0 falls freely, higher flutters. */
  drag: number;
  tumble: number;
  life: number;
  colour: number;
};

export const maxFragments = 64;

/**
 * The bounds of `targets`, in the departing block's own space (unchanged by its world scale or
 * rotation): where fragments start and how big they are. Empty when the targets hold nothing.
 */
export function targetBounds(
  visual: ExitVisual,
  targets: readonly THREE.Object3D[],
  /** Only objects this accepts are measured (the block's own, not other effects' output). */
  include: (object: THREE.Object3D) => boolean = () => true,
): THREE.Box3 {
  visual.root.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(visual.root.matrixWorld).invert();
  const bounds = new THREE.Box3();
  const part = new THREE.Box3();
  for (const target of targets)
    target.traverse((child) => {
      const geometry = (child as THREE.Mesh).geometry;
      if (!geometry || !include(child)) return;
      geometry.computeBoundingBox();
      bounds.union(
        part
          .copy(geometry.boundingBox!)
          .applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, child.matrixWorld)),
      );
    });
  return bounds;
}

/** Emit fragments from a departing block: the shared machinery behind shred and splinter. */
export function emitFragments(
  visual: ExitVisual,
  targets: readonly THREE.Object3D[],
  config: FragmentConfig,
  reducedMotion: boolean,
): ExitEffectInstance {
  // Fragments come from the configured targets only (the whole block, its shell or its contents):
  // an empty target, such as a solid block's contents, emits nothing (#513 review).
  const bounds = targetBounds(visual, targets);
  const size = bounds.isEmpty() ? 0 : Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  const centre = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
  const count =
    reducedMotion || size === 0 ? 0 : Math.max(0, Math.min(maxFragments, Math.round(config.count)));
  const material = new THREE.MeshStandardMaterial({
    color: config.colour,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const geometry = shape(config.shape);
  const fragments = Array.from({ length: count }, () => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(size);
    mesh.position.set(
      centre.x + (Math.random() - 0.5) * size * 0.6,
      centre.y + (Math.random() - 0.5) * size * 0.6,
      centre.z + (Math.random() - 0.5) * size * 0.6,
    );
    mesh.quaternion.random();
    visual.root.add(mesh);
    const speed = config.speed[0] + Math.random() * (config.speed[1] - config.speed[0]);
    return {
      mesh,
      velocity: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * size)
        .add(new THREE.Vector3(0, config.lift * size, 0)),
      axis: new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize(),
    };
  });
  const life = Math.max(config.life, 1e-3);
  let elapsed = count ? 0 : life;
  const turn = new THREE.Quaternion();
  return {
    update(delta) {
      if (elapsed >= life) return false;
      const step = Math.min(delta, life - elapsed);
      elapsed += step;
      const slow = Math.exp(-config.drag * step);
      for (const { mesh, velocity, axis } of fragments) {
        velocity.y -= config.gravity * size * step;
        velocity.multiplyScalar(slow);
        mesh.position.addScaledVector(velocity, step);
        mesh.quaternion.premultiply(turn.setFromAxisAngle(axis, config.tumble * step));
      }
      material.opacity = 1 - elapsed / life;
      return elapsed < life;
    },
    finish() {
      elapsed = life;
      material.opacity = 0;
    },
    dispose() {
      fragments.forEach(({ mesh }) => mesh.removeFromParent());
      material.dispose();
    },
  };
}

/** Light paper scraps that flutter down. */
export const shredDefaults: FragmentConfig = {
  shape: "scrap",
  count: 24,
  speed: [0.6, 1.4],
  lift: 0.8,
  gravity: 2,
  drag: 2.5,
  tumble: 9,
  life: 1.4,
  colour: 0xf2ece0,
};
/** A few thin slivers that tumble and drop. */
export const splinterDefaults: FragmentConfig = {
  shape: "splinter",
  count: 10,
  speed: [1.2, 2.4],
  lift: 1,
  gravity: 6,
  drag: 0.3,
  tumble: 14,
  life: 0.9,
  colour: 0xa0703c,
};

exitEffects.register("shred", ({ visual, targets, reducedMotion }, raw) =>
  emitFragments(
    visual,
    targets,
    { ...shredDefaults, ...(raw as Partial<FragmentConfig>) },
    reducedMotion,
  ),
);
exitEffects.register("splinter", ({ visual, targets, reducedMotion }, raw) =>
  emitFragments(
    visual,
    targets,
    { ...splinterDefaults, ...(raw as Partial<FragmentConfig>) },
    reducedMotion,
  ),
);
