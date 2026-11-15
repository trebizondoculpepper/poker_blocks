/**
 * Loss presentation for a hung picture (#1065; doc/line-goes-up.md, "Triggered attachment-release
 * effect"). When a committed action carries the stage's failure, this asks the registered
 * attachment-release effect to drop the picture once that action's post-scoring plot update has
 * finished, so the final segment is drawn before it falls. The fall itself runs in this
 * controller's own room scope, outside the action's required barrier. It
 * decides only *when*; the effect owns the motion, and the impact cue goes to whoever listens.
 *
 * - **Committed facts only:** the reservation comes from the failure fact itself; nothing is
 *   inferred from state. The model's outcome never waits on it.
 * - **Once per showing:** repeated failure facts don't release it twice.
 * - **Disposal:** leaving cancels the fall's own scope (a running fall settles once, no impact)
 *   and forgets a start not yet reached.
 */
import type { CommittedMetadata } from "./command-codecs";
import type { EventEnvelope } from "./lifecycle/action";
import { factProducer, type PlacementPhase } from "./placement-phase";
import {
  dropAttachmentRelease,
  requestAttachmentRelease,
  type AttachmentReleaseConfig,
  type ReleaseTarget,
} from "./visual/attachment-release";
import { phaseProducers } from "./visual-events/action-phases";
import { unitMs, visualHandlers, type ScopeHandle } from "./visual-events/scheduler";

/**
 * The release's start, bound as the failing action's contribution: it opens after that action's
 * plot update and finishes at once, handing the fall to the controller's own room scope, so the
 * outcome never waits on the animation (#1065 review).
 */
const starts = new Map<string, () => void>();
let nextStart = 0;
visualHandlers.register("picture.releaseStart", (payload) => {
  const id = (payload as { start: string }).start;
  const start = starts.get(id);
  starts.delete(id);
  start?.();
  return "done";
});

type ReleaseScheduler = {
  createScope(parent: ScopeHandle | null): ScopeHandle;
  schedule(
    scope: ScopeHandle,
    description: { handler: string; payload?: unknown; dueUnits: number },
  ): { accepted: boolean };
  seal(scope: ScopeHandle): boolean;
  cancel(target: ScopeHandle): void;
  readonly nowMs: number;
};

/**
 * The release reserves post-scoring work on a stage failure, in the graph's own ordered chain
 * ("plot"), so it opens only after that action's plot update is terminal.
 */
export const pictureReleaseProducer = "pictureRelease";
phaseProducers.register(
  pictureReleaseProducer,
  factProducer({ fact: "stage.lost", slot: "postScoring", ordered: "plot" }),
);

export function createPictureReleaseController(options: {
  source: {
    onCommitted(
      listener: (facts: readonly EventEnvelope[], metadata: CommittedMetadata) => void,
    ): () => void;
  };
  phase: Pick<PlacementPhase, "latest" | "contributionFor">;
  /** The shared scheduler: the fall's own room scope lives here. */
  scheduler: ReleaseScheduler;
  target: ReleaseTarget;
  config?: AttachmentReleaseConfig;
  reducedMotion: () => boolean;
  /** The completion/impact cue, for a sound controller (#1080). */
  impact?: (cue: string) => void;
}) {
  let released = false;
  let disposed = false;
  let startId: string | null = null;
  let scope: ScopeHandle | null = null;
  let pending: ReturnType<typeof requestAttachmentRelease> | null = null;
  const fall = () => {
    if (disposed) return;
    const description = requestAttachmentRelease(options.target, {
      config: options.config,
      reducedMotion: options.reducedMotion(),
      impact: (cue) => {
        pending = null;
        if (!disposed) options.impact?.(cue);
      },
    });
    pending = description;
    scope = options.scheduler.createScope(null);
    const admitted = options.scheduler.schedule(scope, {
      ...description,
      dueUnits: options.scheduler.nowMs / unitMs,
    });
    if (!admitted.accepted) {
      dropAttachmentRelease(description);
      pending = null;
    }
    options.scheduler.seal(scope);
  };
  const stop = options.source.onCommitted(() => {
    const key = options.phase.latest;
    const contribution = key && options.phase.contributionFor(key, pictureReleaseProducer);
    if (!contribution) return;
    if (released || disposed) {
      contribution.settleEmpty();
      return;
    }
    released = true;
    const id = `release-start-${++nextStart}`;
    startId = id;
    starts.set(id, () => {
      startId = null;
      fall();
    });
    if (
      !contribution.bind({ handler: "picture.releaseStart", payload: { start: id }, dueUnits: 0 })
    ) {
      starts.delete(id);
      startId = null;
    }
  });
  return {
    /** Leaving: cancel a running fall once (no impact) and forget one not yet started. */
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      if (startId) starts.delete(startId);
      if (scope) options.scheduler.cancel(scope);
      if (pending) dropAttachmentRelease(pending);
      pending = null;
    },
  };
}
