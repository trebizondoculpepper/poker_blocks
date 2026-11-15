/**
 * Placement presentation bound to committed action identities (#1219;
 * doc/action-presentation-phases.md, "One action record, reserved contributions"). Each committed
 * action opens its record in the shared action-phase registry (#1218) under the model's own
 * action ID, as the action is published; a registered producer configured with the fact that
 * marks a placement reserves that action's pre-scoring contribution there and then. The play
 * presenter binds its actual flight work to that reservation once the model call has returned,
 * rather than to a private scope keyed by a local counter.
 *
 * - **Configured, not identified.** The producer is a factory configured with the fact type and
 *   slot it reserves for; nothing here asks what kind of action or block it is.
 * - **Per-action outcome.** The record's pre-scoring status (finished, cancelled, failed) is the
 *   action's own pre-score completion; an action with nothing to place reserves nothing, so its
 *   pre-scoring completes empty.
 * - **Reset.** A presentation reset ends the registry's generation: every bound flight is
 *   cancelled once and later lookups for old actions are unavailable.
 */
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import {
  projectTriggered,
  triggeredProducer,
  triggeredWork,
  type TriggeredCapture,
} from "./triggered-presentation";
import {
  phaseProducers,
  type ActionKey,
  type ActionPhases,
  type Contribution,
} from "./visual-events/action-phases";

/**
 * What a committed action's record captures for producers: its facts' types, in order, and its
 * triggered presentation requests (#1172), captured now as plain data.
 */
export type CommittedCapture = { factTypes: readonly string[] } & TriggeredCapture;

/** A producer that reserves `slot` for any action whose facts include `fact`. */
export function factProducer(config: { fact: string; slot: string; ordered?: string }) {
  const reservation = config.ordered
    ? { slot: config.slot, ordered: config.ordered }
    : { slot: config.slot };
  return {
    reserve: (captured: unknown) =>
      (captured as CommittedCapture).factTypes.includes(config.fact) ? reservation : null,
  };
}

/** Placement: an action that placed blocks reserves its pre-scoring contribution. */
export const placementProducer = "placement";
phaseProducers.register(
  placementProducer,
  factProducer({ fact: "play.placed", slot: "preScoring" }),
);

/** Scoring (#1220): an action whose score total was applied reserves its scoring contribution. */
export const scoringProducer = "scoring";
phaseProducers.register(
  scoringProducer,
  factProducer({ fact: "score.totalApplied", slot: "scoring" }),
);

export type CommittedSource = {
  onCommitted(
    listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void,
  ): () => void;
};

/** Feed committed actions into the registry and hand the presenter its placement reservation. */
export function createPlacementPhase(source: CommittedSource, phases: ActionPhases) {
  let latest: ActionKey | null = null;
  const stop = source.onCommitted((facts, metadata) => {
    const triggered = projectTriggered(facts);
    const committed = phases.commit(metadata.actionId, {
      factTypes: facts.map(({ type }) => type),
      triggered,
    } satisfies CommittedCapture);
    latest = committed.ok ? committed.key : null;
    // Its triggered effects bind now, from the captured requests; they start when its
    // post-scoring phase opens (#1172).
    if (committed.ok)
      phases.contribution(committed.key, triggeredProducer)?.bind(triggeredWork(triggered));
  });
  return {
    /** The action that committed last, by its captured key; null after a reset. */
    get latest(): ActionKey | null {
      return latest;
    },
    /** The just-committed action's placement reservation, for the presenter to bind once. */
    contribution(): Contribution | null {
      return latest ? phases.contribution(latest, placementProducer) : null;
    },
    /** A producer's reservation for an action, or null (#1220). */
    contributionFor(key: ActionKey, producer: string): Contribution | null {
      return phases.contribution(key, producer);
    },
    /** Hear an action's full required root settle; null when it is unavailable (#1220). */
    observeAction(key: ActionKey, listener: () => void) {
      return phases.observe(key, null, listener);
    },
    /** An action's own pre-score completion, or unavailable. */
    preScoring(key: ActionKey) {
      return phases.status(key, "preScoring");
    },
    reset() {
      latest = null;
      phases.reset();
    },
    stop,
  };
}

export type PlacementPhase = ReturnType<typeof createPlacementPhase>;
