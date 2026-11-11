import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { containedContents, createInteriorBoundary, type ContainedFrame } from "./contained";
import { rampColour } from "./contained-stars";
import { materialPools } from "../materials";
import "./contained-stars";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const config = () =>
  materialPools
    .get("registered")()
    .find(({ id }) => id === "magicLock")!.appearance.contents!.config;

function field(overrides: Partial<Record<string, unknown>> = {}) {
  const stars = containedContents.get("stars")(createInteriorBoundary(geometry, 1, 0.92), {
    ...(config() as object),
    ...overrides,
  });
  const points = stars.meshes[0] as THREE.Points;
  const attribute = (name: string) => points.geometry.getAttribute(name).array as Float32Array;
  let seconds = 0;
  const step = (rotation = new THREE.Quaternion(), reducedMotion = false, delta = 1 / 60) => {
    seconds += delta;
    const frame: ContainedFrame = { seconds, delta, first: false, rotation, reducedMotion };
    stars.update!(frame);
  };
  return { stars, step, positions: () => attribute("position"), colours: () => attribute("color") };
}

afterEach(() => vi.restoreAllMocks());

describe("Magic Lock's contained stars (#349)", () => {
  it("ages through white, cream, brown to black, in order", () => {
    const ramp = [0xffffff, 0xfff1cc, 0x8a5a2b, 0x000000].map((hex) => new THREE.Color(hex));
    const at = (f: number) => rampColour(ramp, f, new THREE.Color()).getHex();
    expect(at(0)).toBe(0xffffff);
    expect(at(1 / 3)).toBe(0xfff1cc);
    expect(at(2 / 3)).toBe(0x8a5a2b);
    expect(at(1)).toBe(0x000000);
  });

  it("keeps every star inside the interior, with room for its footprint, however long it runs", () => {
    const { step, positions } = field();
    const turning = new THREE.Quaternion();
    for (let frame = 0; frame < 2000; frame++) {
      turning.setFromAxisAngle(new THREE.Vector3(1, 0, 0), frame * 0.01);
      step(turning);
    }
    const half = 0.5 - (0.3 * 1) / 2;
    for (const value of positions()) expect(Math.abs(value)).toBeLessThanOrEqual(half + 1e-9);
  });

  it("drifts toward world down as the vessel turns, without piling up", () => {
    // Births and drift are cosmetic Math.random; seed it so the check is deterministic.
    let seed = 7;
    vi.spyOn(Math, "random").mockImplementation(
      () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
    );
    const { step, positions } = field({ drift: 0, gravity: 0.5 });
    const upsideDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    const meanY = () => {
      const p = positions();
      let sum = 0;
      for (let i = 1; i < p.length; i += 3) sum += p[i]!;
      return sum / (p.length / 3);
    };
    const before = meanY();
    // Turned over, world down is the vessel's own +y: the stars drift that way.
    for (let frame = 0; frame < 30; frame++) step(upsideDown);
    expect(meanY()).toBeGreaterThan(before);
  });

  it("holds a fixed population and is static under reduced motion", () => {
    const { step, positions, colours } = field();
    const count = positions().length / 3;
    for (let frame = 0; frame < 600; frame++) step();
    expect(positions().length / 3).toBe(count);
    // The first reduced frame stops the twinkle; from then on nothing changes.
    step(new THREE.Quaternion(), true);
    const p = [...positions()];
    const c = [...colours()];
    for (let frame = 0; frame < 30; frame++) step(new THREE.Quaternion(), true);
    expect([...positions()]).toEqual(p);
    expect([...colours()]).toEqual(c);
  });

  it("publishes no liquid surface and keeps each vessel's own stars", () => {
    const a = field();
    const b = field();
    expect(a.stars.capabilities).toEqual({});
    expect([...a.positions()]).not.toEqual([...b.positions()]);
  });

  it("costs little to update: 32 vessels of 36 stars (measured, see the doc)", () => {
    const vessels = Array.from({ length: 32 }, () => field());
    const frames = 300;
    const start = performance.now();
    for (let frame = 0; frame < frames; frame++) for (const vessel of vessels) vessel.step();
    const perFrame = (performance.now() - start) / frames;
    console.info(`[magic lock] 32 vessels, 36 stars each: ${perFrame.toFixed(3)} ms per frame`);
    expect(perFrame).toBeLessThan(5);
  });

  it("releases its own geometry when its material is disposed (#415 review)", () => {
    const { stars } = field();
    const points = stars.meshes[0] as THREE.Points;
    let released = false;
    points.geometry.addEventListener("dispose", () => (released = true));
    (points.material as THREE.Material).dispose();
    expect(released).toBe(true);
  });

  it("sizes stars to the same world width under orthographic and perspective cameras (#415 review)", () => {
    const { stars } = field();
    const points = stars.meshes[0] as THREE.Points;
    const material = points.material as THREE.PointsMaterial;
    material.map = new THREE.Texture(); // skip the canvas-drawn texture in a headless test
    // A DPR-2 display: 800 × 600 logical pixels, 1600 × 1200 in the drawing buffer. Three.js
    // multiplies point size by the pixel ratio itself, so sizing uses the logical height.
    const renderer = {
      getSize: (target: THREE.Vector2) => target.set(800, 600),
      getDrawingBufferSize: (target: THREE.Vector2) => target.set(1600, 1200),
      getPixelRatio: () => 2,
    } as unknown as THREE.WebGLRenderer;
    const ortho = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5);
    points.onBeforeRender(
      renderer,
      new THREE.Scene(),
      ortho,
      points.geometry,
      material,
      null as never,
    );
    // World width: 0.3 of the interior, times the field's own scale (the volume, 0.92 × 0.97);
    // at 600 px over 3 world units, that many world units times 200 px.
    const world = 0.3 * 0.92 * 0.97;
    expect(material.size).toBeCloseTo(world * (2 / 3) * 300, 6);
    const perspective = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);
    points.onBeforeRender(
      renderer,
      new THREE.Scene(),
      perspective,
      points.geometry,
      material,
      null as never,
    );
    expect(material.size).toBeCloseTo(world, 6);
  });
});
