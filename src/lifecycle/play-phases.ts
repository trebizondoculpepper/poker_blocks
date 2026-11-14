/**
 * A play's model phases and their configured steps (#658; doc/game-events.md, "Resolution order
 * for a play"). The coordinator (GameRun) owns the boundaries: placement, before score, scoring,
 * after score, settlement. What runs inside a mutable phase is a registered step, named in
 * configuration and dispatched uniformly: the coordinator never asks what a step is.
 *
 * The game composes a materialEffectsController whose configuration gives the documented order:
 * placement-timed reactions (the Air/flame upgrade) and countdown deductions before scoring (a
 * block reaching zero is pending, not detonated), then after scoring the other reactions, then
 * the pending detonations.
 * Each step's follow-up events are drained before the next step runs.
 */
import { Registry } from "../core/registry";
import type { GameEvent } from "../passives";
import {
  commitReactions,
  materialReactions,
  reactionTiming,
  type AppliedReaction,
} from "../reactions";
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
/**
 * A reaction step: commits only the reactions whose definitions declare this timing (#614), so
 * each resolves once, in its documented phase. The step reads the timing as data; it never asks
 * which material reacts.
 */
const reactionStep =
  (timing: string): PlayStep =>
  (context) => {
    const applied = commitReactions(context.target, (block) =>
      materialReactions(block).filter((reaction) => reactionTiming(reaction) === timing),
    );
    context.reactions.push(...applied);
    return applied.map(({ blockId, ...reaction }) => ({
      type: "reaction.applied",
      blockId,
      reaction,
    }));
  };
// Explicitly placement-timed interactions, before scoring (the approved Air/flame upgrade).
playSteps.register("placement-reactions", reactionStep("placement"));
// Every other reaction, after scoring.
playSteps.register("reactions", reactionStep("afterScore"));
playSteps.register("countdown-detonations", (context) =>
  detonateCountdowns(context.target, context.pending),
);

/**
 * The late rack step (#988; doc/experiments/could-it-be-magic-now.md): once the post-score
 * reactions and detonations have drained, `play.afterReactions` is delivered once per committed
 * play to rack listeners, left to right, against the resulting field, before settlement.
 */
playSteps.register("passive-late", (context) => [
  { type: "play.afterReactions", cardIds: [...context.placed] },
]);

/** Which steps run in each mutable phase, in order. */
export type PlayPhases = { beforeScore: readonly string[]; afterScore: readonly string[] };

/** A model controller composed onto the playfield, by registered name, with its configuration. */
export type PlayfieldController = { id: string; config: unknown };

/**
 * Model controller traits for the playfield (doc/game-events.md, "Ownership and composition").
 * Attaching one returns the steps it subscribes to each phase. The coordinator only runs what the
 * composed controllers attached: without a composition there are no material steps at all.
 */
export const playfieldControllers = new Registry<(config: unknown) => PlayPhases>(
  "playfield controller",
);

/** Block-defined material behaviour, dispatched uniformly: its configuration names the steps. */
playfieldControllers.register("materialEffectsController", (config) => config as PlayPhases);

/** Rack listeners' late step, composed after the material steps it must follow. */
playfieldControllers.register("lateRackStepController", () => ({
  beforeScore: [],
  afterScore: ["passive-late"],
}));

const none: PlayPhases = { beforeScore: [], afterScore: [] };

/**
 * Attach the composed controllers, in composition order, and validate what they subscribe:
 * unknown controllers or steps, or a step attached twice, are errors at composition.
 */
export function attachPlayfield(controllers: readonly PlayfieldController[] = []): PlayPhases {
  const unknown = controllers
    .filter(({ id }) => !playfieldControllers.has(id))
    .map(({ id }) => `unknown playfield controller "${id}"`);
  if (unknown.length) throw new Error(`Invalid playfield: ${unknown.join("; ")}`);
  const phases = controllers.reduce<PlayPhases>((all, { id, config }) => {
    const own = playfieldControllers.get(id)(config);
    return {
      beforeScore: [...all.beforeScore, ...own.beforeScore],
      afterScore: [...all.afterScore, ...own.afterScore],
    };
  }, none);
  const problems = validatePlayPhases(phases);
  if (problems.length) throw new Error(`Invalid play phases: ${problems.join("; ")}`);
  return phases;
}

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
