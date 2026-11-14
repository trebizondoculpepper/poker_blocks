import { describe, expect, it } from "vite-plus/test";
import { standardDeck, type CardBlock } from "./cards";
import { acquiredBonusLines, describeModifier } from "./acquired-bonus-inspection";
import { getMaterialDefinition, withMaterial } from "./materials";
import { acquiredBonusBreakdown } from "./modifier-registers";
import type { ScoringModifier } from "./scoring-modifier";
import { inspectBlock } from "./traits/inspectable";

const card = (
  registers: Record<string, ScoringModifier> = {},
  base = standardDeck[0]!,
): CardBlock =>
  Object.keys(registers).length
    ? { ...base, traits: { ...base.traits, modifiers: registers } }
    : base;

describe("acquired bonus inspection (#751)", () => {
  it("says an unmodified card has no acquired bonuses, never a zero-valued one", () => {
    expect(acquiredBonusLines(card())).toEqual(["No acquired bonuses"]);
    expect(acquiredBonusBreakdown(card()).rows).toEqual([]);
  });

  it("lists each non-neutral lifetime with its expiry, then the combination", () => {
    const lines = acquiredBonusLines(
      card({ run: { exponential: 1.2 }, stage: { additive: 4 }, round: { multiplicative: 2 } }),
    );
    expect(lines).toEqual([
      "Stage: +4 (until the stage ends)",
      "Round: ×2 (until the round ends)",
      "Run: ^1.2 (for the rest of the run)",
      "Combined acquired: +4 ×2 ^1.2",
    ]);
  });

  it("shows a hidden lower-priority bonus that the face label leaves out", () => {
    const lines = acquiredBonusLines(card({ round: { additive: 1 }, run: { exponential: 1.1 } }));
    expect(lines.at(-1)).toBe("Combined acquired: +1 ^1.1");
  });

  it("keeps base material values apart, and full precision", () => {
    expect(acquiredBonusLines(card(), { additive: 2, multiplicative: 1.2 })).toEqual([
      "Base: +2 ×1.2",
      "No acquired bonuses",
    ]);
    expect(describeModifier({ multiplicative: 1.23456789 })).toBe("×1.23456789");
    expect(describeModifier({ additive: -1 })).toBe("−1");
  });

  it("is composed into a card's inspection after its own description", () => {
    const definition = getMaterialDefinition("gold");
    const gold = withMaterial(standardDeck[0]!, definition);
    const lines = inspectBlock(card({ run: { additive: 3 } }, gold))!.split("\n");
    expect(lines[0]).toBe(gold.traits.inspectable!.inspect());
    expect(lines).toContain("Run: +3 (for the rest of the run)");
    if (definition.scoringModifier)
      expect(lines.some((line) => line.startsWith("Base: "))).toBe(true);
  });
});
