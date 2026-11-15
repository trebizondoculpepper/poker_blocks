import { describe, expect, it } from "vite-plus/test";
import { refractionPresets } from "./crystal-refraction";
import { createLookupRipple, rippleUniforms } from "./lookup-ripple";
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
