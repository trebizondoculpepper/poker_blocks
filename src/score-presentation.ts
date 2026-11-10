import { familySfx, soundFamilies, type FamilySfxId } from "./audio/sfx-families";

/** Score-magnitude sounds, from the 1–9 band upward: the `score.magnitude` family (#1, #235). */
export const magnitudeSfx = soundFamilies["score.magnitude"].variants.map(({ id }) => id);

export type MagnitudeSfxId = FamilySfxId<"score.magnitude">;

/** The sound for one line's points, or null for a line that scores nothing. */
export function magnitudeSfxFor(points: number): MagnitudeSfxId | null {
  return familySfx("score.magnitude", points);
}
