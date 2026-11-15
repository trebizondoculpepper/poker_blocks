/**
 * Loss presentation for a hung picture (#1065; doc/line-goes-up.md, "Triggered attachment-release
 * effect"). When a committed action carries the stage's failure, this asks the registered
 * attachment-release effect to drop the picture, as that action's post-scoring contribution
 * chained after the graph's own plot update, so the final segment is drawn before it falls. It
 * decides only *when*; the effect owns the motion, and the impact cue goes to whoever listens.
 *
 * - **Committed facts only:** the reservation comes from the failure fact itself; nothing is
 *   inferred from state. The model's outcome never waits on it.
 * - **Once per showing:** repeated failure facts don't release it twice.
 * - **Disposal:** leaving forgets a release not yet started; one already running is the action
 *   phases' to cancel, which settles it once with no impact.
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
  target: ReleaseTarget;
  config?: AttachmentReleaseConfig;
  reducedMotion: () => boolean;
  /** The completion/impact cue, for a sound controller (#1080) to answer. */
  impact?: (cue: string) => void;
}) {
  let released = false;
  let pending: ReturnType<typeof requestAttachmentRelease> | null = null;
  const stop = options.source.onCommitted(() => {
    const key = options.phase.latest;
    const contribution = key && options.phase.contributionFor(key, pictureReleaseProducer);
    if (!contribution) return;
    if (released) {
      contribution.settleEmpty();
      return;
    }
    released = true;
    const description = requestAttachmentRelease(options.target, {
      config: options.config,
      reducedMotion: options.reducedMotion(),
      impact: (cue) => {
        pending = null;
        options.impact?.(cue);
      },
    });
    pending = description;
    if (!contribution.bind(description)) {
      dropAttachmentRelease(description);
      pending = null;
    }
  });
  return {
    dispose() {
      stop();
      if (pending) dropAttachmentRelease(pending);
      pending = null;
    },
  };
}
