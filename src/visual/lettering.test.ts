import { describe, expect, it, vi } from "vite-plus/test";
import { materialPools } from "../materials";
import { graphemes, fitText, loadLettering, defaultLettering } from "./lettering";
import { writingMaterial } from "../letter-block";

describe("block lettering", () => {
  it("recognises accented letters and joined emoji as single characters", () => {
    expect(graphemes("e\u0301👩‍🚀")).toHaveLength(2);
  });
  it("fits explicit lines and long labels inside both dimensions", () => {
    const g = {
      font: "",
      measureText(text: string) {
        return { width: text.length * parseFloat(this.font.split(" ")[1]!) * 0.7 };
      },
    };
    for (const text of ["OK", "Yes, really start a new game", "Cancel\nGo back", "x".repeat(150)]) {
      const result = fitText(g as CanvasRenderingContext2D, text, defaultLettering);
      expect(result.lines.length * result.lineHeight).toBeLessThanOrEqual(208);
      expect(result.lines.every((line) => g.measureText(line).width <= 208)).toBe(true);
    }
  });
  it("shrinks a single word instead of splitting it", () => {
    const g = {
      font: "",
      measureText(text: string) {
        return { width: text.length * parseFloat(this.font.split(" ")[1]!) * 0.7 };
      },
    };
    expect(fitText(g as CanvasRenderingContext2D, "Cancel", defaultLettering).lines).toEqual([
      "Cancel",
    ]);
  });
  it("includes every registered material with a default font", () => {
    const materials = materialPools.get("registered")();
    materials.forEach((definition, index) => {
      expect(definition.lettering?.font).toBeTruthy();
      expect(writingMaterial({ random: () => (index + 0.5) / materials.length })).toBe(definition);
    });
  });
  it("waits for fonts before they can be painted", async () => {
    const load = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("document", { fonts: { load } });
    try {
      await loadLettering(defaultLettering, "OK");
      expect(load).toHaveBeenCalledWith('400 64px "Tinos", serif', "OK");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
