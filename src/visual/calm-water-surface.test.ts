import { describe, expect, it } from "vite-plus/test";
import { refractionPresets } from "./crystal-refraction";
import { createLookupRipple, rippleGradient, rippleUniforms } from "./lookup-ripple";
import { applyOptics, opticsBackends, snapshotOptics } from "./optics-backends";

const control = (backend: string, name: string) =>
  opticsBackends.get(backend).controls!.find(({ key }) => key === name);

describe("Calm Water's surface ripple (#797)", () => {
  it("offers 0–0.08, defaulting to 0.015, only where a preset owns it", () => {
    expect(control("calmWater", "surfaceRippleStrength")).toMatchObject({ min: 0, max: 0.08 });
    expect(refractionPresets.get("calmWater").ripple.surface?.value).toBe(0.015);
    expect(control("refraction", "surfaceRippleStrength")).toBeUndefined();
  });

  it("gives a preset without one the zero-strength flat-facet baseline", () => {
    const ripple = createLookupRipple({ amplitude: 0, period: 10, scale: 2 });
    expect(rippleUniforms(ripple).rippleSurface.value).toBe(0);
  });

  it("matches the analytic gradient of its height field, and loops each period", () => {
    const ripple = createLookupRipple({ amplitude: 0.006, period: 8, scale: 1.6 });
    ripple.phase.value = 0.3;
    const at = [0.2, -0.1, 0.4] as const;
    const g = rippleGradient(at, ripple);
    // Finite differences of the height field along x agree with the analytic gradient's x.
    const height = (p: readonly [number, number, number]) => {
      // Integrate the gradient's definition back: h = Σ w sin(c t + q·d + s) / Σ w.
      const waves = [
        [[1.7, 0.9, 1.3], 0.4, 1, 1],
        [[-1.1, 2.3, 0.7], 2.1, 2, 0.5],
        [[-0.8, 1.4, -1.9], 1.3, 1, 1],
        [[2.1, -0.6, 1.2], 4.2, 2, 0.5],
      ] as const;
      const t = 2 * Math.PI * ripple.phase.value;
      return (
        waves.reduce(
          (sum, [d, seed, cycles, weight]) =>
            sum +
            weight * Math.sin(cycles * t + d.reduce((a, v, i) => a + v * p[i]! * 1.6, 0) + seed),
          0,
        ) / 3
      );
    };
    const e = 1e-5;
    for (let axis = 0; axis < 3; axis++) {
      const plus = [...at] as [number, number, number];
      const minus = [...at] as [number, number, number];
      plus[axis] += e;
      minus[axis] -= e;
      expect(g[axis]).toBeCloseTo((height(plus) - height(minus)) / (2 * e), 4);
    }
    const start = rippleGradient(at, { ...ripple, phase: { value: 0 } });
    const loop = rippleGradient(at, { ...ripple, phase: { value: 1 } });
    for (let axis = 0; axis < 3; axis++) expect(loop[axis]).toBeCloseTo(start[axis]!, 9);
  });

  it("round-trips its strength through Copy settings, independent of the lookup amplitude", () => {
    const before = snapshotOptics("calmWater");
    applyOptics({
      ...before,
      config: { ...before.config, surfaceRippleStrength: 0, rippleAmplitude: 0.006 },
    });
    expect(snapshotOptics("calmWater").config).toMatchObject({
      surfaceRippleStrength: 0,
      rippleAmplitude: 0.006,
    });
    applyOptics(before);
    expect(snapshotOptics("calmWater").config.surfaceRippleStrength).toBe(0.015);
  });
});
