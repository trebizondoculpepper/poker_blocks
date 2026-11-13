import { describe, expect, it } from "vite-plus/test";
import { applyOptics, opticsBackends, snapshotOptics, type OpticsControl } from "./optics-backends";
import { refractionPresets } from "./crystal-refraction";
import { createLookupRipple } from "./lookup-ripple";

const periodControl = (backend: string) =>
  opticsBackends.get(backend).controls!.find(({ key }) => key === "ripplePeriod") as Extract<
    OpticsControl,
    { min: number }
  >;

// The owner's schemaVersion 1 Calm Water fixture (doc/calm-water-refinements.md).
const ownerFixture = {
  schemaVersion: 1,
  backend: "calmWater",
  config: {
    rearStrength: 0.06,
    frontStrength: 0.02,
    magnify: 0.12,
    dispersion: 0.02,
    fresnelBase: 0.02,
    fresnelPower: 5,
    spectral: 0,
    reflection: 0.35,
    clarity: 0.9,
    rippleAmplitude: 0.006,
    ripplePeriod: 8,
    rippleScale: 2.1,
  },
};

describe("Calm Water's ripple period (#795)", () => {
  it("offers 0.5–8 s in half-second steps, defaulting to 8; other presets keep theirs", () => {
    expect(periodControl("calmWater")).toMatchObject({ min: 0.5, max: 8, step: 0.5, fallback: 8 });
    expect(periodControl("refraction")).toMatchObject({ min: 8, max: 12 });
  });

  it("loops once per period at both ends of its range, and holds under reduced motion", () => {
    for (const period of [0.5, 8]) {
      const ripple = createLookupRipple({
        amplitude: 0,
        period,
        scale: 1,
        periodBounds: { min: 0.5, max: 8, step: 0.5 },
      });
      ripple.advance({ delta: period / 4, reducedMotion: false });
      expect(ripple.phase.value).toBeCloseTo(0.25);
      ripple.advance({ delta: period, reducedMotion: true });
      expect(ripple.phase.value).toBeCloseTo(0.25);
    }
  });

  it("brings an old 10 s import to 8 s with a notice, and refuses nonsense", () => {
    const before = snapshotOptics("calmWater");
    expect(
      applyOptics({ ...ownerFixture, config: { ...ownerFixture.config, ripplePeriod: 10 } }),
    ).toEqual(["ripplePeriod 10 s adjusted to 8 s"]);
    expect(snapshotOptics("calmWater").config.ripplePeriod).toBe(8);
    // The clock runs at what the control shows.
    expect(refractionPresets.get("calmWater").ripple.period.value).toBe(8);
    for (const bad of [0, -1, Number.NaN, "8"])
      expect(() =>
        applyOptics({ ...ownerFixture, config: { ...ownerFixture.config, ripplePeriod: bad } }),
      ).toThrow();
    applyOptics(before);
  });

  it("round-trips the owner's fixture through Copy settings unchanged", () => {
    const before = snapshotOptics("calmWater");
    expect(applyOptics(ownerFixture)).toEqual([]);
    // Missing new values (#796's edgeOpacity) take Calm Water's documented defaults.
    expect(snapshotOptics("calmWater")).toEqual({
      ...ownerFixture,
      config: { ...ownerFixture.config, edgeOpacity: 0.08 },
    });
    applyOptics(before);
  });

  it("keeps each preset's period isolated", () => {
    const crystal = snapshotOptics("refraction");
    applyOptics({ ...ownerFixture, config: { ...ownerFixture.config, ripplePeriod: 0.5 } });
    expect(snapshotOptics("refraction")).toEqual(crystal);
    applyOptics({ schemaVersion: 1, backend: "calmWater", config: {} });
  });
});
