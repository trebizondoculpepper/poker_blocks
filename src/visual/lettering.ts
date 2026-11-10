import "../assets/fonts/fonts.css";

/** Material-owned lettering; card artwork keeps its own fonts. */
export type Lettering = { font: string; fallback: string; weight: number };
export const defaultLettering: Lettering = { font: "Tinos", fallback: "serif", weight: 400 };
export function fontStack(lettering: Lettering): string {
  return `${JSON.stringify(lettering.font)}, ${lettering.fallback}`;
}

/** Await the actual font before baking text into a canvas texture. */
export async function loadLettering(lettering: Lettering, text: string): Promise<void> {
  await document.fonts.load(`${lettering.weight} 64px ${fontStack(lettering)}`, text);
}

export const graphemes = (text: string): string[] =>
  Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (s) => s.segment,
  );

/** Wrap explicit lines at word boundaries to the available width at the current font size. */
export function wrapText(
  g: Pick<CanvasRenderingContext2D, "measureText">,
  text: string,
  width: number,
): string[] {
  return text.split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.trim().split(/\s+/u)) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    return lines;
  });
}

/** Find a readable fit using measured widths and font metrics, preserving explicit breaks. */
export function fitText(
  g: CanvasRenderingContext2D,
  text: string,
  lettering: Lettering,
  extent = 208,
): { lines: string[]; size: number; lineHeight: number } {
  for (let size = 208; size >= 1; size--) {
    g.font = `${lettering.weight} ${size}px ${fontStack(lettering)}`;
    const lines = wrapText(g, text, extent);
    const lineHeight = size * 1.25;
    const fits = lines.every((line) => g.measureText(line).width <= extent);
    if (fits && lines.length * lineHeight <= extent) return { lines, size, lineHeight };
  }
  throw new Error("Text cannot fit on the block face");
}
