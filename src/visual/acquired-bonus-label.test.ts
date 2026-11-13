import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "../cards";
import { acquiredBonusDescriptor } from "../modifier-registers";
import type { ScoringModifier } from "../scoring-modifier";
import { acquiredBonusText, formatBonusValue, paintAcquiredBonus } from "./acquired-bonus-label";
import { cardFaceArt } from "./face-art";

const card = (registers: Record<string, ScoringModifier> = {}): CardBlock => {
  const base = standardDeck[0]!;
  return Object.keys(registers).length
    ? { ...base, traits: { ...base.traits, modifiers: registers } }
    : base;
};

describe("acquired bonus descriptor (#432)", () => {
  it("is null for a card with no acquired bonus", () => {
    expect(acquiredBonusDescriptor(card())).toBeNull();
    expect(acquiredBonusDescriptor(card({ run: {} }))).toBeNull();
  });

  it("combines every lifetime first, then shows the highest priority", () => {
    expect(acquiredBonusDescriptor(card({ round: { additive: 1 }, run: { additive: 1 } }))).toEqual(
      { operator: "additive", value: 2 },
    );
    expect(
      acquiredBonusDescriptor(card({ stage: { multiplicative: 2 }, run: { multiplicative: 3 } })),
    ).toEqual({ operator: "multiplier", value: 6 });
    const power = acquiredBonusDescriptor(
      card({
        stage: { exponential: 1.1, additive: 4 },
        run: { exponential: 1.2, multiplicative: 2 },
      }),
    );
    expect(power?.operator).toBe("exponent");
    expect(power?.value).toBeCloseTo(1.3);
  });
});

describe("acquired bonus label (#432)", () => {
  it("prints +2, ×6 and ^1.3", () => {
    expect(acquiredBonusText({ operator: "additive", value: 2 })).toBe("+2");
    expect(acquiredBonusText({ operator: "additive", value: -1 })).toBe("−1");
    expect(acquiredBonusText({ operator: "multiplier", value: 6 })).toBe("×6");
    expect(acquiredBonusText({ operator: "exponent", value: 1.1 + 1.2 - 1 })).toBe("^1.3");
  });

  it("keeps at most three fractional digits, unless that would read as neutral", () => {
    expect(formatBonusValue(1.23456, 1)).toBe("1.235");
    expect(formatBonusValue(2.5, 1)).toBe("2.5");
    expect(formatBonusValue(1.00004, 1)).toBe("1.00004");
    expect(formatBonusValue(0.0002, 0)).toBe("0.0002");
  });

  it("paints bottom-right over the card's own face, and nothing extra without a bonus", () => {
    const calls: string[] = [];
    const g = {
      fillText: (text: string, x: number, y: number) => calls.push(`${text}@${x},${y}`),
      set fillStyle(_: string) {},
      set textAlign(value: string) {
        calls.push(`align:${value}`);
      },
      set textBaseline(_: string) {},
      set font(_: string) {},
    } as unknown as CanvasRenderingContext2D;
    const pen = () => "#000";
    const identity = card().traits.identity;
    cardFaceArt(identity).paint(g, pen);
    const plain = calls.length;
    calls.length = 0;
    cardFaceArt(identity, { bonus: { operator: "multiplier", value: 6 } }).paint(g, pen);
    expect(calls.length).toBeGreaterThan(plain);
    expect(calls.at(-1)).toBe(`×6@${256 - 256 * 0.08},${256 - 256 * 0.08}`);
    calls.length = 0;
    paintAcquiredBonus(g, pen, "red", { operator: "additive", value: 2 });
    expect(calls).toContain("align:right");
    // The seed, and so the material's noise, is the same with or without a label.
    expect(cardFaceArt(identity, { bonus: { operator: "additive", value: 1 } }).seed).toBe(
      cardFaceArt(identity).seed,
    );
  });
});
