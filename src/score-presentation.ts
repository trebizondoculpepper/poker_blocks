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
