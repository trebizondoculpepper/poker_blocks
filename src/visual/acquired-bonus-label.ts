/**
 * The compact acquired-bonus label printed on a card's face (#432): `+2`, `×6` or `^1.3`, from the
 * model's descriptor (`acquiredBonusDescriptor`). This only formats and paints it; the model owns
 * the arithmetic and which modifier wins (doc/presentation-contracts.md, "Acquired bonus artwork
 * and inspection (#432, #751)").
 */
import type { AcquiredBonusDescriptor } from "../modifier-registers";
import type { FacePen, InkTone } from "./face-art";
import { Registry } from "../core/registry";

/** Where the label sits on a face, as fractions of the face's width (configurable for audition). */
export type AcquiredBonusLayout = { inset: number; height: number };
export const acquiredBonusLayout: AcquiredBonusLayout = { inset: 0.08, height: 0.15 };

/**
 * A value with at most three fractional digits, trailing zeros trimmed; if that would round a
 * non-neutral value to neutral, as many significant digits as it takes to tell them apart.
 */
export function formatBonusValue(value: number, neutralValue: number): string {
  const trim = (text: string) => (text.includes(".") ? text.replace(/\.?0+$/, "") : text);
  const short = trim(value.toFixed(3));
  if (Number(short) !== neutralValue || value === neutralValue) return short;
  for (let digits = 4; digits <= 17; digits++) {
    const precise = trim(value.toPrecision(digits));
    if (Number(precise) !== neutralValue) return precise;
  }
  return String(value);
}

/** How one acquired-bonus operator prints: its neutral value and its label text. */
export type BonusOperator = { neutral: number; text(value: number): string };

/** Each operator the model's descriptor can name, registered with how it prints (#432). */
export const bonusOperators = new Registry<BonusOperator>("acquired bonus operator");
bonusOperators.register("exponent", {
  neutral: 1,
  text: (value) => `^${formatBonusValue(value, 1)}`,
});
bonusOperators.register("multiplier", {
  neutral: 1,
  text: (value) => `×${formatBonusValue(value, 1)}`,
});
bonusOperators.register("additive", {
  neutral: 0,
  text: (value) =>
    value < 0 ? `−${formatBonusValue(-value, 0)}` : `+${formatBonusValue(value, 0)}`,
});

/** The label's text: `+2`, `−1`, `×6`, `^1.3`. */
export function acquiredBonusText({ operator, value }: AcquiredBonusDescriptor): string {
  return bonusOperators.get(operator).text(value);
}

/** Paint the label bottom-right on a face canvas of `size` pixels, in the face's own ink. */
export function paintAcquiredBonus(
  g: CanvasRenderingContext2D,
  pen: FacePen,
  tone: InkTone,
  descriptor: AcquiredBonusDescriptor,
  size = 256,
  layout: AcquiredBonusLayout = acquiredBonusLayout,
): void {
  const inset = size * layout.inset;
  g.fillStyle = pen(tone);
  g.textAlign = "right";
  g.textBaseline = "bottom";
  g.font = `bold ${Math.round(size * layout.height)}px system-ui, sans-serif`;
  g.fillText(acquiredBonusText(descriptor), size - inset, size - inset);
}
