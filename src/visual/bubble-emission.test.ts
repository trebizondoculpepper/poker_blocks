import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useCosmeticRandom } from "./block-effects";
import {
  containedContents,
  createInteriorBoundary,
  type ContainedFrame,
  type ContentsHandler,
} from "./contained";
import "./full-volume";
import { risingBubbles, risingBubblesDefaults, type RisingBubblesConfig } from "./rising-bubbles";
import { createEffectTuning } from "./tunable-effects";

const geometry = new THREE.BoxGeometry(1, 1, 1);
const base: RisingBubblesConfig = {
  count: 40,
  frequency: 5,
  rise: 0.02,
  wobble: 0,
  size: 0.04,
  endSize: 0.12,
  rest: 0,
  colour: 0xffffff,
  opacity: 0.8,
};

let seed = 1;
const restores: (() => void)[] = [];
afterEach(() => restores.splice(0).forEach((restore) => restore()));

/** Bubbles in a full volume under `toWorld`, stepped at 60 frames a second. */
function pool(config: Partial<RisingBubblesConfig> = {}, toWorld = new THREE.Matrix4()) {
  seed = 1;
  restores.push(useCosmeticRandom(() => (seed = (seed * 16807) % 2147483647) / 2147483647));
  const boundary = createInteriorBoundary(geometry, 1, 1);
  const contents = (containedContents.get("fullVolume") as ContentsHandler)(boundary, {});
  const bubbles = risingBubbles.build(boundary, contents.capabilities, { ...base, ...config });
  const points = bubbles.meshes[0] as THREE.Points | undefined;
  let seconds = 0;
  const frame = (reducedMotion = false): ContainedFrame => ({
    seconds,
    delta: 1 / 60,
    first: false,
    rotation: new THREE.Quaternion().setFromRotationMatrix(toWorld),
    toWorld,
    reducedMotion,
  });
  const step = (frames: number, reducedMotion = false) => {
    for (let i = 0; i < frames; i++) {
      seconds += 1 / 60;
      contents.update?.(frame(reducedMotion));
      bubbles.update?.(frame(reducedMotion));
    }
  };
  const attribute = (name: string) =>
    Array.from(points!.geometry.getAttribute(name).array as Float32Array);
  const alive = () =>
    attribute("color").filter((_, i) => i % 3 === 0 && attribute("color")[i]! > 0).length;
  return { bubbles, points, step, attribute, alive, contents };
}

describe("bubble emission rate (#1232)", () => {
  it("emits none at zero frequency, building nothing at all", () => {
    expect(pool({ frequency: 0 }).bubbles.meshes).toEqual([]);
    expect(pool({ count: 0 }).bubbles.meshes).toEqual([]);
    expect(pool({ count: 0.5 }).bubbles.meshes).toEqual([]);
  });

  it("births at its rate, independent of a much larger pool", () => {
    const { step, alive } = pool({ frequency: 5, count: 40 });
    step(120);
    // Two seconds at five a second; slow risers, so none has reached the surface yet.
    expect(alive()).toBeGreaterThanOrEqual(9);
    expect(alive()).toBeLessThanOrEqual(11);
  });

  it("rounds a fractional pool down, never overrunning its arrays (#1304 review)", () => {
    const { step, alive } = pool({ frequency: 600, count: 2.5 });
    step(30);
    expect(alive()).toBe(2);
  });

  it("never has more alive than its pool, however high the rate", () => {
    const { step, alive } = pool({ frequency: 600, count: 8 });
    step(60);
    expect(alive()).toBe(8);
  });

  it("a low rate is low and a higher one higher, from the same pool", () => {
    const low = pool({ frequency: 1 });
    low.step(180);
    const high = pool({ frequency: 10 });
    high.step(180);
    expect(low.alive()).toBeLessThan(high.alive());
    expect(low.alive()).toBeGreaterThan(0);
  });
});

