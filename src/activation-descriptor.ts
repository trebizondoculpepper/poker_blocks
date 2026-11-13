/**
 * The activation descriptor (#484): concise text for what an activation did, from its resolved
 * outcomes (#483) and nothing else, so it never rerolls, re-runs a rule or reads the model. A
 * definition composes `activationDescriptor` naming a registered descriptor and its
 * configuration (the default is `resolvedOutcomes`); the rack or field host asks for the text and
 * never asks which item it holds. Each outcome is formatted by the formatter registered for its
 * operation (a registered effect's name), one line per effective operation:
 *
 *   +6          an added score (a die's actual roll; Crossroads' effective bonus)
 *   ×2  ^1.2    a multiplier, a power
 *   +2 coins    coins, with their unit
 *   +1 passive  a granted passive; "Rack full" when the grant found no room
 *
 * An operation with no formatter that still changed the working value shows "a → b"; anything
 * else is left out rather than invented.
 */
import { Registry } from "./core/registry";
import type { ResolvedOutcome } from "./event-rules";
import type { RuleActivation } from "./passive-effects";

/** Formats one outcome as a short line, or null to leave it out (nothing happened worth saying). */
export type OutcomeFormatter = (outcome: ResolvedOutcome) => string | null;
export const outcomeFormatters = new Registry<OutcomeFormatter>("outcome formatter");

/** Up to two decimals, trailing zeros dropped: 6, 1.5, 3.08. */
export const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

const signed = (value: number) =>
  value < 0 ? `−${formatNumber(-value)}` : `+${formatNumber(value)}`;
const operand = ({ operand: value }: ResolvedOutcome) => value ?? 0;

for (const operation of ["add-block-value", "add-line-score"])
  outcomeFormatters.register(operation, (outcome) => signed(operand(outcome)));
for (const operation of [
  "multiply-block-value",
  "multiply-line-score",
  "multiply-line-score-by-query",
])
  outcomeFormatters.register(operation, (outcome) => `×${formatNumber(operand(outcome))}`);
outcomeFormatters.register("power-line-score", (outcome) => `^${formatNumber(operand(outcome))}`);
for (const operation of ["add-coins", "add-coins-per-selected"])
  outcomeFormatters.register(operation, (outcome) => {
    const coins = operand(outcome);
    return `${signed(coins)} ${Math.abs(coins) === 1 ? "coin" : "coins"}`;
  });
// A coin command's committed fact repeats the effect's own line: nothing more to say.
outcomeFormatters.register("add-coins.committed", () => null);
outcomeFormatters.register("grant-unowned-passive.committed", (outcome) =>
  operand(outcome) > 0 ? `+${operand(outcome)} passive` : "Rack full",
);

/** The fallback for an unformatted operation: its working value's change, if any. */
function fallback({ before, after }: ResolvedOutcome): string | null {
  return before !== undefined && after !== undefined && before !== after
    ? `${formatNumber(before)} → ${formatNumber(after)}`
    : null;
}

/** A registered descriptor: an activation's text, from its outcomes and serializable config. */
export type ActivationDescriptor = (activation: RuleActivation, config: unknown) => string;
export const activationDescriptors = new Registry<ActivationDescriptor>("activation descriptor");

// One line per effective operation, in the order they applied.
activationDescriptors.register("resolvedOutcomes", (activation) =>
  activation.outcomes
    .map((outcome) =>
      outcomeFormatters.has(outcome.operation)
        ? outcomeFormatters.get(outcome.operation)(outcome)
        : fallback(outcome),
    )
    .filter((line): line is string => line !== null)
    .join("\n"),
);

/** What a definition composes: a registered descriptor and its configuration. */
export type ActivationDescriptorConfig = { descriptor: string; config?: unknown };
export const defaultActivationDescriptor: ActivationDescriptorConfig = {
  descriptor: "resolvedOutcomes",
};

/** The text for an activation, as its source's composed descriptor writes it. */
export function describeActivation(
  activation: RuleActivation,
  composed: ActivationDescriptorConfig = defaultActivationDescriptor,
): string {
  return activationDescriptors.get(composed.descriptor)(activation, composed.config);
}

/**
 * A passive's activation text, by the descriptor its own definition composes: what a rack host
 * calls with the activation it is given, without asking which item it holds.
 */
export function describePassiveActivation(
  definition: { activationDescriptor?: ActivationDescriptorConfig },
  activation: RuleActivation,
): string {
  return describeActivation(
    activation,
    definition.activationDescriptor ?? defaultActivationDescriptor,
  );
}
