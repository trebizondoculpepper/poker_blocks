import { describe, expect, it } from "vite-plus/test";
import * as THREE from "three";
import {
  defaultAttractTuning,
  depthOpacity,
  equalMaterialWeights,
  fadedInZ,
  fieldRadius,
  cameraHitDistance,
  pathPoint,
  pickMaterial,
  bounceOffCamera,
  cameraRoll,
  cameraRollPeriod,
  collide,
  contactDistance,
  type Body,
  spawnZ,
  type MaterialWeight,
} from "./attract-scene";
import { blockMaterials } from "./materials";

describe("the attract sequence's paths (#147)", () => {
  it("spreads paths evenly over the field, so now and then one comes straight at the camera", () => {
    const radii = Array.from(
      { length: 2000 },
      (_, index) => pathPoint(() => (index * 0.6180339887) % 1).radius,
    );
    expect(Math.max(...radii)).toBeLessThanOrEqual(fieldRadius);
    // Some paths come within hitting distance of the camera; most pass beside it.
    const headOn = radii.filter((radius) => radius < cameraHitDistance).length / radii.length;
    expect(headOn).toBeGreaterThan(0);
    expect(headOn).toBeLessThan(0.2);
  });

  it("scatters the paths around the axis rather than lining them up", () => {
    const quadrants = new Set<string>();
    for (let index = 0; index < 400; index++) {
      const { x, y } = pathPoint(() => (index * 0.6180339887) % 1);
      quadrants.add(`${x < 0 ? "L" : "R"}${y < 0 ? "D" : "U"}`);
    }
    expect(quadrants.size).toBe(4);
  });
});

describe("attract cards fade in with depth", () => {
  it("spawns at -40 and is fully faded in by -35", () => {
    expect(spawnZ).toBe(-40);
    expect(fadedInZ).toBe(-35);
  });

  it("is invisible at the spawn, opaque from -35 on, and eases in between", () => {
    expect(depthOpacity(spawnZ)).toBe(0);
    expect(depthOpacity(spawnZ - 5)).toBe(0);
    expect(depthOpacity(fadedInZ)).toBe(1);
    expect(depthOpacity(0)).toBe(1);
    expect(depthOpacity(-37.5)).toBeCloseTo(0.5);
    // Eased: slow at both ends, so a quarter of the way in is well under a quarter opaque.
    expect(depthOpacity(-38.75)).toBeLessThan(0.25);
    expect(depthOpacity(-36.25)).toBeGreaterThan(0.75);
  });
});

