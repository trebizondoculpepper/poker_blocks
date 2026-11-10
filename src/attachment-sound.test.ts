import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { attachmentSound, landingSounds } from "./attachment-sound";
import { soundEffects } from "./audio/sfx-registry";
import { standardDeck } from "./cards";
import { getMaterialDefinition, materialDefinitions, materialOf, withMaterial } from "./materials";

const registered = new Set(soundEffects.map(({ id }) => id));

describe("attachment sounds (#232)", () => {
  it("gives every material acoustics with a registered material attachment sound", () => {
    for (const material of materialDefinitions) {
      expect(material.acoustics.character, material.id).toBeTruthy();
      expect(Number.isFinite(material.acoustics.hardness), material.id).toBe(true);
      expect(registered.has(material.acoustics.attach), material.id).toBe(true);
      expect(material.acoustics.attach.startsWith("material.attach."), material.id).toBe(true);
    }
  });

  it("resolves every pair, in either order, to the softer material's registered sound", () => {
    for (const a of materialDefinitions)
      for (const b of materialDefinitions) {
        const sound = attachmentSound(a, b);
        expect(attachmentSound(b, a)).toBe(sound);
        expect(registered.has(sound)).toBe(true);
        const softer = a.acoustics.hardness <= b.acoustics.hardness ? a : b;
        if (a.acoustics.hardness !== b.acoustics.hardness)
          expect(sound).toBe(softer.acoustics.attach);
      }
  });

  it("orders every material by a distinct hardness, so no pair needs a tie-break", () => {
    const hardness = materialDefinitions.map(({ acoustics }) => acoustics.hardness);
    expect(new Set(hardness).size).toBe(hardness.length);
  });

  it("uses the softest neighbour a landed block meets, or the block alone on an empty table", () => {
    const [meat, steel, gold] = (["meat", "steel", "gold"] as const).map(getMaterialDefinition);
    const block = (id: string, definition: typeof steel) =>
      withMaterial({ ...standardDeck[0]!, id }, definition);
    const acousticsOf = (card: ReturnType<typeof block>) => getMaterialDefinition(materialOf(card));
    const landedSteel = { block: block("s", steel), cell: { x: 0, y: 0, z: 0 } };
    expect(landingSounds([landedSteel], [landedSteel], acousticsOf)).toEqual([
      steel.acoustics.attach,
    ]);
    const field = [
      landedSteel,
      { block: block("g", gold), cell: { x: 1, y: 0, z: 0 } },
      { block: block("m", meat), cell: { x: 0, y: 1, z: 0 } },
      { block: block("far", meat), cell: { x: 5, y: 5, z: 5 } },
    ];
    expect(landingSounds([landedSteel], field, acousticsOf)).toEqual([meat.acoustics.attach]);
  });

  it("never names a material or pair in the generic resolver", () => {
    const source = readFileSync(new URL("./attachment-sound.ts", import.meta.url), "utf8");
    for (const { id } of materialDefinitions) expect(source).not.toMatch(new RegExp(`"${id}"`));
    expect(source).not.toMatch(/material\.attach\.\w/);
  });

  it("keeps the game audible: each attachment sound plays the old attach sound until it has audio", () => {
    for (const { acoustics } of materialDefinitions) {
      const effect = soundEffects.find(({ id }) => id === acoustics.attach);
      expect(effect?.placeholder).toBe("card.attach");
    }
  });
});
