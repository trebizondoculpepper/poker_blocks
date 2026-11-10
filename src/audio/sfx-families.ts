/**
 * Sound families (#235): related sounds registered as one family, from which a caller asks for
 * a variant by magnitude: `familySfx("score.magnitude", points)`. Families are data; the
 * resolver is generic and never names a family, score or material.
 *
 * Each family lists its variants in ascending order of the smallest magnitude (`from`) each
 * covers. A request resolves to the last variant whose `from` is at or below the magnitude, so
 * the top variant is open-ended, and +Infinity takes it. The rule for anything outside the
 * family is explicit: a magnitude below the first variant's `from`, or NaN, resolves to `null`
 * (no sound). `src/audio/sfx-families.test.ts` checks every family against it.
 */
import type { SoundEffectId } from "./sfx-registry";

export type SoundFamily = {
  /** When a variant of this family plays. */
  trigger: string;
  /** Ascending by `from`: each variant covers magnitudes from its `from` up to the next one's. */
  variants: readonly { from: number; id: SoundEffectId }[];
};

const families = {
  /**
   * One scoring line's points (#1): seven bands, each ten times the last, from 1–9 to a
   * million and over. A line that scores nothing is silent.
   */
  "score.magnitude": {
    trigger: "One scoring line is presented, lowest line first; the band follows its points",
    variants: [
      { from: 1, id: "score.magnitude.ones" },
      { from: 10, id: "score.magnitude.tens" },
      { from: 100, id: "score.magnitude.hundreds" },
      { from: 1_000, id: "score.magnitude.thousands" },
      { from: 10_000, id: "score.magnitude.ten_thousands" },
      { from: 100_000, id: "score.magnitude.hundred_thousands" },
      { from: 1_000_000, id: "score.magnitude.millions" },
    ],
  },
} as const satisfies Record<string, SoundFamily>;

/** Every registered family, by name. */
export const soundFamilies: Readonly<Record<SoundFamilyId, SoundFamily>> = families;

/** Names a caller may ask for. Using an unregistered family is a type error. */
export type SoundFamilyId = keyof typeof families;

/** The ids a family can resolve to, for callers that want the narrow type. */
export type FamilySfxId<Family extends SoundFamilyId> =
  (typeof families)[Family]["variants"][number]["id"];

/** The family's variant for `magnitude`, or null below the first variant or for NaN. */
export function familySfx<Family extends SoundFamilyId>(
  family: Family,
  magnitude: number,
): FamilySfxId<Family> | null {
  if (Number.isNaN(magnitude)) return null;
  let chosen: SoundEffectId | null = null;
  for (const variant of soundFamilies[family].variants) {
    if (magnitude < variant.from) break;
    chosen = variant.id;
  }
  return chosen as FamilySfxId<Family> | null;
}
