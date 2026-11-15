/**
 * Resistance-feedback controller (#1174; doc/triggered-presentation.md, "Victim exit and survival
 * feedback are separate capabilities"). It hears committed facts and, for each one carrying a
 * captured `survivor` (today `block.resisted`), plays the survivor's definition-owned response
 * (`appearance.survive`, registered in src/visual/survivor-responses.ts) on that block's live
 * visual, in place, as the committed action's **post-scoring contribution** (doc/triggered-presentation
 * .md: finite victim scopes belong to the action's phase response), so it plays after the action's
 * placement has landed and its scoring has shown, and the action's completion accounts for it.
 *
 * - **Model first.** The block, its cell and its bonuses are already decided; the response owns
 *   additive visual channels only and is never an exit.
 * - **No special cases.** It never asks what material, trait or cause it is serving: it reads the
 *   captured survivor's declared response and dispatches each step by its registered name.
 * - **Explicit gaps.** A resistant look with no declared response, or a survivor with no mounted
 *   visual when its feedback comes due, is reported as a diagnostic and changes nothing; there is
 *   no invented fallback.
 * - **Once.** A duplicate delivery of the same action's fact plays nothing more; `dispose` cancels
 *   whatever is still playing once, restoring each visual, and ignores later facts.
 * - **Reduced motion** is resolved when the response starts; the responses end at once under it.
 */
import type * as THREE from "three";
import type { CardBlock } from "./cards";
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import { getMaterialDefinition, materialOf } from "./materials";
import { survivorResponses } from "./visual/survivor-responses";
import { factProducer, type PlacementPhase } from "./placement-phase";
import { phaseProducers } from "./visual-events/action-phases";
import { visualHandlers, type EffectHandle } from "./visual-events/scheduler";

/** Survivor feedback: an action whose fact set includes a resistance reserves post-scoring work. */
export const survivorProducer = "survivor";
phaseProducers.register(
  survivorProducer,
  factProducer({ fact: "block.resisted", slot: "postScoring" }),
);

type Pending = {
  survivors: readonly CardBlock[];
  mount: (blockId: string) => THREE.Object3D | null;
  reducedMotion: () => boolean;
  diagnose: (message: string) => void;
  /** The owning controller's set of running feedback, ended on its dispose (#1319). */
  running: Set<() => void>;
};

const pending = new Map<string, Pending>();
let nextFeedback = 0;

visualHandlers.register("survivor.feedback", (payload, context): "done" | EffectHandle => {
  const id = (payload as { feedback: string }).feedback;
  const entry = pending.get(id);
  pending.delete(id);
  if (!entry) return "done";
  const reduced = entry.reducedMotion();
  const effects = entry.survivors.flatMap((survivor) => {
    // Resolved now, after the action's placement landed: a newly placed survivor is mounted.
    const target = entry.mount(survivor.id);
    if (!target) {
      entry.diagnose(`survivor ${survivor.id} has no mounted visual: feedback skipped`);
      return [];
    }
    const steps = getMaterialDefinition(materialOf(survivor)).appearance.survive ?? [];
    return steps.map(({ response, config }) =>
      survivorResponses.get(response)(target, config, reduced),
    );
  });
  if (effects.length === 0) return "done";
  let last = context.scheduledAtMs;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    entry.running.delete(end);
    effects.forEach((effect) => {
      effect.finish();
      effect.dispose();
    });
  };
  entry.running.add(end);
  return {
    update(nowMs) {
      const delta = Math.max(0, nowMs - last) / 1000;
      last = nowMs;
      const running = effects.map((effect) => effect.update(delta)).some(Boolean);
      if (running) return "running";
      end();
      return "finished";
    },
    cancel: end,
    dispose: end,
  };
});

export function createResistanceFeedbackController(options: {
  source: {
    onCommitted(
      listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void,
    ): () => void;
  };
  /** The committed actions' phase records: created before this, so `latest` is this action. */
  phase: Pick<PlacementPhase, "latest" | "contributionFor">;
  /** The block's live visual, if it is mounted. */
  mount: (blockId: string) => THREE.Object3D | null;
  reducedMotion: () => boolean;
  diagnose?: (message: string) => void;
}) {
  const diagnose = options.diagnose ?? ((message: string) => console.warn(message));
  const seen = new Set<string>();
  const mine = new Set<string>();
  const running = new Set<() => void>();
  let disposed = false;
  const stop = options.source.onCommitted((facts, metadata) => {
    if (disposed) return;
    const survivors: CardBlock[] = [];
    for (const { payload } of facts) {
      const survivor = (payload as { survivor?: CardBlock }).survivor;
      if (!survivor) continue;
      const key = `${metadata.actionId}\u0000${survivor.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!getMaterialDefinition(materialOf(survivor)).appearance.survive) {
        diagnose(`${materialOf(survivor)} resists but declares no survivor response`);
        continue;
      }
      survivors.push(survivor);
    }
    const key = options.phase.latest;
    const contribution = key && options.phase.contributionFor(key, survivorProducer);
    if (!contribution) {
      if (survivors.length) diagnose("survivor feedback has no action reservation: skipped");
      return;
    }
    if (survivors.length === 0) {
      contribution.settleEmpty();
      return;
    }
    const id = `survivor-${++nextFeedback}`;
    pending.set(id, {
      survivors,
      mount: options.mount,
      reducedMotion: options.reducedMotion,
      diagnose,
      running,
    });
    mine.add(id);
    if (
      !contribution.bind({ handler: "survivor.feedback", payload: { feedback: id }, dueUnits: 0 })
    ) {
      pending.delete(id);
      diagnose("survivor feedback was not admitted");
    }
  });
  /**
   * The run was replaced: forget what was delivered and drop feedback not yet started. Playing
   * feedback is cancelled, restoring its visuals, with the action phases' own reset.
   */
  const reset = () => {
    mine.forEach((id) => pending.delete(id));
    mine.clear();
    seen.clear();
  };
  return {
    reset,
    /** Stop listening and end running feedback (restoring its visuals), once (#1319). */
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      reset();
      [...running].forEach((end) => end());
    },
  };
}

export type ResistanceFeedbackController = ReturnType<typeof createResistanceFeedbackController>;
