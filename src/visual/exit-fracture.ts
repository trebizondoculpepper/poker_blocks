/**
 * Crack and fracture (#442), exit effects on the #439 lifecycle. Neither decides anything.
 *
 * - **crack { pattern, seconds, colour }:** crack lines grow across the block's faces, drawn as an
 *   overlay on the exit's root; the block itself is untouched. Lines come from a registered
 *   pattern (`crackPatterns`), so a material picks its look by name. Usable on its own, before a
 *   flash or burst, with no shards.
 * - **fracture { pieces, speed, spin, gravity, life }:** the block breaks into pieces that fly
 *   apart under gravity and spinning. Pieces come from a registered piece source
 *   (`pieceSources`): a piece set (`registerPieceSet`), named recipes built once into shared,
 *   immutable geometry and never a runtime fracture of the mesh; or `components`, the departing
 *   visual's own meshes (a shell breaking up, a fan's parts flying off). What doesn't fly hides.
 *
 * Randomness is cosmetic (`Math.random`). Under reduced motion both end at once and show nothing.
 * Everything an effect makes is freed on dispose; shared piece geometry is never disposed.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import { exitEffects, type ExitEffectInstance, type ExitVisual } from "./exit-presentation";
import { targetBounds } from "./exit-fragments";

/** A recipe for crack lines on a unit cube's faces: segment end points, in growth order. */
export const crackPatterns = new Registry<(random: () => number) => readonly THREE.Vector3[]>(
  "crack pattern",
);

/** Jagged lines from each face's centre toward its edges. */
crackPatterns.register("radial", (random) => {
  const points: THREE.Vector3[] = [];
  const faces: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ];
  for (const [axis, sign] of faces)
    for (let line = 0; line < 3; line++) {
      const angle = random() * Math.PI * 2;
      let u = 0;
      let v = 0;
      for (let step = 0; step < 4; step++) {
        const reach = 0.12 + random() * 0.08;
        const turn = angle + (random() - 0.5) * 0.9;
        const nu = Math.max(-0.5, Math.min(0.5, u + Math.cos(turn) * reach));
        const nv = Math.max(-0.5, Math.min(0.5, v + Math.sin(turn) * reach));
        const at = (a: number, b: number) => {
          const p = [0, 0, 0];
          p[axis] = 0.501 * sign;
          p[(axis + 1) % 3] = a;
          p[(axis + 2) % 3] = b;
          return new THREE.Vector3(...p);
        };
        points.push(at(u, v), at(nu, nv));
        u = nu;
        v = nv;
      }
    }
  return points;
});

/**
 * Where a fracture's pieces come from, by name: given the departing visual, its meshes being
 * broken (`originals`), its size and the effect's colour, a source gives the pieces to throw and
 * how to put things back. `components` throws the block's own meshes; each registered piece set
 * (`registerPieceSet`) throws new pieces built from shared geometry.
 */
export type PieceSource = (context: {
  visual: ExitVisual;
  originals: readonly THREE.Object3D[];
  /** The selected target's bounds in the block's own space: where and how big pieces are. */
  bounds: THREE.Box3;
  colour: number;
}) => { pieces: THREE.Object3D[]; release(): void };
export const pieceSources = new Registry<PieceSource>("piece source");

/** The block's own component meshes fly apart (a shell breaking up, a fan's parts). */
pieceSources.register("components", ({ visual, originals }) => {
  // The root never flies (it carries everything); its own drawing hides instead.
  const pieces = originals.filter((each) => each !== visual.root && (each as THREE.Mesh).isMesh);
  const homes = pieces.map((piece) => ({
    position: piece.position.clone(),
    quaternion: piece.quaternion.clone(),
  }));
  return {
    pieces,
    // Back where they were, so the owner's release frees exactly what it made.
    release: () =>
      pieces.forEach((piece, i) => {
        piece.position.copy(homes[i]!.position);
        piece.quaternion.copy(homes[i]!.quaternion);
      }),
  };
});

/**
 * Register a set of piece geometries for a unit cube under `name`: built once on first use and
 * shared by every fracture (never disposed), each fracture giving its pieces their own material.
 */
export function registerPieceSet(
  name: string,
  recipe: () => readonly THREE.BufferGeometry[],
): void {
  let shared: readonly THREE.BufferGeometry[] | null = null;
  pieceSources.register(name, ({ visual, bounds, colour }) => {
    // Sized and placed to the selected target; an empty target gets no pieces (#512 review).
    if (bounds.isEmpty()) return { pieces: [], release: () => {} };
    shared ??= recipe();
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    const material = new THREE.MeshStandardMaterial({ color: colour });
    const pieces = shared.map((geometry) => {
      const piece = new THREE.Mesh(geometry, material);
      piece.scale.copy(size);
      piece.position.copy(centre);
      visual.root.add(piece);
      return piece;
    });
    return {
      pieces,
      release() {
        pieces.forEach((piece) => piece.removeFromParent());
        material.dispose();
      },
    };
  });
}

/** Five horizontal slabs: the stand-in for authored ice pieces. */
registerPieceSet("slabs", () =>
  Array.from({ length: 5 }, (_, i) =>
    new THREE.BoxGeometry(1, 0.2, 1).translate(0, -0.4 + i * 0.2, 0),
  ),
);
/** Eight irregular pieces, one per octant: pottery shards. */
registerPieceSet("shards", () =>
  [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) =>
        new THREE.TetrahedronGeometry(0.32, 0).translate(x * 0.25, y * 0.25, z * 0.25),
      ),
    ),
  ),
);

