/**
 * materialTransitions (#1167; doc/presentation-contracts.md, "Committed transition fact and
 * independent responses"): the visual response to a committed material transition, composed
 * beside (and independent of) `materialChangeSounds`.
 *
 * - **Its action's phase.** While mounted it composes a phase producer that reserves the
 *   committing action's pre-score slot for a transition committed before that action's score was
 *   applied, else its post-score slot: decided from the order of the action's own committed facts,
 *   never from a phase name. The action's transitions dissolve when that slot opens; an action
 *   with no phase record (none composed) plays them at once.
 * - **Held until then.** Each transition is held from the first frame after commit: the old look
 *   shows over the redrawn block, so the new look never flashes early.
 * - **Once, newest first.** Each committed fact is shown at most once (its event ID); a newer
 *   change to the same block replaces an older one; leaving the scene ends everything it started.
 *
 * Which transition: the action's own response, if its fact carries one, else this scene's
 * configured default, else `perlinDissolve`. It never reads live state or decides anything.
 */
import type { CardBlock } from "../cards";
import { Registry } from "../core/registry";
import type { EventEnvelope } from "../lifecycle/action";
import {
  captureTransition,
  defaultMaterialTransition,
  forgetTransition,
  materialTransitionHandler,
  materialTransitionHoldHandler,
  type MaterialTransitionSettings,
} from "../material-transitions";
import type { CommittedCapture, PlacementPhase } from "../placement-phase";
import type { SceneTraitBehaviour } from "../scenes";
import { phaseProducers } from "../visual-events/action-phases";
import { unitMs, visualHandlers, type ScopeHandle } from "../visual-events/scheduler";
import type { ShopExitScheduler } from "./shop-leave-response";

/** The scene's default transition and its settings (in game-time units). */
export type MaterialTransitionsConfig = MaterialTransitionSettings & { handler?: string };

type TransitionScheduler = Pick<ShopExitScheduler, "createScope" | "schedule" | "cancel" | "nowMs">;

/** What a committed transition fact carries that this reads. */
type TransitionFact = {
  blockId?: string;
  snapshots?: { before?: CardBlock };
  /** An action's own transition response, overriding the scene's. */
  materialTransition?: { handler: string; settings?: MaterialTransitionSettings };
};

/**
 * Committed facts that change a block's look as a material transition, by the fact they are: each
 * reads its block and captured old card, so the trait dispatches without asking what happened.
 */
export const transitionFacts = new Registry<(payload: unknown) => TransitionFact>(
  "material transition fact",
);
transitionFacts.register("block.materialChanged", (payload) => payload as TransitionFact);

/**
 * A producer reserving the slot before or after a dividing fact, by where the action's first
 * matching fact was committed relative to it (the action's facts are captured in commit order).
 */
function slotByOrder(config: {
  facts: () => readonly string[];
  divider: string;
  before: string;
  after: string;
}) {
  return {
    reserve(captured: unknown) {
      const types = (captured as CommittedCapture).factTypes;
      const found = config.facts().flatMap((fact) => [types.indexOf(fact)].filter((at) => at >= 0));
      if (!found.length) return null;
      const divider = types.indexOf(config.divider);
      return { slot: divider >= 0 && Math.min(...found) > divider ? config.after : config.before };
    },
  };
}

/** Reserved while the trait is mounted: an action's transitions belong to its phase record. */
export const materialTransitionsProducer = "materialTransitions";
phaseProducers.register(
  materialTransitionsProducer,
  slotByOrder({
    facts: () => transitionFacts.names(),
    divider: "score.totalApplied",
    before: "preScoring",
    after: "postScoring",
  }),
);

/** One action's transitions, played together when its slot opens. */
visualHandlers.register("material.transitions", (payload, context) => {
  for (const request of (payload as { requests: readonly string[] }).requests) {
    const admitted = context.schedule({
      handler: materialTransitionHandler,
      payload: { request },
      dueUnits: context.scheduledAtMs / unitMs,
    });
    if (!admitted.accepted) forgetTransition(request);
  }
  return "done";
});

export type MaterialTransitionTraitServices = {
  run: { onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void };
  visualEvents: TransitionScheduler;
  /** The committed action's phase record, to bind its transitions to. */
  actionPhase: Pick<PlacementPhase, "latest" | "contributionFor">;
  /** Compose this trait's producer into the action phases while it is mounted. */
  composeProducer(producer: string): () => void;
};

export function materialTransitions<
  Context extends { services: MaterialTransitionTraitServices },
>(): SceneTraitBehaviour<Context, MaterialTransitionsConfig> {
  const live = new WeakMap<
    object,
    { stop(): void; uncompose(): void; scope: ScopeHandle; held: Set<string> }
  >();
  const release = (config: object, visualEvents: TransitionScheduler) => {
    const entry = live.get(config);
    if (!entry) return;
    entry.stop();
    entry.uncompose();
    visualEvents.cancel(entry.scope);
    // Everything it started ends with it.
    for (const id of entry.held) forgetTransition(id);
    live.delete(config);
  };
  return {
    enter({ services }, config) {
      release(config, services.visualEvents);
      const { visualEvents, actionPhase } = services;
      const uncompose = services.composeProducer(materialTransitionsProducer);
      const scope = visualEvents.createScope(null);
      // Fresh for each entry, so a new run's restarted event IDs are never taken for old ones.
      const shown = new Set<string>();
      const held = new Set<string>();
      const now = () => visualEvents.nowMs / unitMs;
      const stop = services.run.onCommitted((facts) => {
        const requests: string[] = [];
        for (const { eventId, type, payload } of facts) {
          if (!transitionFacts.has(type)) continue;
          const fact = transitionFacts.get(type)(payload);
          const before = fact.snapshots?.before;
          if (!fact.blockId || !before || shown.has(eventId)) continue;
          shown.add(eventId);
          if (shown.size > 256) shown.delete(shown.values().next().value!);
          const own = fact.materialTransition;
          const id = captureTransition(
            { blockId: fact.blockId, before, settings: { ...config, ...own?.settings } },
            own?.handler ?? config.handler ?? defaultMaterialTransition,
          );
          held.add(id);
          if (held.size > 256) held.delete(held.values().next().value!);
          // Held from the first frame after commit, once the table has redrawn the block.
          const holding = visualEvents.schedule(scope, {
            handler: materialTransitionHoldHandler,
            payload: { request: id },
            dueUnits: now(),
          });
          if (!holding.accepted)
            console.warn(`a material transition was not held: ${holding.reason}`);
          requests.push(id);
        }
        const key = actionPhase.latest;
        const contribution = key && actionPhase.contributionFor(key, materialTransitionsProducer);
        if (!contribution) {
          // No phase record to join: they play at once.
          for (const request of requests)
            visualEvents.schedule(scope, {
              handler: materialTransitionHandler,
              payload: { request },
              dueUnits: now(),
            });
          return;
        }
        if (!requests.length) {
          contribution.settleEmpty();
          return;
        }
        const abandon = () => requests.forEach(forgetTransition);
        if (
          !contribution.bind({
            handler: "material.transitions",
            payload: { requests },
            dueUnits: 0,
          })
        )
          abandon();
        // Ended before playing (a new run, a cancelled record): nothing is left held.
        else contribution.observe(abandon);
      });
      live.set(config, { stop, uncompose, scope, held });
    },
    exit({ services }, config) {
      release(config, services.visualEvents);
    },
  };
}
