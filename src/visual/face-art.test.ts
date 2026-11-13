import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "../cards";
import { experimentalMaterials } from "../materials";
import { cardFaceArt } from "./face-art";

describe("shared face artwork", () => {
  it("a concealed card face (the Present, #568) prints nothing but keeps the card's seed", () => {
    const { identity } = standardDeck[0]!.traits;
    const fillText = vi.fn();
    const art = cardFaceArt(identity, { face: "concealed" });
    art.paint({ fillText } as unknown as CanvasRenderingContext2D, (tone) => tone);
    expect(fillText).not.toHaveBeenCalled();
    expect(art.seed).toBe(cardFaceArt(identity).seed);
    expect(experimentalMaterials.find(({ id }) => id === "giftWrap")!.cardFace).toBe("concealed");
  });

  it("preserves card seeds, fonts and ink, with rank and suit top-left, across the deck", () => {
    for (const {
      traits: { identity },
    } of standardDeck) {
      const calls: unknown[] = [];
      const g = {
        fillText: vi.fn((text, x, y) => calls.push([text, x, y, g.font, g.fillStyle])),
        font: "",
        fillStyle: "",
        textAlign: "",
        textBaseline: "",
      };
      const art = cardFaceArt(identity);
      art.paint(g as unknown as CanvasRenderingContext2D, (tone) => tone);
      expect(art.seed).toBe(`${identity.rank}-${identity.suit.name}`);
      expect(calls).toEqual([
        [
          identity.rank,
          256 * 0.08 + (256 * 0.36) / 2,
          256 * 0.08,
          "bold 77px system-ui, sans-serif",
          identity.suit.color === "#bd3651" ? "red" : "black",
        ],
        [
          identity.suit.symbol,
          256 * 0.08 + (256 * 0.36) / 2,
          256 * (0.08 + 0.3),
          "92px Georgia, serif",
          identity.suit.color === "#bd3651" ? "red" : "black",
        ],
      ]);
      expect(g.textAlign).toBe("center");
      expect(g.textBaseline).toBe("top");
    }
  });
  it("keeps the material builder independent of card identity and face-art kinds", () => {
    const source = readFileSync(new URL("./block-appearance.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/IdentityTrait|\.rank\b|\.suit\b|cardFaceArt|letterFaceArt/);
  });
});
