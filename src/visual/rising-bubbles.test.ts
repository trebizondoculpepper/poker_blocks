import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import {
  composeContained,
  createInteriorBoundary,
  type ContainedFrame,
  type LiquidSurface,
} from "./contained";
import { risingBubbles, type RisingBubblesConfig } from "./rising-bubbles";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const config: RisingBubblesConfig = {
  count: 40,
  rise: 0.3,
  wobble: 0.02,
  size: 0.07,
  rest: 0.2,
  colour: 0xffffff,
  opacity: 0.7,
};

/** A surface the test can tilt and raise, as the levelling fluid does. */
function liquid(height = 0.05): LiquidSurface & { normal: THREE.Vector3; height: number } {
  const normal = new THREE.Vector3(0, 1, 0);
  const surface = {
    normal,
    height,
    wet: (p: THREE.Vector3) => p.dot(surface.normal) <= surface.height,
  };
  return surface;
}

function run(surface: ReturnType<typeof liquid>, frames: number, reducedMotion = false) {
  const boundary = createInteriorBoundary(geometry, 1, 0.92);
  const bubbles = risingBubbles.build(boundary, { liquidSurface: surface }, config);
  const points = bubbles.meshes[0] as THREE.Points;
  let seconds = 0;
  const step = (delta = 1 / 60) => {
    seconds += delta;
    const frame: ContainedFrame = {
      seconds,
      delta,
      first: false,
      rotation: new THREE.Quaternion(),
      reducedMotion,
    };
    bubbles.update!(frame);
  };
  for (let i = 0; i < frames; i++) step();
  const visible = () => {
    const p = points.geometry.getAttribute("position").array as Float32Array;
    const c = points.geometry.getAttribute("color").array as Float32Array;
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < c.length; i += 3)
      if (c[i]! > 0)
        out.push(new THREE.Vector3(p[i], p[i + 1], p[i + 2]).multiplyScalar(boundary.volumeScale));
    return out;
  };
  return { step, visible, points, boundary };
}

describe("rising bubbles (#353)", () => {
  it("stay in the liquid, below the current surface, and inside the walls", () => {
    const surface = liquid();
    const { step, visible, boundary } = run(surface, 120);
    expect(visible().length).toBeGreaterThan(0);
    // Tilt the vessel: the surface turns, and bubbles follow its new up.
    surface.normal.set(1, 1, 0).normalize();
    for (let frame = 0; frame < 300; frame++) {
      step();
      for (const p of visible()) {
        expect(surface.wet(p)).toBe(true);
        for (const axis of [p.x, p.y, p.z])
          expect(Math.abs(axis)).toBeLessThanOrEqual(boundary.halfSize);
      }
    }
  });

  it("rise toward the surface over time", () => {
    const surface = liquid(0.3);
    const { step, points } = run(surface, 30);
    const attribute = points.geometry.getAttribute("position").array as Float32Array;
    const colour = points.geometry.getAttribute("color").array as Float32Array;
    const i = [...colour].findIndex((c, k) => k % 3 === 0 && c > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const before = attribute[i + 1]!;
    step();
    expect(colour[i]! === 0 || attribute[i + 1]! > before).toBe(true);
  });

  it("rest in an empty vessel, and hold still under reduced motion", () => {
    const dry = run(liquid(-10), 300);
    expect(dry.visible()).toHaveLength(0);
    const still = run(liquid(), 0, true);
    const before = [...(still.points.geometry.getAttribute("position").array as Float32Array)];
    for (let i = 0; i < 60; i++) still.step();
    expect([...(still.points.geometry.getAttribute("position").array as Float32Array)]).toEqual(
      before,
    );
  });

  it("are refused by contents that publish no liquid surface", async () => {
    await import("./cloud");
    await import("./filled-vessel");
    expect(() =>
      composeContained(
        {
          geometry,
          size: 1,
          environment: null,
          faceTexture: () => null as never,
          ownSurface: () => null as never,
        },
        { shell: "plasticShell", config: { opacity: 0.16, inset: 0.92, gloss: 1.6 } },
        { effect: "cloud", config: { colour: 0xffffff, density: 1, drift: 0 } },
        undefined,
        [{ effect: "risingBubbles", config }],
      ),
    ).toThrow(/needs contents that publish liquidSurface/);
  });

  it("release their geometry with their material", () => {
    const { points } = run(liquid(), 0);
    let released = false;
    points.geometry.addEventListener("dispose", () => (released = true));
    (points.material as THREE.Material).dispose();
    expect(released).toBe(true);
  });
});
