import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { choppedGeometry, type ChopSettings } from "./chopped-geometry";

const chop: ChopSettings = { cuts: [2, 3], depth: [0.06, 0.15], dent: 0.03 };
const points = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(position, index),
  );
};

describe("chopped hunks (meat)", () => {
  it("only removes material: every point stays inside the block's cell", () => {
    for (const seed of ["5-hearts", "K-spades", "A-clubs"])
      for (const point of points(choppedGeometry(2, 8, chop, seed)))
        for (const axis of [point.x, point.y, point.z])
          expect(Math.abs(axis)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("is really chopped: cleaver cuts take away at least two of the box's corners", () => {
    for (const seed of ["5-hearts", "K-spades", "A-clubs"]) {
      const all = points(choppedGeometry(2, 8, chop, seed));
      const corners = [-1, 1].flatMap((x) =>
        [-1, 1].flatMap((y) => [-1, 1].map((z) => new THREE.Vector3(x, y, z))),
      );
      const cut = corners.filter((corner) => all.every((point) => point.distanceTo(corner) > 0.1));
      expect(cut.length, seed).toBeGreaterThanOrEqual(2);
    }
  });

  it("is the same hunk for the same block, and a different one for another", () => {
    const a = points(choppedGeometry(2, 8, chop, "5-hearts"));
    const again = points(choppedGeometry(2, 8, chop, "5-hearts"));
    const other = points(choppedGeometry(2, 8, chop, "9-clubs"));
    expect(again.every((point, index) => point.equals(a[index]!))).toBe(true);
    expect(other.some((point, index) => point.distanceTo(a[index]!) > 1e-3)).toBe(true);
  });

  it("keeps a face group per side, so each face still has its own material", () => {
    expect(choppedGeometry(2, 8, chop, "5-hearts").groups).toHaveLength(6);
  });

  it("never cracks: vertices shared by two faces move together", () => {
    const seen = new Map<string, THREE.Vector3>();
    const box = new THREE.BoxGeometry(2, 2, 2, 8, 8, 8).getAttribute("position");
    const chopped = choppedGeometry(2, 8, chop, "Q-diamonds").getAttribute("position");
    for (let index = 0; index < box.count; index++) {
      const key = [box.getX(index), box.getY(index), box.getZ(index)]
        .map((value) => value.toFixed(5))
        .join(",");
      const moved = new THREE.Vector3().fromBufferAttribute(chopped, index);
      const first = seen.get(key);
      if (first) expect(moved.distanceTo(first)).toBeLessThan(1e-9);
      else seen.set(key, moved);
    }
  });
});

describe("ice's milder chopped edges (#1001)", async () => {
  const { getMaterialDefinition } = await import("../materials");
  const ice = getMaterialDefinition("ice").appearance.geometry;
  const meat = getMaterialDefinition("meat").appearance.geometry;

  it("reuses the chopped builder with its own, milder settings, leaving meat's alone", () => {
    expect(ice.shape).toBe("chopped");
    expect(ice.chop).toEqual({ cuts: [2, 3], depth: [0.01, 0.04], dent: 0.005 });
    expect(meat.chop).toEqual({ cuts: [3, 4], depth: [0.08, 0.16], dent: 0.04 });
  });

  it("stays inside its cell and is deterministic per block, roughened but nearly a cube", () => {
    for (const seed of ["A-spades", "7-diamonds"]) {
      const a = points(choppedGeometry(2, ice.segments, ice.chop!, seed));
      const b = points(choppedGeometry(2, ice.segments, ice.chop!, seed));
      expect(a).toEqual(b);
      let moved = 0;
      for (const point of a) {
        for (const axis of [point.x, point.y, point.z])
          expect(Math.abs(axis)).toBeLessThanOrEqual(1 + 1e-9);
        // Every point is within the configured cut depth (4% of a side of 2) of the box surface.
        const surface = Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z));
        expect(surface).toBeGreaterThan(1 - 0.16);
        if (surface < 1 - 1e-6) moved += 1;
      }
      expect(moved, seed).toBeGreaterThan(0);
    }
  });
});
