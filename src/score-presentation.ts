import type { LineScore } from "./scoring";

/** Score-magnitude sounds, from the 1–9 band upward; each band is ten times the last. */
export const magnitudeSfx = [
  "score.magnitude.ones",
  "score.magnitude.tens",
  "score.magnitude.hundreds",
  "score.magnitude.thousands",
  "score.magnitude.ten_thousands",
  "score.magnitude.hundred_thousands",
  "score.magnitude.millions",
] as const;

export type MagnitudeSfxId = (typeof magnitudeSfx)[number];

/** The sound for one line's points, or null for a line that scores nothing. */
export function magnitudeSfxFor(points: number): MagnitudeSfxId | null {
  if (!(points >= 1)) return null;
  const band = Math.floor(Math.log10(points) + 1e-9);
  return magnitudeSfx[Math.min(band, magnitudeSfx.length - 1)];
}

/** Lines that scored, lowest first; ties keep their scoring order. */
export function presentationOrder(lines: readonly LineScore[]): LineScore[] {
  return lines.filter(({ score }) => score > 0).sort((a, b) => a.score - b.score);
}
