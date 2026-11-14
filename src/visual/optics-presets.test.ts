import { afterEach, describe, expect, it } from "vite-plus/test";
import { applyOptics, opticsBackends, snapshotOptics, type OpticsControl } from "./optics-backends";

const tunable = opticsBackends
  .names()
  .filter((name) => (opticsBackends.get(name).controls ?? []).length);
const restoreDefaults = () => {
  for (const name of tunable) applyOptics({ schemaVersion: 1, backend: name, config: {} });
};
afterEach(restoreDefaults);

/** A value for a control that differs from its default and is still valid. */
const changed = (control: OpticsControl): number | string =>
  "options" in control
    ? control.options.find((option) => option !== control.fallback)!
    : control.fallback === control.max
      ? control.min
      : control.max;

describe("copy settings: complete, versioned optics presets (#677)", () => {
  it("snapshots every control under its stable key, defaults included, with the schema and backend", () => {
    for (const name of tunable) {
      const preset = snapshotOptics(name);
      const controls = opticsBackends.get(name).controls!;
      expect(preset.schemaVersion).toBe(1);
      expect(preset.backend).toBe(name);
      expect(Object.keys(preset.config).sort()).toEqual(controls.map(({ key }) => key).sort());
      for (const control of controls) expect(preset.config[control.key]).toBe(control.fallback);
    }
  });

  it("round-trips every changed slider and dropdown through a reset", () => {
    for (const name of tunable) {
      for (const control of opticsBackends.get(name).controls!)
        (control.set as (value: number | string) => void)(changed(control));
      const copied = JSON.parse(JSON.stringify(snapshotOptics(name)));
      restoreDefaults();
      expect(snapshotOptics(name)).not.toEqual(copied);
      applyOptics(copied);
      expect(snapshotOptics(name)).toEqual(copied);
    }
  });

  it("gives a backend with nothing to tune a valid empty preset", () => {
    const plain = opticsBackends.names().filter((name) => !tunable.includes(name));
    expect(plain.length).toBeGreaterThan(0);
    for (const name of plain) {
      expect(snapshotOptics(name)).toEqual({ schemaVersion: 1, backend: name, config: {} });
      expect(() => applyOptics(snapshotOptics(name))).not.toThrow();
    }
  });

  it("refuses an invalid preset before changing anything", () => {
    const [name] = tunable;
    const before = snapshotOptics(name!);
    const [control] = opticsBackends.get(name!).controls!;
    const bad = [
      { schemaVersion: 2, backend: name, config: {} },
      { schemaVersion: 1, backend: "nope", config: {} },
      { schemaVersion: 1, backend: name, config: { notAField: 1 } },
      { schemaVersion: 1, backend: name, config: { [control!.key]: "out of range" } },
    ];
    for (const preset of bad) expect(() => applyOptics(preset)).toThrow();
    expect(snapshotOptics(name!)).toEqual(before);
  });

  it("uses distinct stable keys within each backend", () => {
    for (const name of tunable) {
      const keys = opticsBackends.get(name).controls!.map(({ key }) => key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("calm water keeps its own tuning (#675)", () => {
  it("changing every calm-water control leaves the crystal refraction preset untouched", () => {
    const crystal = snapshotOptics("refraction");
    const water = snapshotOptics("calmWater");
    for (const control of opticsBackends.get("calmWater").controls!)
      (control.set as (value: number | string) => void)(changed(control));
    expect(snapshotOptics("calmWater")).not.toEqual(water);
    expect(snapshotOptics("refraction")).toEqual(crystal);
  });

  it("starts gentle and colourless: a slow ripple, little colour split, no spectral rainbow", () => {
    const { config } = snapshotOptics("calmWater");
    expect(config.spectral).toBe(0);
    expect(config.dispersion).toBeLessThanOrEqual(0.03);
    expect(config.rippleAmplitude).toBeGreaterThan(0);
    expect(config.ripplePeriod).toBe(8);
    expect(Object.keys(config)).not.toContain("mapPattern");
  });
});
