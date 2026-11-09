/**
 * The `scoringModifier` trait (doc/game.md, "Material scoring", #141): three numbers a
 * definition carries, each expanded into an event rule on its own scoring phase. A material
 * configures it on its own definition; the scorer only ever sees the rules.
 *
 * Neutral values are additive 0, multiplicative 1 and exponential 1. A field left out adds no
 * rule, so a neutral material brings nothing to the scorer and reports no activation.
 */
import type { EventRule } from "./event-rules";

export type ScoringModifier = {
  /** Added to the card's base value (`score.beforeBlockValue`). */
  additive?: number;
  /** Multiplies its line's working score (`score.lineMultiply`). */
  multiplicative?: number;
  /** Raises its line's working score to this power (`score.linePower`). */
  exponential?: number;
};

/** Each field's rule: its phase and the handler that applies the value. */
const modifierRules: { [Field in keyof ScoringModifier]-?: (value: number) => EventRule } = {
  additive: (amount) => ({
    on: "score.beforeBlockValue",
    select: { id: "scored-block", config: {} },
    where: { id: "always", config: {} },
    effects: [{ id: "add-block-value", config: { amount } }],
  }),
  multiplicative: (factor) => ({
    on: "score.lineMultiply",
    select: { id: "scored-line", config: {} },
    where: { id: "always", config: {} },
    effects: [{ id: "multiply-line-score", config: { factor } }],
  }),
  exponential: (power) => ({
    on: "score.linePower",
    select: { id: "scored-line", config: {} },
    where: { id: "always", config: {} },
    effects: [{ id: "power-line-score", config: { power } }],
  }),
};

/** The event rules a scoring modifier brings, in field order. */
export function scoringModifierRules(modifier: ScoringModifier = {}): EventRule[] {
  return (Object.keys(modifier) as (keyof ScoringModifier)[]).map((field) =>
    modifierRules[field](modifier[field]!),
  );
}

/** Everything wrong with a scoring modifier's numbers (doc/game.md, "Balance config guardrails"). */
export function validateScoringModifier(owner: string, modifier: ScoringModifier = {}): string[] {
  const positive = (value: number | undefined) =>
    value === undefined || (Number.isFinite(value) && value > 0);
  return [
    ...(modifier.additive === undefined || Number.isFinite(modifier.additive)
      ? []
      : [`${owner}: additive must be a finite number`]),
    ...(positive(modifier.multiplicative) ? [] : [`${owner}: multiplicative must be positive`]),
    ...(positive(modifier.exponential) ? [] : [`${owner}: exponential must be positive`]),
  ];
}
