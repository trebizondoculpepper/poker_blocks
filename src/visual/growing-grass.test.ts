import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createInteriorBoundary, type ContainedFrame } from "./contained";
import { growingGrass, type GrowingGrassConfig } from "./growing-grass";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const config: GrowingGrassConfig = {
  count: 30,
  delay: 5,
  interval: 0.12,
  growSeconds: 0.8,
  height: 0.14,
  width: 0.025,
  base: 0x2f6b22,
  tip: 0x8fd16a,
  turnDegrees: 30,
  settledDegrees: 20,
};

function vessel() {
  const boundary = createInteriorBoundary(geometry, 1, 0.92);
  const normal = new THREE.Vector3(0, 1, 0);
  const surface = { normal, height: 0, wet: (p: THREE.Vector3) => p.dot(normal) <= 0 };
  const grass = growingGrass.build(boundary, { liquidSurface: surface }, config);
  const mesh = grass.meshes[0] as THREE.Mesh;
  const rotation = new THREE.Quaternion();
  let seconds = 0;
  const run = (duration: number, reducedMotion = false, delta = 1 / 30) => {
    for (let t = 0; t < duration; t += delta) {
      seconds += delta;
      const frame: ContainedFrame = { seconds, delta, first: false, rotation, reducedMotion };
      grass.update!(frame);
    }
  };
  /** Blades with any height: the tip is off the base. */
  const blades = () => {
    const p = mesh.geometry.getAttribute("position").array as Float32Array;
    const out: { base: THREE.Vector3; tip: THREE.Vector3 }[] = [];
    for (let o = 0; o < p.length; o += 9) {
      const base = new THREE.Vector3(
        p[o]! + p[o + 3]!,
        p[o + 1]! + p[o + 4]!,
        p[o + 2]! + p[o + 5]!,
      ).multiplyScalar(0.5);
      const tip = new THREE.Vector3(p[o + 6], p[o + 7], p[o + 8]);
      if (tip.distanceTo(base) > 1e-6) out.push({ base, tip });
    }
    return out;
  };
  return { run, blades, rotation, normal, boundary, mesh };
}

describe("growing grass (#358)", () => {
  it("waits about five seconds of stillness, then grows blades one at a time", () => {
    const v = vessel();
    v.run(4.9);
    expect(v.blades()).toHaveLength(0);
    v.run(0.2);
    expect(v.blades().length).toBeGreaterThanOrEqual(1);
    expect(v.blades().length).toBeLessThanOrEqual(2);
    const early = v.blades().length;
    v.run(1);
    expect(v.blades().length).toBeGreaterThan(early);
  });

  it("grows each blade smoothly from nothing, rather than popping in", () => {
    const v = vessel();
    // Born at zero height: a moment later it has only begun to rise.
    v.run(5.15);
    const first = v.blades()[0]!;
    const short = first.tip.distanceTo(first.base);
    v.run(1);
    const grown = v.blades()[0]!;
    expect(grown.tip.distanceTo(grown.base)).toBeGreaterThan(short * 2);
  });

  it("grows on the top, inside the walls, pointing up", () => {
    const v = vessel();
    v.run(12);
    expect(v.blades().length).toBe(config.count);
    for (const { base, tip } of v.blades()) {
      expect(Math.abs(base.y)).toBeLessThan(1e-6);
      expect(tip.y).toBeGreaterThan(0);
      for (const axis of [base.x, base.z])
        expect(Math.abs(axis)).toBeLessThanOrEqual(v.boundary.halfSize);
    }
  });

  it("is destroyed by turning the block, then grows again after stillness, but not on an unsettled top", () => {
    const v = vessel();
    v.run(8);
    expect(v.blades().length).toBeGreaterThan(0);
    v.rotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    v.run(1 / 30);
    expect(v.blades()).toHaveLength(0);
    // The surface hasn't settled toward the block's new up yet: no grass, however long.
    v.run(8);
    expect(v.blades()).toHaveLength(0);
    // Settled: world up in the block's space is now -z.
    v.normal.set(0, 0, -1);
    v.run(1);
    expect(v.blades().length).toBeGreaterThan(0);
  });

  it("ignores jitter below the turn tolerance", () => {
    const v = vessel();
    v.run(7);
    const before = v.blades().length;
    v.rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(0.5));
    v.run(0.5);
    expect(v.blades().length).toBeGreaterThanOrEqual(before);
  });

  it("appears at full height under reduced motion, and releases its geometry", () => {
    const v = vessel();
    v.run(5.05, true);
    const blade = v.blades()[0]!;
    expect(blade.tip.distanceTo(blade.base)).toBeGreaterThan(0.06);
    let released = false;
    v.mesh.geometry.addEventListener("dispose", () => (released = true));
    (v.mesh.material as THREE.Material).dispose();
    expect(released).toBe(true);
  });

  it("survives the board's automatic wobble, which is not a turn (#419 review)", () => {
    const v = vessel();
    const axis = new THREE.Vector3(1, 0, 0);
    for (let t = 0; t < 8; t += 1 / 30) {
      v.rotation.setFromAxisAngle(axis, THREE.MathUtils.degToRad(12 * Math.sin(t * 1.3)));
      v.run(1 / 30);
    }
    expect(v.blades().length).toBeGreaterThan(0);
  });

  it("grows real blades on a diagonal top (#419 review)", () => {
    const v = vessel();
    v.normal.set(1, 1, 1).normalize();
    // World up seen from the block is the diagonal too, so the top counts as settled.
    v.rotation.setFromUnitVectors(
      new THREE.Vector3(1, 1, 1).normalize(),
      new THREE.Vector3(0, 1, 0),
    );
    v.run(7);
    const blades = v.blades();
    expect(blades.length).toBeGreaterThan(1);
    expect(blades[0]!.base.distanceTo(blades[1]!.base)).toBeGreaterThan(1e-6);
  });
});
