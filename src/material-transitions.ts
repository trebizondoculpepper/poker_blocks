/**
 * Material transitions (#1167; doc/presentation-contracts.md, "Committed transition fact and
 * independent responses"): a committed \`block.materialChanged\` is shown as the block's old look
 * dissolving into its new one. The model has already changed the card and the table already draws
 * its new look; this only presents the change.
 *
 * - **Registered handlers.** A transition is a registered handler, chosen by the action's own
 *   response, else the scene's default, else \`perlinDissolve\`, never by material.
 * - **Captured old look.** The outgoing look is built from the fact's captured \`before\` card, as a
 *   ghost that follows the block's live cube (same pose, every frame), paired with the cube's own
 *   look through the shared paired mask: one block-local domain, complementary coverage, each
 *   look's declared adapters. A look the mask can't pair is reported and simply shows its new look.
 * - **Newest change wins.** A second committed change cancels the first at once (its ghost freed,
 *   the cube's materials restored) and starts from that change's own \`before\`, which is the previous
 *   committed target. No continuity solver, no stack of transitions.
 * - **Lifecycle.** A block that is removed or redrawn mid-transition ends it at once; scope
 *   cancellation (the scene leaving) does the same. It owns only the ghost and the mask's clones.
 *   It never reads the run, mutates the model, draws session RNG or holds input.
 */
import * as THREE from "three";
import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import type { RenderedBlock } from "./rendered-blocks";
import { createPairedMask, type PairedMask } from "./visual/paired-mask";
import { visualHandlers, type EffectHandle } from "./visual-events/scheduler";

/** A transition's tunable presentation settings (doc defaults: 0.5 s, reduced motion 0.12 s). */
export type MaterialTransitionSettings = { seconds?: number; reducedSeconds?: number };

/** One captured transition request, as scheduled. */
export type MaterialTransitionRequest = {
  blockId: string;
  /** The card as it was before this change: the outgoing look. */
  before: CardBlock;
  settings: MaterialTransitionSettings;
};

/** What a transition reaches through the scheduler's services. */
export type MaterialTransitionServices = {
  materialTransitions: {
    /** The block's live table view, or null when it is not on the table. */
    block(blockId: string): RenderedBlock | null;
    /** A detached view of a captured card, owned by the caller until released. */
    detachedView(block: CardBlock): RenderedBlock;
    /** Free a detached view, once. */
    release(view: RenderedBlock): void;
    reducedMotion(): boolean;
    /** Where a look the mask can't pair is reported. */
    diagnose(message: string): void;
  };
};

type Host = MaterialTransitionServices["materialTransitions"];
export type MaterialTransitionHandler = (
  request: MaterialTransitionRequest,
  host: Host,
) => EffectHandle | "done";

export const materialTransitionHandlers = new Registry<MaterialTransitionHandler>(
  "material transition",
);

/** The default handler's name, used when neither the action nor the scene chooses one. */
export const defaultMaterialTransition = "perlinDissolve";

/** Each block's transition in progress, so a newer change replaces it. */
const running = new Map<string, () => void>();

materialTransitionHandlers.register(defaultMaterialTransition, (request, host) => {
  running.get(request.blockId)?.();
  const target = host.block(request.blockId);
  // Not on the table (in the hand, already gone): its new look simply shows.
  const parent = target?.cube.parent;
  if (!target || !parent) return "done";
  const { cube } = target;
  const ghost = host.detachedView(request.before);
  // A mount that follows the cube's pose, holding the ghost at the cube's own transform.
  const mount = new THREE.Group();
  parent.add(mount);
  const follow = () => {
    mount.position.copy(cube.position);
    mount.quaternion.copy(cube.quaternion);
    mount.scale.copy(cube.scale);
  };
  follow();
  ghost.cube.removeFromParent();
  ghost.cube.position.set(0, 0, 0);
  ghost.cube.quaternion.identity();
  ghost.cube.scale.set(1, 1, 1);
  mount.add(ghost.cube);
  const reduced = host.reducedMotion();
  const made = createPairedMask({
    mount,
    outgoing: { root: ghost.cube, maskAdapter: ghost.maskAdapter },
    incoming: { root: cube, maskAdapter: target.maskAdapter },
    seconds: reduced
      ? (request.settings.reducedSeconds ?? 0.12)
      : (request.settings.seconds ?? 0.5),
    reduced,
  });
  let settled = false;
  const settle = (end: (mask: PairedMask) => void, mask: PairedMask | null) => {
    if (settled) return;
    settled = true;
    if (running.get(request.blockId) === stop) running.delete(request.blockId);
    if (mask) end(mask);
    mount.removeFromParent();
    host.release(ghost);
  };
  if (!made.ok) {
    host.diagnose(`material transition of ${request.blockId} not shown: ${made.diagnostic}`);
    settled = true;
    mount.removeFromParent();
    host.release(ghost);
    return "done";
  }
  const { mask } = made;
  const stop = () => settle((each) => each.cancel(), mask);
  running.set(request.blockId, stop);
  let last: number | null = null;
  return {
    update(nowMs) {
      if (settled) return "finished";
      // Removed or redrawn since: the cube it masks is no longer the block's. It ends now.
      if (host.block(request.blockId)?.cube !== cube) {
        stop();
        return "finished";
      }
      const delta = last === null ? 0 : (nowMs - last) / 1000;
      last = nowMs;
      follow();
      if (mask.update(delta)) return "running";
      settle(() => {}, null);
      return "finished";
    },
    cancel: stop,
    dispose: stop,
  };
});

/**
 * Captured requests waiting to be shown. A captured card carries its traits' own functions, which
 * a scheduled payload may not hold, so the payload names the request and the request stays here,
 * as plain captured data, until its event dispatches or its owner forgets it.
 */
const captured = new Map<string, MaterialTransitionRequest>();
let nextCapture = 0;

/** Hold a request for its scheduled event; the returned name goes in the payload. */
export function captureTransition(request: MaterialTransitionRequest): string {
  const id = `material-transition-${++nextCapture}`;
  captured.set(id, request);
  return id;
}

/** Forget a request whose event will never dispatch (cancelled or refused). */
export function forgetTransition(id: string): void {
  captured.delete(id);
}

/** The scheduled transition: dispatched to the request's registered handler. */
export const materialTransitionHandler = "material.transition";
visualHandlers.register(materialTransitionHandler, (payload, context) => {
  const { handler, request: id } = payload as { handler: string; request: string };
  const request = captured.get(id);
  captured.delete(id);
  if (!request) return "done";
  const host = (context.services as MaterialTransitionServices).materialTransitions;
  return materialTransitionHandlers.get(handler)(request, host);
});
