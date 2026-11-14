import { describe, expect, it } from "vite-plus/test";
import { applyOptics, opticsBackends, snapshotOptics } from "./optics-backends";
import { refractionPresets } from "./crystal-refraction";

const keys = (backend: string) => opticsBackends.get(backend).controls!.map(({ key }) => key);

describe("Calm Water outline opacity (#796)", () => {
  it("is a Calm Water setting, 0–1, faint by default; other presets keep their edges", () => {
    const control = opticsBackends
      .get("calmWater")
      .controls!.find(({ key }) => key === "edgeOpacity");
    expect(control).toMatchObject({ min: 0, max: 1, fallback: 0.08 });
    expect(keys("refraction")).not.toContain("edgeOpacity");
    expect(refractionPresets.get("crystal").edgeOpacity).toBeUndefined();
  });

  it("is copied, imported (zero included) and defaulted when an old preset lacks it", () => {
    const before = snapshotOptics("calmWater");
    expect(before.config.edgeOpacity).toBe(0.08);
    applyOptics({ ...before, config: { ...before.config, edgeOpacity: 0 } });
    expect(refractionPresets.get("calmWater").edgeOpacity!.value).toBe(0);
    const { edgeOpacity: _old, ...legacy } = before.config;
    applyOptics({ ...before, config: legacy });
    expect(snapshotOptics("calmWater").config.edgeOpacity).toBe(0.08);
    expect(() =>
      applyOptics({ ...before, config: { ...before.config, edgeOpacity: 2 } }),
    ).toThrow();
  });
});