/** The size of a departing block in its own space. */
export type CrackConfig = { pattern?: string; seconds?: number; colour?: number };

exitEffects.register(
  "crack",
  ({ visual, targets, reducedMotion, ownsObject }, raw): ExitEffectInstance => {
    const config = raw as CrackConfig | undefined;
    const seconds = Math.max(config?.seconds ?? 0.3, 1e-3);
    // Cracks run over the configured target only: an empty target, such as a solid block's
    // contents, gets none (#512 review).
    // Only the block's own geometry is measured, never a sibling effect's (#512 review).
    const bounds = targetBounds(visual, targets, ownsObject);
    const size = bounds.isEmpty() ? new THREE.Vector3() : bounds.getSize(new THREE.Vector3());
    const centre = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const points =
      reducedMotion || bounds.isEmpty()
        ? []
        : crackPatterns
            .get(config?.pattern ?? "radial")(Math.random)
            .map((p) => p.clone().multiply(size).add(centre));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: config?.colour ?? 0x1a1a1a });
    const lines = new THREE.LineSegments(geometry, material);
    visual.root.add(lines);
    let elapsed = reducedMotion || !points.length ? seconds : 0;
    const reveal = () =>
      geometry.setDrawRange(0, Math.floor((points.length / 2) * (elapsed / seconds)) * 2);
    return {
      update(delta) {
        if (elapsed >= seconds) return false;
        elapsed = Math.min(elapsed + delta, seconds);
        reveal();
        return elapsed < seconds;
      },
      finish() {
        elapsed = seconds;
        reveal();
      },
      dispose() {
        lines.removeFromParent();
        geometry.dispose();
        material.dispose();
      },
    };
  },
);

/** Stands in for a hidden mesh's material while its pieces fly: draws nothing, never disposed. */
const unseen = new THREE.MeshBasicMaterial({ visible: false });

export type FractureConfig = {
  pieces?: string;
  speed?: [number, number];
  spin?: number;
  gravity?: number;
  life?: number;
  colour?: number;
};

exitEffects.register(
  "fracture",
  ({ visual, targets, reducedMotion, ownsObject }, raw): ExitEffectInstance => {
    const config = raw as FractureConfig | undefined;
    const life = Math.max(config?.life ?? 0.8, 1e-3);
    const [slow, fast] = config?.speed ?? [0.8, 1.8];
    const spin = config?.spin ?? 8;
    // Measured in the block's own space, from the selected target (#512 review).
    const bounds = targetBounds(visual, targets, ownsObject);
    const size = bounds.isEmpty() ? 0 : Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
    const gravity = (config?.gravity ?? 4) * size;
    // The block's own meshes under the targets: broken up or hidden while the pieces fly.
    const originals: THREE.Object3D[] = [];
    for (const target of targets)
      target.traverse((child) => {
        // Only the block's own objects: never a sibling effect's particles or overlays.
        // The root counts too: a root that is itself a mesh is part of the block (#512 review).
        if (ownsObject(child)) originals.push(child);
      });
    const source = reducedMotion
      ? { pieces: [], release: () => {} }
      : pieceSources.get(config?.pieces ?? "components")({
          visual,
          originals,
          bounds,
          colour: config?.colour ?? 0xcccccc,
        });
    // Every original mesh that isn't itself a flying piece stops drawing while the pieces fly:
    // each gets the shared invisible material in place of its own, which comes back on dispose.
    // Only that mesh's own drawing changes, never its children's (flying components, a flash's
    // overlay) and never a material another mesh shares (#512 review).
    const thrown = new Set<THREE.Object3D>(source.pieces);
    const hidden = reducedMotion
      ? []
      : originals
          .filter((each) => (each as THREE.Mesh).isMesh && !thrown.has(each))
          .map((each) => ({ mesh: each as THREE.Mesh, material: (each as THREE.Mesh).material }));
    hidden.forEach(({ mesh }) => (mesh.material = unseen));
    // Motion is worked out in the block's own space, then turned into each piece's parent's
    // space, so a piece inside a scaled or turned group still flies and falls true (#512 review).
    visual.root.updateWorldMatrix(true, true);
    const fromRoot = new THREE.Matrix4().copy(visual.root.matrixWorld).invert();
    const motion = source.pieces.map((piece) => {
      const toParent = new THREE.Matrix3().setFromMatrix4(
        new THREE.Matrix4()
          .multiplyMatrices(fromRoot, piece.parent?.matrixWorld ?? visual.root.matrixWorld)
          .invert(),
      );
      return {
        velocity: new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5)
          .normalize()
          .multiplyScalar((slow + Math.random() * (fast - slow)) * size)
          .applyMatrix3(toParent),
        fall: new THREE.Vector3(0, -gravity, 0).applyMatrix3(toParent),
        axis: new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        ).normalize(),
      };
    });
    let elapsed = reducedMotion ? life : 0;
    const turn = new THREE.Quaternion();
    return {
      update(delta) {
        if (elapsed >= life) return false;
        const step = Math.min(delta, life - elapsed);
        elapsed += step;
        source.pieces.forEach((piece, i) => {
          const { velocity, fall, axis } = motion[i]!;
          velocity.addScaledVector(fall, step);
          piece.position.addScaledVector(velocity, step);
          piece.quaternion.premultiply(turn.setFromAxisAngle(axis, spin * step));
        });
        return elapsed < life;
      },
      finish() {
        elapsed = life;
      },
      dispose() {
        source.release();
        hidden.forEach(({ mesh, material }) => (mesh.material = material));
      },
    };
  },
);
