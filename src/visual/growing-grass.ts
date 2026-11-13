/**
 * Growing grass (#358): little blades that grow, one at a time, on the top of settled contents.
 * An inclusion: it reads only the contents' published `liquidSurface` and the block's rotation
 * from the shared frame, so the contents never know it exists and it can be omitted without
 * changing their motion. Earth composes it; nothing names earth.
 *
 * Lifecycle (doc/presentation-contracts.md, "Grass survives until fully buried", #765):
 * - **A blade stays where it grew.** Its root, lean and height are fixed in the block's own
 *   space when it is born; the moving soil never drags it along.
 * - **Turning restarts the clock for new growth only.** When the block's world rotation moves by
 *   more than `turnDegrees` from where the stillness started, the timer resets, so no new blade
 *   is born until it is still again; existing blades stay. Camera movement doesn't change the
 *   block's rotation. The tolerance sits above the board's presentation wobble (8–12°).
 * - **Only complete burial removes a blade.** Each frame, a blade whose every vertex (both base
 *   corners and the tip) is on the soil side of the published surface, within a small
 *   tolerance, is retired and its slot reused. Partly buried blades keep their visible part
 *   (depth hides the rest). Being hidden by the shell or offscreen is not burial.
 * - **Only on a settled top.** The timer counts stillness from the end of the last turn, but no
 *   blade is born until the surface's normal is within `settledDegrees` of world up (seen from
 *   the block), so grass never grows on an obsolete, still-moving top. With slow contents the
 *   first blade therefore appears at whichever comes later: `delay` seconds of stillness, or
 *   the surface settling.
 * - **One blade at a time.** Blades are born `interval` seconds apart (with jitter) at random
 *   places on the surface inside the walls, each growing smoothly from nothing over
 *   `growSeconds`, and earlier blades stay. The pool is bounded.
 * - Under reduced motion blades appear at full height instead of growing.
 *
 * Cosmetic randomness only: never the session's seeded stream.
 */
import * as THREE from "three";
import { cosmeticRandom } from "./block-effects";
import { containedInclusions, containedLayers, type InclusionHandler } from "./contained";

export type GrowingGrassConfig = {
  /** Most blades on the top. */
  count: number;
  /** Seconds of stillness before the first blade. */
  delay: number;
  /** Seconds between births, on average. */
  interval: number;
  /** Seconds for a blade to grow to full height. */
  growSeconds: number;
  /** A blade's height and base width, as fractions of the interior's width. */
  height: number;
  width: number;
  /** Its colours, base to tip (hex). */
  base: number;
  tip: number;
  /** Rotation (degrees) that counts as turning the block: it restarts the stillness timer. */
  turnDegrees: number;
  /** How near world up (degrees) the surface must be to count as settled. */
  settledDegrees: number;
};

