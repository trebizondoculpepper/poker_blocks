/**
 * A play's model phases and their configured steps (#658; doc/game-events.md, "Resolution order
 * for a play"). The coordinator (GameRun) owns the boundaries: placement, before score, scoring,
 * after score, settlement. What runs inside a mutable phase is a registered step, named in
 * configuration and dispatched uniformly: the coordinator never asks what a step is.
 *
 * The default order is the documented one: countdown deductions before scoring (a block reaching
 * zero is pending, not detonated), then after scoring reactions, then the pending detonations.
 * Each step's follow-up events are drained before the next step runs.
 */
import { Registry } from "../core/registry";
import type { GameEvent } from "../passives";
import { commitReactions, type AppliedReaction } from "../reactions";
import type { CommandTarget } from "../rule-commands";
import { deductCountdowns, detonateCountdowns } from "../trigger-countdown";

/** What a play's steps share while it resolves. */
export type PlayStepContext = {
  target: CommandTarget;
  /** The blocks this play placed, in placement order. */
  placed: ReadonlySet<string>;
  /** Countdowns that reached zero before scoring, in discovery order, waiting to detonate. */
  pending: string[];
  /** Reactions applied this play, for presentation. */
  reactions: AppliedReaction[];
};

/** A step runs against the working state and returns the gameplay events it caused. */
export type PlayStep = (context: PlayStepContext) => readonly GameEvent[];

export const playSteps = new Registry<PlayStep>("play step");

playSteps.register("countdown-deductions", (context) => {
  context.pending.push(...deductCountdowns(context.target, context.placed));
  return [];
});
playSteps.register("reactions", (context) => {
  const applied = commitReactions(context.target);
  context.reactions.push(...applied);
  return applied.map(({ blockId, from, to }) => ({
    type: "reaction.applied",
    blockId,
    reaction: { from, to },
  }));
});
playSteps.register("countdown-detonations", (context) =>
  detonateCountdowns(context.target, context.pending),
);

/** Which steps run in each mutable phase, in order. */
export type PlayPhases = { beforeScore: readonly string[]; afterScore: readonly string[] };

export const defaultPlayPhases: PlayPhases = {
  beforeScore: ["countdown-deductions"],
  afterScore: ["reactions", "countdown-detonations"],
};

/**
 * Problems with a phase configuration: an unregistered step, or one listed twice (a step's order
 * must be deterministic and complete). Empty when it is valid.
 */
export function validatePlayPhases(phases: PlayPhases): string[] {
  const listed = [...phases.beforeScore, ...phases.afterScore];
  const problems = listed
    .filter((name) => !playSteps.has(name))
    .map((name) => `unknown play step "${name}"`);
  const seen = new Set<string>();
  for (const name of listed) {
    if (seen.has(name)) problems.push(`play step "${name}" listed twice`);
    seen.add(name);
  }
  return problems;
}
