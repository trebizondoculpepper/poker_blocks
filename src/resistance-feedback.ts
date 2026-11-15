/**
 * Resistance-feedback controller (#1174; doc/triggered-presentation.md, "Victim exit and survival
 * feedback are separate capabilities"). It hears committed facts and, for each one carrying a
 * captured `survivor` (today `block.resisted`), plays the survivor's definition-owned response
 * (`appearance.survive`, registered in src/visual/survivor-responses.ts) on that block's live
 * visual, in place, through the one shared visual-event scheduler.
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
import {
  unitMs,
  visualHandlers,
  type EffectHandle,
  type ScopeHandle,
} from "./visual-events/scheduler";

type Pending = {
  survivor: CardBlock;
  mount: (blockId: string) => THREE.Object3D | null;
  reducedMotion: () => boolean;
  diagnose: (message: string) => void;
};

const pending = new Map<string, Pending>();
let nextFeedback = 0;

visualHandlers.register("survivor.feedback", (payload, context): "done" | EffectHandle => {
  const id = (payload as { feedback: string }).feedback;
  const entry = pending.get(id);
  if (!entry) return "done";
  const steps = getMaterialDefinition(materialOf(entry.survivor)).appearance.survive ?? [];
  const target = entry.mount(entry.survivor.id);
  if (!target) {
    pending.delete(id);
    entry.diagnose(`survivor ${entry.survivor.id} has no mounted visual: feedback skipped`);
    return "done";
  }
  const reduced = entry.reducedMotion();
  const effects = steps.map(({ response, config }) =>
    survivorResponses.get(response)(target, config, reduced),
  );
  let last = context.scheduledAtMs;
  const end = () => {
    if (!pending.delete(id)) return;
    effects.forEach((effect) => {
      effect.finish();
      effect.dispose();
    });
  };
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

type FeedbackScheduler = {
  readonly nowMs: number;
  createScope(parent: ScopeHandle | null): ScopeHandle;
  schedule(
    scope: ScopeHandle,
    description: { handler: string; payload?: unknown; dueUnits: number },
  ): { accepted: boolean };
  seal(scope: ScopeHandle): boolean;
  cancel(target: ScopeHandle): void;
};

export function createResistanceFeedbackController(options: {
  source: {
    onCommitted(
      listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void,
    ): () => void;
  };
  scheduler: FeedbackScheduler;
  /** The block's live visual, if it is mounted. */
  mount: (blockId: string) => THREE.Object3D | null;
  reducedMotion: () => boolean;
  diagnose?: (message: string) => void;
}) {
  const diagnose = options.diagnose ?? ((message: string) => console.warn(message));
  const seen = new Set<string>();
  const scopes = new Set<ScopeHandle>();
  const mine = new Set<string>();
  let disposed = false;
  const stop = options.source.onCommitted((facts, metadata) => {
    if (disposed) return;
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
      const id = `survivor-${++nextFeedback}`;
      pending.set(id, {
        survivor,
        mount: options.mount,
        reducedMotion: options.reducedMotion,
        diagnose,
      });
      mine.add(id);
      const scope = options.scheduler.createScope(null);
      scopes.add(scope);
      const admitted = options.scheduler.schedule(scope, {
        handler: "survivor.feedback",
        payload: { feedback: id },
        dueUnits: options.scheduler.nowMs / unitMs,
      });
      if (!admitted.accepted) {
        pending.delete(id);
        diagnose(`survivor ${survivor.id}'s feedback was not admitted`);
      }
      options.scheduler.seal(scope);
    }
  });
  /** Cancel whatever is still playing and forget what was delivered: the run was replaced. */
  const reset = () => {
    scopes.forEach((scope) => options.scheduler.cancel(scope));
    scopes.clear();
    mine.forEach((id) => pending.delete(id));
    mine.clear();
    seen.clear();
  };
  return {
    reset,
    /** Stop listening and cancel whatever is still playing, once. */
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      scopes.forEach((scope) => options.scheduler.cancel(scope));
      scopes.clear();
      // Anything never started is simply dropped.
      mine.forEach((id) => pending.delete(id));
      mine.clear();
    },
  };
}

export type ResistanceFeedbackController = ReturnType<typeof createResistanceFeedbackController>;
