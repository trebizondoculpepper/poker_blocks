import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vite-plus/test";
import { standardDeck } from "../cards";
import { cardFaceArt } from "./face-art";

describe("shared face artwork", () => {
  it("preserves card seeds, centred positions, fonts and ink across the deck", () => {
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
          128,
          100,
          "bold 80px system-ui, sans-serif",
          identity.suit.color === "#bd3651" ? "red" : "black",
        ],
        [
          identity.suit.symbol,
          128,
          180,
          "94px Georgia, serif",
          identity.suit.color === "#bd3651" ? "red" : "black",
        ],
      ]);
      expect(g.textAlign).toBe("center");
      expect(g.textBaseline).toBe("middle");
    }
  });
  it("keeps the material builder independent of card identity and face-art kinds", () => {
    const source = readFileSync(new URL("./block-appearance.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/IdentityTrait|\.rank\b|\.suit\b|cardFaceArt|letterFaceArt/);
  });
});
