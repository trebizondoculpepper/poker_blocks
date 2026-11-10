import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { soundFamilies } from "../../audio/sfx-families";
import { soundEffects } from "../../audio/sfx-registry";

const room = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("listening room families (#244)", () => {
  it("groups by the registry's own data: it reads each entry's family and the magnitude families", () => {
    expect(room).toContain("effect.family");
    expect(room).toContain("soundFamilies");
  });

  it("never names a family, a magnitude family or a sound itself", () => {
    const names = [
      ...new Set(soundEffects.map(({ family }) => family)),
      ...Object.keys(soundFamilies),
      ...soundEffects.map(({ id }) => id),
    ];
    for (const name of names) expect(room, name).not.toContain(`"${name}"`);
  });
});