describe("bubble growth over the ascent (#1232)", () => {
  it("starts at its birth size and grows toward its surface size as it rises", () => {
    const { step, attribute } = pool({ frequency: 30, rise: 0.3 });
    step(2);
    const born = attribute("bubbleScale");
    const largest = Math.max(base.size, base.endSize!);
    expect(born[0]).toBeCloseTo(base.size / largest, 6);
    step(30);
    const later = attribute("bubbleScale");
    expect(later[0]!).toBeGreaterThan(born[0]!);
    for (const scale of later) {
      expect(scale).toBeGreaterThanOrEqual(base.size / largest - 1e-6);
      expect(scale).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("keeps a whole bubble at its largest inside the walls", () => {
    const { step, attribute } = pool({ frequency: 60, rise: 0.4, endSize: 0.2 });
    step(240);
    // Points space: the interior's half-width less half the largest bubble.
    const room = 0.5 - 0.2 / 2;
    const positions = attribute("position");
    const colours = attribute("color");
    for (let i = 0; i < positions.length; i += 3) {
      if (!colours[i]) continue;
      for (const axis of positions.slice(i, i + 3))
        expect(Math.abs(axis)).toBeLessThanOrEqual(room + 1e-6);
    }
  });

  it("in a turned, stretched block, grows along its world-up ascent and stays in bounds", () => {
    const toWorld = new THREE.Matrix4().compose(
      new THREE.Vector3(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0.2, -0.3)),
      new THREE.Vector3(1, 1.8, 0.7),
    );
    const { step, attribute } = pool({ frequency: 20, rise: 0.3 }, toWorld);
    step(180);
    const largest = Math.max(base.size, base.endSize!);
    const scales = attribute("bubbleScale");
    expect(Math.max(...scales)).toBeGreaterThan(base.size / largest + 0.05);
    for (const scale of scales) expect(scale).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("holds still under reduced motion: no births, moves or growth", () => {
    const { step, attribute } = pool({ frequency: 20, rise: 0.3 });
    step(30);
    const positions = attribute("position");
    const scales = attribute("bubbleScale");
    step(30, true);
    expect(attribute("position")).toEqual(positions);
    expect(attribute("bubbleScale")).toEqual(scales);
  });

  it("releases its geometry with its material", () => {
    const { points } = pool();
    const released = vi.fn();
    points!.geometry.addEventListener("dispose", released);
    (points!.material as THREE.Material).dispose();
    expect(released).toHaveBeenCalledOnce();
  });

  it("draws each bubble at its own size: the shader scales the point by its attribute", () => {
    const { points } = pool();
    const shader = {
      vertexShader: "uniform float size;\nvoid main() {\n\tgl_PointSize = size;\n}",
    };
    (points!.material as THREE.Material).onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain("attribute float bubbleScale;");
    expect(shader.vertexShader).toContain("gl_PointSize = size * bubbleScale;");
  });
});

describe("rising bubbles' tunable settings (#1232)", () => {
  it("exports every effective setting through the shared Copy Settings path", () => {
    const tuning = createEffectTuning({
      handle: "bench",
      effect: "risingBubbles",
      config: risingBubblesDefaults,
    });
    expect(tuning.set("frequency", 12)).toEqual([]);
    expect(tuning.set("endSize", 0.2)).toEqual([]);
    const { parameters } = tuning.settings();
    expect(parameters).toMatchObject({ frequency: 12, endSize: 0.2, count: 24, size: 0.05 });
    expect(Object.keys(parameters).sort()).toEqual(
      [
        "colour",
        "count",
        "endSize",
        "frequency",
        "opacity",
        "rest",
        "rise",
        "size",
        "wobble",
      ].sort(),
    );
    // Out of range is refused, changing nothing.
    expect(tuning.set("frequency", -1)).not.toEqual([]);
    expect((tuning.config() as RisingBubblesConfig).frequency).toBe(12);
  });
});
