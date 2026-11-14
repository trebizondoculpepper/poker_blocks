import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { materialPools } from "../materials";
import { containedContents, createInteriorBoundary } from "./contained";
import "./fire-core";
import { flameDefaults } from "./fire-core";
import {
  copyEffectSettings,
  createEffectTuning,
  effectSettingsFormat,
  parseEffectSettings,
  serializeEffectSettings,
  tunableEffects,
  type EffectPreset,
} from "./tunable-effects";

/** Every registered material whose contents can be tuned, as a preset handle and its config. */
const tunablePresets = (): EffectPreset[] =>
  materialPools
    .get("registered")()
    .flatMap(({ id, appearance }) =>
      [appearance.contents ?? []]
        .flat()
        .filter(({ effect }) => tunableEffects.has(effect))
        .map(({ effect, config }) => ({ handle: id, effect, config })),
    );

const boundary = createInteriorBoundary(new THREE.BoxGeometry(1, 1, 1), 1, 0.97);

/** The real handler's uniforms for a configuration, as plain values. */
function uniformsFor(effect: string, config: unknown) {
  const { meshes } = containedContents.get(effect)(boundary, config);
  const material = meshes[0]!.material as THREE.ShaderMaterial;
  const plain = Object.fromEntries(
    Object.entries(material.uniforms)
      .filter(([name]) => !["time", "cameraLocal", "upLocal", "opacity"].includes(name))
      .map(([name, { value }]) => [
        name,
        value instanceof THREE.Color ? value.toArray() : (value as unknown),
      ]),
  );
  const result = {
    uniforms: plain,
    speed: material.userData.speed as number,
    box: meshes[0]!.geometry,
  };
  meshes.forEach((mesh) => mesh.material instanceof THREE.Material && mesh.material.dispose());
  return result;
}

const flame = (config: unknown = {}): EffectPreset => ({ handle: "test", effect: "flame", config });

describe("tunable effects (#1024)", () => {
  it("covers every production flame configuration within the flame's descriptors", () => {
    const presets = tunablePresets();
    expect(presets.length).toBeGreaterThanOrEqual(3);
    for (const preset of presets) expect(() => createEffectTuning(preset)).not.toThrow();
  });

  it("builds through the real handler exactly as the production configuration does", () => {
    for (const preset of tunablePresets()) {
      const tuned = uniformsFor(preset.effect, createEffectTuning(preset).config());
      const production = uniformsFor(preset.effect, preset.config);
      expect(tuned.uniforms).toEqual(production.uniforms);
      expect(tuned.speed).toBe(production.speed);
    }
  });

  it("takes each missing value from the effect's own defaults", () => {
    const tuning = createEffectTuning(flame({ brightness: 1.5, palette: { core: [1, 1, 1] } }));
    const values = tuning.values();
    expect(values.brightness).toBe(1.5);
    expect(values.coreRed).toBe(1);
    expect(values.emberRed).toBe(flameDefaults.palette.ember[0]);
    expect(values.baseOffset).toBe(flameDefaults.baseOffset);
  });

  it("applies a valid edit to its effective configuration and refuses an invalid one", () => {
    const tuning = createEffectTuning(flame());
    expect(tuning.set("brightness", 2)).toEqual([]);
    expect(uniformsFor("flame", tuning.config()).uniforms.intensity).toBeCloseTo(3.2 * 2);
    expect(tuning.set("brightness", 99)).toHaveLength(1);
    expect(tuning.set("glow", 1)).toEqual(['unknown parameter "glow"']);
    expect(tuning.values().brightness).toBe(2);
    expect(tuning.set("coreGreen", 0.1)).toEqual([]);
    expect(uniformsFor("flame", tuning.config()).uniforms.core).toEqual([
      flameDefaults.palette.core[0],
      0.1,
      flameDefaults.palette.core[2],
    ]);
    tuning.reset();
    expect(tuning.values()).toEqual(tuning.baseline());
  });

  it("never changes its preset, the production definition or another tuning", () => {
    const fire = tunablePresets().find(({ handle }) => handle === "aggressiveFlame")!;
    const before = structuredClone(fire.config);
    const a = createEffectTuning(fire);
    const b = createEffectTuning(fire);
    a.set("speed", 0.2);
    a.set("emberRed", 0);
    expect(fire.config).toEqual(before);
    expect(b.values()).toEqual(b.baseline());
    expect(a.preset.config).toEqual(before);
    expect(Object.isFrozen(a.preset.config)).toBe(true);
    // The config handed out is a fresh copy: changing it changes nothing in the tuning.
    (a.config() as { speed: number }).speed = 3;
    expect(a.values().speed).toBe(0.2);
    expect(flameDefaults.palette.ember[0]).toBe(0.5);
    expect(Object.isFrozen(flameDefaults.palette.ember)).toBe(true);
    expect(Object.isFrozen(flameDefaults)).toBe(true);
  });

  it("refuses a preset outside its descriptors rather than clamping it silently", () => {
    expect(() => createEffectTuning(flame({ haze: 4 }))).toThrow(/outside its descriptors/);
    expect(() => createEffectTuning({ handle: "x", effect: "nothing", config: {} })).toThrow();
  });
});

