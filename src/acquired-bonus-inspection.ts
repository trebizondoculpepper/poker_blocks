/**
 * What inspection says about a card's scoring bonuses (#751; doc/presentation-contracts.md,
 * "Acquired bonus artwork and inspection (#432, #751)"): its material's **Base** values when it
 * has any, each non-neutral **Stage**, **Round** and **Run** register with how long it lasts, and
 * the **Combined acquired** values, so a bonus hidden behind the face's compact label is still
 * shown. Numbers are full precision here (the face label is the compact one). It only reads the
 * model's pure queries; it never recomputes scoring.
 */
import { acquiredBonusBreakdown } from "./modifier-registers";
import type { CardBlock } from "./cards";
import type { ScoringModifier } from "./scoring-modifier";

/** `+2 ×1.5 ^1.3`, neutral parts left out. */
export function describeModifier({
  additive = 0,
  multiplicative = 1,
  exponential = 1,
}: ScoringModifier): string {
  return [
    ...(additive !== 0 ? [additive < 0 ? `−${-additive}` : `+${additive}`] : []),
    ...(multiplicative !== 1 ? [`×${multiplicative}`] : []),
    ...(exponential !== 1 ? [`^${exponential}`] : []),
  ].join(" ");
}

/** The lines inspection adds for a card, given its material's base modifier. */
export function acquiredBonusLines(card: CardBlock, base: ScoringModifier = {}): string[] {
  const { rows, combined } = acquiredBonusBreakdown(card);
  const baseText = describeModifier(base);
  return [
    ...(baseText ? [`Base: ${baseText}`] : []),
    ...(rows.length
      ? [
          ...rows.map(
            ({ label, expires, modifier }) =>
              `${label}: ${describeModifier(modifier)} (${expires})`,
          ),
          `Combined acquired: ${describeModifier(combined)}`,
        ]
      : ["No acquired bonuses"]),
  ];
}
