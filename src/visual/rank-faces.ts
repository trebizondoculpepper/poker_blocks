/**
 * How each rank is printed on a card face (#489): its display definition. Every rank has its
 * plain glyph and may carry alternate glyphs under named styles; a face asks for a style and
 * gets the rank's own glyph for it, or the plain one. The canonical rank (matching, scoring,
 * saves) is never touched: this is artwork only.
 *
 * The first style is `underlined`: 6 and 9 carry a combining low line (U+0332), the owner's
 * Unicode experiment for telling them apart when a block is turned over.
 */
import { Registry } from "../core/registry";
import type { IdentityTrait } from "../cards";

export type RankFace = {
  rank: IdentityTrait["rank"];
  /** The glyph printed by default. */
  glyph: string;
  /** Alternate glyphs by style name; a style the rank doesn't carry falls back to `glyph`. */
  styles?: Readonly<Record<string, string>>;
};

/** Every rank's display definition, each with its own glyphs. */
export const rankFaceDefinitions: readonly RankFace[] = [
  { rank: "A", glyph: "A" },
  { rank: "2", glyph: "2" },
  { rank: "3", glyph: "3" },
  { rank: "4", glyph: "4" },
  { rank: "5", glyph: "5" },
  // The ambiguous pair: underlined, so a turned 6 never reads as a 9.
  { rank: "6", glyph: "6", styles: { underlined: "6̲" } },
  { rank: "7", glyph: "7" },
  { rank: "8", glyph: "8" },
  { rank: "9", glyph: "9", styles: { underlined: "9̲" } },
  { rank: "10", glyph: "10" },
  { rank: "J", glyph: "J" },
  { rank: "Q", glyph: "Q" },
  { rank: "K", glyph: "K" },
];

export const rankFaces = new Registry<RankFace>("rank face");
for (const definition of rankFaceDefinitions) rankFaces.register(definition.rank, definition);

/** The glyph a rank prints in `style` (its own alternate, or its plain glyph). */
export function rankGlyph(rank: IdentityTrait["rank"], style?: string): string {
  const face = rankFaces.get(rank);
  return (style && face.styles?.[style]) || face.glyph;
}
