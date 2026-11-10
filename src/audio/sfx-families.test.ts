import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { familySfx, soundFamilies, type SoundFamilyId } from "./sfx-families";
import { soundEffects } from "./sfx-registry";

const registered = new Set(soundEffects.map(({ id }) => id));
const names = Object.keys(soundFamilies) as SoundFamilyId[];

describe("sound families (#235)", () => {
  it("points every variant at a registered sound, in ascending order of magnitude", () => {
    for (const name of names) {
      const { variants } = soundFamilies[name];
      expect(variants.length, name).toBeGreaterThan(1);
      variants.forEach((variant, index) => {
        expect(registered.has(variant.id), variant.id).toBe(true);
        if (index > 0) expect(variant.from, name).toBeGreaterThan(variants[index - 1]!.from);
      });
    }
  });

  it("resolves each variant's own range, and follows the explicit rule outside the family", () => {
    for (const name of names) {
      const { variants } = soundFamilies[name];
      variants.forEach((variant, index) => {
        expect(familySfx(name, variant.from)).toBe(variant.id);
        const next = variants[index + 1];
        if (next) expect(familySfx(name, next.from - 1e-6)).toBe(variant.id);
      });
      // Below the first variant, or NaN: no sound. Above the top: the top variant.
      expect(familySfx(name, variants[0]!.from - 1)).toBeNull();
      expect(familySfx(name, Number.NaN)).toBeNull();
      expect(familySfx(name, Number.POSITIVE_INFINITY)).toBe(variants.at(-1)!.id);
    }
  });

  it("keeps the agreed score bands from #1 at their boundaries", () => {
    const bands: [number, string | null][] = [
      [0, null],
      [0.5, null],
      [1, "score.magnitude.ones"],
      [9, "score.magnitude.ones"],
      [10, "score.magnitude.tens"],
      [99, "score.magnitude.tens"],
      [100, "score.magnitude.hundreds"],
      [999, "score.magnitude.hundreds"],
      [1_000, "score.magnitude.thousands"],
      [9_999, "score.magnitude.thousands"],
      [10_000, "score.magnitude.ten_thousands"],
      [99_999, "score.magnitude.ten_thousands"],
      [100_000, "score.magnitude.hundred_thousands"],
      [999_999, "score.magnitude.hundred_thousands"],
      [1_000_000, "score.magnitude.millions"],
    ];
    for (const [points, id] of bands)
      expect(familySfx("score.magnitude", points), `${points}`).toBe(id);
  });

  it("never names a family or sound in the generic resolver", () => {
    const source = readFileSync(new URL("./sfx-families.ts", import.meta.url), "utf8");
    const resolver = source.slice(source.indexOf("export function familySfx"));
    for (const name of names) expect(resolver).not.toContain(`"${name}"`);
    expect(resolver).not.toMatch(/"score\.|"material\./);
  });
});