describe("Copy Settings (#1024)", () => {
  it("exports the effect, preset handle and every effective value, and nothing live", () => {
    const tuning = createEffectTuning({ handle: "aggressiveFlame", effect: "flame", config: {} });
    tuning.set("speed", 2);
    const settings = tuning.settings();
    expect(settings.format).toBe(effectSettingsFormat);
    expect(settings.version).toBe(1);
    expect(settings.effect).toBe("flame");
    expect(settings.preset).toBe("aggressiveFlame");
    expect(Object.keys(settings.parameters).sort()).toEqual(
      Object.keys(tunableEffects.get("flame").parameters).sort(),
    );
    expect(settings.parameters.speed).toBe(2);
    const text = serializeEffectSettings(settings);
    expect(JSON.parse(text)).toEqual(settings);
    expect(text).not.toMatch(/uniform|time|mesh/i);
  });

  it("round-trips: pasted settings applied to another tuning give the same configuration", () => {
    const a = createEffectTuning(flame());
    a.set("haze", 0.3);
    a.set("midBlue", 0.5);
    const parsed = parseEffectSettings(serializeEffectSettings(a.settings()));
    expect(parsed.problems).toEqual([]);
    const b = createEffectTuning(flame({ speed: 2 }));
    expect(b.apply(parsed.settings!)).toEqual([]);
    expect(b.config()).toEqual({ ...(a.config() as object), speed: 1 });
    expect(b.values()).toEqual(a.values());
  });

  it("keeps the preset's value for a parameter the record leaves out", () => {
    const tuning = createEffectTuning(flame({ speed: 2 }));
    const settings = { ...tuning.settings(), parameters: { haze: 0.5 } };
    expect(tuning.apply(settings)).toEqual([]);
    expect(tuning.values().speed).toBe(2);
    expect(tuning.values().haze).toBe(0.5);
  });

  it("reports what is wrong with pasted settings and applies none of them", () => {
    const tuning = createEffectTuning(flame());
    const good = tuning.settings();
    const text = (change: object) => JSON.stringify({ ...good, ...change });
    expect(parseEffectSettings("{").problems).toEqual(["not JSON"]);
    expect(parseEffectSettings(text({ format: "other" })).problems).toHaveLength(1);
    expect(parseEffectSettings(text({ version: 2 })).problems).toEqual(["unsupported version 2"]);
    expect(parseEffectSettings(text({ effect: "nothing" })).problems).toHaveLength(1);
    expect(parseEffectSettings('{"format":{"toString":null}}').problems).toHaveLength(1);
    const unknown = parseEffectSettings(text({ parameters: { ...good.parameters, glow: 1 } }));
    expect(unknown).toEqual({ settings: null, problems: ['unknown parameter "glow"'] });
    expect(parseEffectSettings(text({ parameters: { scale: 5 } })).problems).toHaveLength(1);
    tuning.set("speed", 2);
    expect(tuning.apply({ ...good, parameters: { speed: -1 } })).toHaveLength(1);
    expect(tuning.apply({ ...good, effect: "cloud" })).toHaveLength(1);
    expect(tuning.values().speed).toBe(2);
  });

  it("copies to the clipboard, or returns the text to select when it can't", async () => {
    const settings = createEffectTuning(flame()).settings();
    const written: string[] = [];
    expect(
      await copyEffectSettings(settings, { writeText: async (text) => void written.push(text) }),
    ).toEqual({ copied: true, text: written[0] });
    const refused = await copyEffectSettings(settings, {
      writeText: () => Promise.reject(new Error("denied")),
    });
    expect(refused).toEqual({ copied: false, text: written[0], reason: "denied" });
    const missing = await copyEffectSettings(settings, undefined);
    expect(missing.copied).toBe(false);
    expect(missing.text).toBe(written[0]);
  });
});
