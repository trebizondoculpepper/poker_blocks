import { describe, expect, it, vi } from "vite-plus/test";
import { ranks, standardDeck } from "../cards";
import { cardFaceArt } from "./face-art";
import { rankFaces, rankGlyph } from "./rank-faces";

/** What a face paints: the text of each fillText call, rank first. */
function painted(art: ReturnType<typeof cardFaceArt>): string[] {
  const fillText = vi.fn();
  const g = { fillText } as unknown as CanvasRenderingContext2D;
  art.paint(g, () => "#000");
  return fillText.mock.calls.map(([text]) => String(text));
}
const card = (rank: string) =>
  standardDeck.find(({ traits }) => traits.identity.rank === rank)!.traits.identity;

describe("rank glyph styles on card faces (#489)", () => {
  it("defines every rank's display, plain glyph equal to the rank", () => {
    for (const rank of ranks) expect(rankFaces.get(rank).glyph).toBe(rank);
  });

  it("draws today's artwork when the option is omitted", () => {
    for (const rank of ranks) expect(painted(cardFaceArt(card(rank)))[0]).toBe(rank);
  });

  it("underlines 6 and 9 with a combining low line, and only them", () => {
    const underlined = ranks.filter((rank) => rankGlyph(rank, "underlined") !== rank);
    expect(underlined).toEqual(["6", "9"]);
    expect(painted(cardFaceArt(card("6"), { rankStyle: "underlined" }))[0]).toBe("6̲");
    expect(painted(cardFaceArt(card("9"), { rankStyle: "underlined" }))[0]).toBe("9̲");
    expect(painted(cardFaceArt(card("8"), { rankStyle: "underlined" }))[0]).toBe("8");
  });

  it("falls back to the plain glyph for a style a rank doesn't carry", () => {
    expect(rankGlyph("6", "no-such-style")).toBe("6");
  });

  it("changes artwork only: the card's rank and the art's seed stay the same", () => {
    const identity = card("9");
    const plain = cardFaceArt(identity);
    const styled = cardFaceArt(identity, { rankStyle: "underlined" });
    expect(identity.rank).toBe("9");
    expect(styled.seed).toBe(plain.seed);
    // The suit is drawn as before.
    expect(painted(styled)[1]).toBe(painted(plain)[1]);
  });
});
