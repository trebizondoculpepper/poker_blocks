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

/** A card's rank above its suit, centred, in its suit's tone. */
export function cardFaceArt(identity: IdentityTrait): FaceArt {
  const tone: InkTone = identity.suit.color === "#bd3651" ? "red" : "black";
  return {
    seed: `${identity.rank}-${identity.suit.name}`,
    paint(g, pen) {
      g.fillStyle = pen(tone);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "bold 80px system-ui, sans-serif";
      g.fillText(identity.rank, 128, 100);
      g.font = "94px Georgia, serif";
      g.fillText(identity.suit.symbol, 128, 180);
    },
  };
}
