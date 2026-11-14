import { describe, expect, it } from "vite-plus/test";
import { createLookupRipple, rippleBounds, rippleShift } from "./lookup-ripple";
import { createRefractionPreset, crystalRefractionSettings } from "./crystal-refraction";
import { crystalV3Environment } from "./crystal-v3";
import { getMaterialDefinition } from "../materials";
import { opticsBackends, withOpticsBackend } from "./optics-backends";

const points: [number, number, number][] = [
  [0, 0, 0],
  [0.5, 0.5, 0.5],
  [-0.5, 0.2, 0.5],
  [0.3, -0.5, -0.1],
];

/** Advance a ripple through the given frame gaps (seconds). */
const run = (ripple: ReturnType<typeof createLookupRipple>, deltas: number[]) => {
  for (const delta of deltas) ripple.advance({ delta, reducedMotion: false });
  return ripple.phase.value;
};

describe("the lookup ripple (#674)", () => {
  it("adds nothing at zero amplitude: the static baseline", () => {
    const ripple = createLookupRipple({ amplitude: 0, period: 10, scale: 2 });
    for (const phase of [0, 0.25, 0.7]) {
      ripple.phase.value = phase;
      for (const point of points)
        for (const axis of rippleShift(point, ripple)) expect(Math.abs(axis)).toBe(0);
    }
  });

  it("never shifts further than its amplitude, even at the largest settings", () => {
    const ripple = createLookupRipple({
      amplitude: rippleBounds.amplitude.max,
      period: 10,
      scale: rippleBounds.scale.max,
    });
    for (let step = 0; step < 100; step++) {
      ripple.phase.value = step / 100;
      for (const point of points)
        for (const axis of rippleShift(point, ripple))
          expect(Math.abs(axis)).toBeLessThanOrEqual(rippleBounds.amplitude.max + 1e-12);
    }
  });

  it("loops seamlessly: one full period comes back to where it started", () => {
    const ripple = createLookupRipple({ amplitude: 0.01, period: 10, scale: 2 });
    const start = points.map((point) => rippleShift(point, ripple));
    run(
      ripple,
      Array.from({ length: 600 }, () => 10 / 600),
    );
    const end = points.map((point) => rippleShift(point, ripple));
    end.flat().forEach((value, index) => expect(value).toBeCloseTo(start.flat()[index]!, 9));
  });

  it("follows elapsed time, not frames: irregular frame gaps give the same phase", () => {
    const regular = createLookupRipple({ amplitude: 0.01, period: 9, scale: 2 });
    const irregular = createLookupRipple({ amplitude: 0.01, period: 9, scale: 2 });
    run(
      regular,
      Array.from({ length: 135 }, () => 1 / 60),
    );
    run(irregular, [0.001, 0.5, 0.033, 1.2, 0.016, 0.5]);
    expect(irregular.phase.value).toBeCloseTo(regular.phase.value, 9);
  });

  it("holds still under reduced motion", () => {
    const ripple = createLookupRipple({ amplitude: 0.01, period: 10, scale: 2 });
    run(ripple, [1.5]);
    const held = ripple.phase.value;
    ripple.advance({ delta: 3, reducedMotion: true });
    expect(ripple.phase.value).toBe(held);
  });

  it("varies across the block, so the background drifts rather than the cube zooming", () => {
    const ripple = createLookupRipple({ amplitude: 0.01, period: 10, scale: 2 });
    ripple.phase.value = 0.3;
    const shifts = points.map((point) => rippleShift(point, ripple).join());
    expect(new Set(shifts).size).toBe(points.length);
  });

  it("changing the period mid-loop does not jump the phase", () => {
    const ripple = createLookupRipple({ amplitude: 0.01, period: 10, scale: 2 });
    run(ripple, [2.5]);
    const before = ripple.phase.value;
    ripple.period.value = 12;
    ripple.advance({ delta: 0, reducedMotion: false });
    expect(ripple.phase.value).toBe(before);
  });
});

describe("refraction presets keep their own settings (#674)", () => {
  it("never share tuning or ripple uniforms", () => {
    const make = () =>
      createRefractionPreset({
        settings: crystalRefractionSettings,
        ripple: { amplitude: 0, period: 10, scale: 2 },
        environment: crystalV3Environment,
      });
    const a = make();
    const b = make();
    a.tuning.clarity.value = 0.5;
    a.ripple.amplitude.value = 0.02;
    a.ripple.advance({ delta: 3, reducedMotion: false });
    expect(b.tuning.clarity.value).toBe(crystalRefractionSettings.clarity);
    expect(b.ripple.amplitude.value).toBe(0);
    expect(b.ripple.phase.value).toBe(0);
  });

  it("a backend's appearance names its preset on the rebuilt definition", () => {
    const definition = withOpticsBackend(getMaterialDefinition("prismatic"), "refraction");
    expect(definition.appearance.assembly).toBe(opticsBackends.get("refraction").assembly);
    expect(definition.appearance.refraction).toBe("crystal");
  });
});
