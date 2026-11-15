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
 * Where an action's material transitions sit: before or after its score was applied, by the
 * position of each transition fact relative to the dividing fact in the action's own committed
 * facts (captured in commit order). An action without the divider has only a before side.
 */
const scoreDivider = "score.totalApplied";
type Side = { slot: string; holds(at: number, divider: number): boolean };
const sides = {
  before: { slot: "preScoring", holds: (at, divider) => divider < 0 || at < divider },
  after: { slot: "postScoring", holds: (at, divider) => divider >= 0 && at > divider },
} satisfies Record<string, Side>;

/** A producer reserving `side`'s slot when the action has a transition on that side. */
function sideProducer(side: Side) {
  return {
    reserve(captured: unknown) {
      const types = (captured as CommittedCapture).factTypes;
      const divider = types.indexOf(scoreDivider);
      const occupied = types.some(
        (type, at) => transitionFacts.has(type) && side.holds(at, divider),
      );
      return occupied ? { slot: side.slot } : null;
    },
  };
}

/** Reserved while the trait is mounted: an action's transitions belong to its phase record. */
export const materialTransitionsProducers = Object.fromEntries(
  Object.entries(sides).map(([name, side]) => {
    const producer = `materialTransitions.${name}`;
    phaseProducers.register(producer, sideProducer(side));
    return [producer, side];
  }),
) as Record<string, Side>;

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
      const composed = Object.keys(materialTransitionsProducers).map((producer) =>
        services.composeProducer(producer),
      );
      const uncompose = () => composed.forEach((each) => each());
      const scope = visualEvents.createScope(null);
      // Fresh for each entry, so a new run's restarted event IDs are never taken for old ones.
      const shown = new Set<string>();
      const held = new Set<string>();
      const now = () => visualEvents.nowMs / unitMs;
      const stop = services.run.onCommitted((facts) => {
        // Each side's requests: before or after the action's score was applied (#1359 review).
        const divider = facts.map(({ type }) => type).indexOf(scoreDivider);
        const bySide = new Map<string, string[]>();
        for (const [at, { eventId, type, payload }] of facts.entries()) {
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
          const [producer] = Object.entries(materialTransitionsProducers).find(([, side]) =>
            side.holds(at, divider),
          )!;
          bySide.set(producer, [...(bySide.get(producer) ?? []), id]);
        }
        const key = actionPhase.latest;
        for (const producer of Object.keys(materialTransitionsProducers)) {
          const requests = bySide.get(producer) ?? [];
          const contribution = key && actionPhase.contributionFor(key, producer);
          if (!contribution) {
            // No phase record to join: they play at once.
            for (const request of requests)
              visualEvents.schedule(scope, {
                handler: materialTransitionHandler,
                payload: { request },
                dueUnits: now(),
              });
            continue;
          }
          if (!requests.length) {
            contribution.settleEmpty();
            continue;
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
        }
      });
      live.set(config, { stop, uncompose, scope, held });
    },
    exit({ services }, config) {
      release(config, services.visualEvents);
    },
  };
}
