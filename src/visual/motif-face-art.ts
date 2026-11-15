/**
 * Control face artwork: a readable fitted label with a code-native motif (#1147;
 * doc/shop-control-blocks.md, "Three configured controls, common presentation"). Motifs are
 * face-artwork configuration, not gameplay materials or imported models.
 *
 * A control's definition supplies its artwork as data, `{ label, motif: { handler, config } }`.
 * The provider draws the motif from the registered handler above the label, both in the pen's
 * colours, on every face the block's material paints. It never checks a label, control or
 * motif name to decide anything: a new motif is a new registered handler.
 */
import { Registry } from "../core/registry";
import type { FaceArt, FacePen } from "./face-art";
import { fitText, type Lettering } from "./lettering";

/** Draw a motif centred at (`x`, `y`), fitting a square of side `size`, on the 256px face. */
export type FaceMotif = (
  g: CanvasRenderingContext2D,
  pen: FacePen,
  area: { x: number; y: number; size: number },
  config: unknown,
) => void;

export const faceMotifs = new Registry<FaceMotif>("face motif");

export type MotifReference = { handler: string; config?: unknown };

/** A coin: a ring with an inner rim and a raised mark. */
export const coinMotif: FaceMotif = (g, pen, { x, y, size }) => {
  const r = size / 2;
  g.save();
  g.strokeStyle = pen("black");
  g.fillStyle = pen("black");
  g.lineWidth = Math.max(2, r * 0.14);
  g.beginPath();
  g.arc(x, y, r * 0.9, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = Math.max(1, r * 0.06);
  g.beginPath();
  g.arc(x, y, r * 0.66, 0, Math.PI * 2);
  g.stroke();
  // The mark: a small diamond, legible at any size.
  g.beginPath();
  g.moveTo(x, y - r * 0.38);
  g.lineTo(x + r * 0.26, y);
  g.lineTo(x, y + r * 0.38);
  g.lineTo(x - r * 0.26, y);
  g.closePath();
  g.fill();
  g.restore();
};

/** A dustbin: a lid with a handle over a tapered, ribbed body. */
export const dustbinMotif: FaceMotif = (g, pen, { x, y, size }) => {
  const s = size / 2;
  g.save();
  g.strokeStyle = pen("black");
  g.fillStyle = pen("black");
  g.lineWidth = Math.max(2, s * 0.1);
  g.lineJoin = "round";
  // Handle and lid.
  g.strokeRect(x - s * 0.18, y - s * 0.92, s * 0.36, s * 0.16);
  g.fillRect(x - s * 0.72, y - s * 0.76, s * 1.44, s * 0.16);
  // Body, narrower at the bottom.
  g.beginPath();
  g.moveTo(x - s * 0.6, y - s * 0.52);
  g.lineTo(x + s * 0.6, y - s * 0.52);
  g.lineTo(x + s * 0.46, y + s * 0.9);
  g.lineTo(x - s * 0.46, y + s * 0.9);
  g.closePath();
  g.stroke();
  // Ribs.
  for (const offset of [-0.24, 0, 0.24]) {
    g.beginPath();
    g.moveTo(x + s * offset, y - s * 0.34);
    g.lineTo(x + s * offset * 0.8, y + s * 0.72);
    g.stroke();
  }
  g.restore();
};

faceMotifs.register("coin", coinMotif);
faceMotifs.register("dustbin", dustbinMotif);

/** The face layout: the motif's square above, the label's box below (256px face). */
export const motifFaceLayout = {
  motif: { x: 128, y: 92, size: 112 },
  label: { centreY: 198, width: 208, height: 76 },
} as const;

/** A label with a registered motif above it: the same provider for any label and motif. */
export function labelledMotifFaceArt(
  label: string,
  motif: MotifReference,
  lettering: Lettering,
): FaceArt {
  const draw = faceMotifs.get(motif.handler);
  return {
    seed: `motif:${motif.handler}:${label}:${lettering.font}:${lettering.weight}`,
    paint(g, pen) {
      draw(g, pen, motifFaceLayout.motif, motif.config);
      g.save();
      const box = motifFaceLayout.label;
      const { lines, lineHeight } = fitText(g, label, lettering, box.width, box.height);
      g.fillStyle = pen("black");
      g.textAlign = "center";
      g.textBaseline = "middle";
      lines.forEach((line, index) =>
        g.fillText(line, 128, box.centreY + (index - (lines.length - 1) / 2) * lineHeight),
      );
      g.restore();
    },
  };
}

/** Artwork for a word cube's `artwork` option: its label with this motif above it. */
export const withMotif =
  (motif: MotifReference) =>
  (label: string, lettering: Lettering): FaceArt =>
    labelledMotifFaceArt(label, motif, lettering);