export const growingGrass: InclusionHandler = {
  requires: "liquidSurface",
  build(boundary, { liquidSurface }, raw) {
    const config = raw as GrowingGrassConfig;
    const surface = liquidSurface!;
    const width = boundary.halfSize * 2;
    // Blade geometry lives in the mesh's own space, which the volume scale maps to block-local.
    const scale = boundary.volumeScale;
    const reach = boundary.halfSize - (config.width * width) / 2;
    const count = config.count;
    const positions = new Float32Array(count * 9);
    const colours = new Float32Array(count * 9);
    const bases = new Float32Array(count * 3);
    const leans = new Float32Array(count * 3);
    const across = new Float32Array(count * 3);
    const births = new Float32Array(count);
    const tall = new Float32Array(count);
    /** The surface normal each blade was born on: it grows along it, whatever the soil does. */
    const normals = new Float32Array(count * 3);
    /** Which slots hold a blade; a retired slot is reused by the next birth. */
    const alive = new Uint8Array(count);
    const base = new THREE.Color(config.base);
    const tip = new THREE.Color(config.tip);
    for (let i = 0; i < count; i++) {
      base.toArray(colours, i * 9);
      base.toArray(colours, i * 9 + 3);
      tip.toArray(colours, i * 9 + 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // The blades own their geometry; it is released with their material, which the block disposes.
    material.addEventListener("dispose", () => geometry.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(scale);
    mesh.renderOrder = containedLayers.contentsOpaque;
    mesh.frustumCulled = false;

    const random = cosmeticRandom;
    const anchor = new THREE.Quaternion();
    const inverse = new THREE.Quaternion();
    const up = new THREE.Vector3();
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    const point = new THREE.Vector3();
    const turn = THREE.MathUtils.degToRad(config.turnDegrees);
    const settled = Math.cos(THREE.MathUtils.degToRad(config.settledDegrees));
    let still = 0;
    /** Seconds since the grass was made: each blade's age is measured on this clock. */
    let clock = 0;
    let nextBirth = 0;
    let started = false;
    /** How far below the surface (block-local units) a vertex must be to count as buried. */
    const tolerance = 1e-4 * width;

    const retire = (i: number) => {
      alive[i] = 0;
      positions.fill(0, i * 9, i * 9 + 9);
    };
    /** A place on the current top, inside the walls; false if none was found. */
    const place = (i: number): boolean => {
      const n = surface.normal;
      // A tangent from the axis least aligned with the normal, so no normal (a diagonal one
      // included) gives a degenerate basis.
      const ax = Math.abs(n.x),
        ay = Math.abs(n.y),
        az = Math.abs(n.z);
      u.set(ax <= ay && ax <= az ? 1 : 0, ay < ax && ay <= az ? 1 : 0, az < ax && az < ay ? 1 : 0)
        .cross(n)
        .normalize();
      v.crossVectors(n, u);
      for (let attempt = 0; attempt < 8; attempt++) {
        point
          .copy(n)
          .multiplyScalar(surface.height / scale)
          .addScaledVector(u, (random() * 2 - 1) * boundary.halfSize * 1.5)
          .addScaledVector(v, (random() * 2 - 1) * boundary.halfSize * 1.5);
        if (Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) > reach) continue;
        point.toArray(bases, i * 3);
        // Each blade leans a little its own way (kept as a sideways offset, applied to the live
        // normal when drawn), and has its own height.
        point
          .set(0, 0, 0)
          .addScaledVector(u, (random() - 0.5) * 0.5)
          .addScaledVector(v, (random() - 0.5) * 0.5);
        point.toArray(leans, i * 3);
        point
          .copy(u)
          .multiplyScalar(Math.cos(random() * Math.PI))
          .addScaledVector(v, Math.sin(random() * Math.PI))
          .normalize();
        point.toArray(across, i * 3);
        tall[i] = config.height * width * (0.6 + 0.4 * random());
        n.toArray(normals, i * 3);
        return true;
      }
      return false;
    };
    const root = new THREE.Vector3();
    const side = new THREE.Vector3();
    const rise = new THREE.Vector3();
    const own = new THREE.Vector3();
    const corner = new THREE.Vector3();
    const flat = (array: Float32Array, i: number, out: THREE.Vector3, n: THREE.Vector3) =>
      out.fromArray(array, i * 3).addScaledVector(n, -out.dot(n));
    /** Draw a blade from its own root, along the normal it was born on, `grown` of its height. */
    const draw = (i: number, grown: number) => {
      own.fromArray(normals, i * 3);
      root.fromArray(bases, i * 3);
      flat(across, i, side, own)
        .normalize()
        .multiplyScalar((config.width * width) / 2);
      flat(leans, i, rise, own)
        .add(own)
        .normalize()
        .multiplyScalar(tall[i]! * grown);
      const o = i * 9;
      corner.copy(root).sub(side).toArray(positions, o);
      corner
        .copy(root)
        .add(side)
        .toArray(positions, o + 3);
      // The tip rises from the base: a blade draws itself up rather than popping in.
      corner
        .copy(root)
        .add(rise)
        .toArray(positions, o + 6);
    };
    /** Every vertex of blade `i`, as drawn now, on the soil side of the current surface. */
    const buried = (i: number): boolean => {
      const n = surface.normal;
      const level = surface.height / scale;
      for (let vertex = 0; vertex < 3; vertex++)
        if (corner.fromArray(positions, i * 9 + vertex * 3).dot(n) > level - tolerance)
          return false;
      return true;
    };

    return {
      meshes: [mesh],
      update({ delta, rotation, reducedMotion }) {
        clock += delta;
        if (!started || anchor.angleTo(rotation) > turn) {
          // Turned (or first frame): stillness starts again, for new growth only.
          anchor.copy(rotation);
          started = true;
          still = 0;
          nextBirth = 0;
        } else still += delta;
        up.set(0, 1, 0).applyQuaternion(inverse.copy(rotation).invert());
        const ready = still >= config.delay && surface.normal.dot(up) >= settled;
        const free = alive.indexOf(0);
        if (ready && free >= 0 && still >= nextBirth) {
          if (place(free)) {
            births[free] = clock;
            alive[free] = 1;
          }
          nextBirth = Math.max(still, config.delay) + config.interval * (0.5 + random());
        }
        for (let i = 0; i < count; i++) {
          if (!alive[i]) continue;
          const age = clock - births[i]!;
          const t = reducedMotion ? 1 : Math.min(age / config.growSeconds, 1);
          draw(i, t * t * (3 - 2 * t));
          if (buried(i)) retire(i);
        }
        geometry.attributes.position!.needsUpdate = true;
      },
    };
  },
};

containedInclusions.register("growingGrass", growingGrass);