describe("attract cards come in every material, by weight", () => {
  /** A deterministic sequence spread evenly over [0, 1). */
  const evenly = (count: number) => {
    let index = 0;
    return () => (index++ % count) / count + 0.5 / count;
  };

  it("uses every material, equally, by default", () => {
    expect(defaultAttractTuning.materialWeights).toEqual(equalMaterialWeights);
    const random = evenly(blockMaterials.length * 10);
    const counts = new Map<string, number>();
    for (let draw = 0; draw < blockMaterials.length * 10; draw++) {
      const material = pickMaterial(equalMaterialWeights, random);
      counts.set(material, (counts.get(material) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...blockMaterials].sort());
    expect(new Set(counts.values())).toEqual(new Set([10]));
  });

  it("follows the weights, and leaves out a material weighted 0", () => {
    const weights: MaterialWeight[] = [
      { material: "steel", weight: 3 },
      { material: "wood", weight: 1 },
      { material: "paper", weight: 0 },
    ];
    const random = evenly(400);
    const drawn = Array.from({ length: 400 }, () => pickMaterial(weights, random));
    expect(new Set(drawn)).toEqual(new Set(["steel", "wood"]));
    expect(drawn.filter((material) => material === "steel")).toHaveLength(300);
  });

  it("falls back to paper when no material has any weight", () => {
    const none = equalMaterialWeights.map(({ material }) => ({ material, weight: 0 }));
    expect(pickMaterial(none, () => 0.5)).toBe("paper");
  });
});

describe("material trails (#203)", () => {
  it("names only registered trail effects, and gives prismatic crystal its rainbow stars", async () => {
    const { trailEffects } = await import("./attract-trails");
    const { getMaterialDefinition } = await import("./materials");
    for (const material of blockMaterials)
      for (const trail of getMaterialDefinition(material).appearance.trails ?? [])
        expect(trailEffects.has(trail.effect), `${material}: ${trail.effect}`).toBe(true);
    expect(
      getMaterialDefinition("prismatic").appearance.trails?.map(({ effect }) => effect),
    ).toEqual(["rainbowStars"]);
  });
});

describe("attract cards collide (#203)", () => {
  const body = (position: [number, number, number], velocity: [number, number, number]): Body => ({
    position: new THREE.Vector3(...position),
    velocity: new THREE.Vector3(...velocity),
    angular: new THREE.Vector3(0, 0.5, 0),
  });
  const momentum = (bodies: readonly Body[]) =>
    bodies.reduce((sum, { velocity }) => sum.add(velocity), new THREE.Vector3());

  it("passes a fast card's speed to a slow one it catches head on, keeping momentum", () => {
    const slow = body([5, 0, -10], [0, 0, 2]);
    const fast = body([5, 0, -11], [0, 0, 8]);
    const before = momentum([slow, fast]);
    collide([slow, fast]);
    expect(slow.velocity.z).toBeGreaterThan(fast.velocity.z);
    expect(momentum([slow, fast]).distanceTo(before)).toBeLessThan(1e-9);
  });

  it("sends an off-centre knock off at an angle, and sets the cards spinning differently", () => {
    const a = body([5, 0.6, -10], [0, 0, 2]);
    const b = body([5, 0, -11], [0, 0, 8]);
    const spinBefore = a.angular.clone();
    collide([a, b]);
    expect(Math.abs(a.velocity.y)).toBeGreaterThan(0.1);
    expect(Math.sign(a.velocity.y)).toBe(-Math.sign(b.velocity.y));
    expect(a.angular.distanceTo(spinBefore)).toBeGreaterThan(0);
  });

  it("pushes touching cards out of each other, and ignores cards not touching", () => {
    const a = body([5, 0, -10], [0, 0, 4]);
    const b = body([5, 0, -10.5], [0, 0, 4]);
    collide([a, b]);
    expect(a.position.distanceTo(b.position)).toBeCloseTo(contactDistance);
    const far = body([5, 0, 0], [0, 0, 4]);
    const other = body([5, 0, -contactDistance - 0.1], [0, 0, 9]);
    collide([far, other]);
    expect(far.velocity.toArray()).toEqual([0, 0, 4]);
  });

  it("bounces a card off the camera, back and glancing sideways", () => {
    const card = body([0.2, 0.1, 7], [0, 0, 6]);
    let draw = 0;
    bounceOffCamera(card, () => [0.9, 0.2, 0.7, 0.1, 0.4, 0.8][draw++ % 6]!);
    // Pushed back out to the hit distance, heading away from the camera, and off to the side.
    expect(card.position.distanceTo(new THREE.Vector3(0, 0, 8))).toBeCloseTo(cameraHitDistance);
    expect(card.velocity.z).toBeLessThan(0);
    expect(Math.hypot(card.velocity.x, card.velocity.y)).toBeGreaterThan(1);
  });

  it("leaves a card alone that is moving away from the camera or not touching it", () => {
    const leaving = body([0, 0, 7], [0, 0, -3]);
    bounceOffCamera(leaving, () => 0.5);
    expect(leaving.velocity.toArray()).toEqual([0, 0, -3]);
    const passing = body([5, 0, 8], [0, 0, 6]);
    bounceOffCamera(passing, () => 0.5);
    expect(passing.velocity.toArray()).toEqual([0, 0, 6]);
  });
});

describe("the attract camera rolls back and forth (#203)", () => {
  it("swings through one revolution and back over a 140 s period", () => {
    expect(cameraRollPeriod).toBe(140);
    expect(cameraRoll(0)).toBeCloseTo(0);
    // The extremes, a quarter and three quarters of the way through: half a turn each way.
    expect(cameraRoll(35)).toBeCloseTo(Math.PI);
    expect(cameraRoll(105)).toBeCloseTo(-Math.PI);
    expect(cameraRoll(140)).toBeCloseTo(0);
    // So each sweep between the extremes is one full revolution.
    expect(cameraRoll(35) - cameraRoll(105)).toBeCloseTo(Math.PI * 2);
  });

  it("eases to a stop at each extreme and turns fastest through level", () => {
    const rate = (t: number) => (cameraRoll(t + 0.01) - cameraRoll(t - 0.01)) / 0.02;
    expect(Math.abs(rate(35))).toBeLessThan(0.01);
    expect(Math.abs(rate(0))).toBeGreaterThan(0.1);
  });
});
