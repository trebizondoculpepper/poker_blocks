/**
 * Face artwork (#292, epic #291): what is printed on a block's faces, separate from the block's
 * geometry and material. The renderer (`block-appearance.ts`) never knows what the artwork is:
 * it asks the block's face art to paint itself, centred on a face, once for each layer it needs:
 *
 * - the **colour** print, in the material's ink;
 * - the **relief** stamp pressed into a material's height map (steel, wood, gold);
 * - the **skin** of see-through materials (fire, ice, crystal), drawn on front faces.
 *
 * Each layer passes a pen that turns an ink tone into a colour, so the art chooses a tone and the
 * material chooses the colour. The art's seed also seeds the material's noise (grain, cracks,
 * rivets), so a block looks the same every time it's drawn.
 */
import type { IdentityTrait } from "../cards";
import { Registry } from "../core/registry";
import { rankGlyph } from "./rank-faces";
import type { AcquiredBonusDescriptor } from "../modifier-registers";
import { paintAcquiredBonus } from "./acquired-bonus-label";

/** The ink tones artwork can ask for; each material's appearance gives each one a colour. */
export type InkTone = "red" | "black";

/** Turns an ink tone into the colour (or shade) the current layer paints with. */
export type FacePen = (tone: InkTone) => string;

export type FaceArt = {
  /** A stable string that seeds the material's noise for this block. */
  readonly seed: string;
  /** Paint the artwork centred on a 256px face canvas, in colours from the pen. */
  paint(g: CanvasRenderingContext2D, pen: FacePen): void;
};

export type CardFaceOptions = {
  /**
   * A rank glyph style (#489): each rank prints its own glyph for it where it has one
   * (`underlined` marks 6 and 9), its plain glyph otherwise. Omitted: the plain glyphs.
   */
  rankStyle?: string;
  /**
   * A registered card face (`cardFaces`): how the card shows its identity. A material chooses
   * it (`MaterialDefinition.cardFace`). Omitted: `rankAndSuit`.
   */
  face?: string;
  /**
   * The card's acquired bonus (#432), from `acquiredBonusDescriptor`: printed bottom-right over
   * whatever the card face paints, in its suit's tone. Omitted or null: no label.
   */
  bonus?: AcquiredBonusDescriptor | null;
};

/** Paints a card's identity on a face; registered by name in `cardFaces`. */
export type CardFace = (identity: IdentityTrait, options: CardFaceOptions) => FaceArt["paint"];

/**
 * How a card can show its identity (#568). `rankAndSuit` prints both; `concealed` prints
 * nothing, so the card's identity stays a surprise (the Present, #492). The card's seed is the
 * same either way, so its material's noise doesn't change.
 */
export const cardFaces = new Registry<CardFace>("card face");

/**
 * Where rank and suit sit (doc/presentation-contracts.md, "Acquired bonus artwork and inspection"):
 * top-left, at the same inset as the acquired-bonus label, which takes the bottom-right.
 */
export const rankAndSuitLayout = { inset: 0.08, rank: 0.3, suit: 0.36 };

/** A card's rank above its suit, top-left, in its suit's tone. */
cardFaces.register("rankAndSuit", (identity, options) => {
  const rank = rankGlyph(identity.rank, options.rankStyle);
  const tone: InkTone = identity.suit.tone;
  return (g, pen) => {
    const size = 256;
    const { inset, rank: rankHeight, suit: suitHeight } = rankAndSuitLayout;
    // Centred on one column, so a wide rank (10) and its suit stay aligned.
    const column = size * inset + (size * suitHeight) / 2;
    g.fillStyle = pen(tone);
    g.textAlign = "center";
    g.textBaseline = "top";
    g.font = `bold ${Math.round(size * rankHeight)}px system-ui, sans-serif`;
    g.fillText(rank, column, size * inset);
    g.font = `${Math.round(size * suitHeight)}px Georgia, serif`;
    g.fillText(identity.suit.symbol, column, size * (inset + rankHeight));
  };
});
cardFaces.register("concealed", () => () => {});

/** A card's face art, painted by its card face (rank above suit unless the options say otherwise). */
export function cardFaceArt(identity: IdentityTrait, options: CardFaceOptions = {}): FaceArt {
  const paint = cardFaces.get(options.face ?? "rankAndSuit")(identity, options);
  const bonus = options.bonus;
  return {
    seed: `${identity.rank}-${identity.suit.name}`,
    paint: bonus
      ? (g, pen) => {
          paint(g, pen);
          paintAcquiredBonus(g, pen, identity.suit.tone, bonus);
        }
      : paint,
  };
}
