import type { FaceArt } from "./face-art";
import { fitText, type Lettering } from "./lettering";

/** The same centred text provider works for print, relief and transparent face skins. */
export function textFaceArt(text: string, lettering: Lettering): FaceArt {
  return {
    seed: `text:${text}:${lettering.font}:${lettering.weight}`,
    paint(g, pen) {
      g.save();
      const { lines, lineHeight } = fitText(g, text, lettering);
      g.fillStyle = pen("black");
      g.textAlign = "center";
      g.textBaseline = "middle";
      lines.forEach((line, index) =>
        g.fillText(line, 128, 128 + (index - (lines.length - 1) / 2) * lineHeight),
      );
      g.restore();
    },
  };
}
