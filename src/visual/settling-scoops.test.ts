import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { stepScoops } from "./settling-scoops";

function settle(down: THREE.Vector3, seconds = 4) {
  const radius = 0.16;
  const limit = 0.5 - radius;
  // As the handler starts them: spread, slightly staggered.
  const positions = [-0.34, 0, 0.34].map(
    (x, i) => new THREE.Vector3(x, 0.01 * i, (i % 2 ? 1 : -1) * 0.02),
  );
  const velocities = positions.map(() => new THREE.Vector3());
  for (let t = 0; t < seconds; t += 1 / 60)
    stepScoops(positions, velocities, down, radius, limit, 3, 0.05, 1 / 60);
  return { positions, radius, limit };
}

describe("settling scoops (#382)", () => {
  it("fall to the lowest side and rest there, inside the walls", () => {
    const { positions, limit } = settle(new THREE.Vector3(0, -1, 0));
    for (const p of positions) {
      expect(p.y).toBeCloseTo(-limit, 3);
      for (const axis of [p.x, p.y, p.z]) expect(Math.abs(axis)).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it("follow the block as it turns: a new down brings them to the new lowest side", () => {
    const { positions, limit } = settle(new THREE.Vector3(1, 0, 0));
    for (const p of positions) expect(p.x).toBeGreaterThan(limit * 0.5);
  });

  it("never overlap one another once at rest", () => {
    const { positions, radius } = settle(new THREE.Vector3(0, -1, 0));
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++)
        expect(positions[i]!.distanceTo(positions[j]!)).toBeGreaterThan(radius * 2 - 0.01);
  });
});
