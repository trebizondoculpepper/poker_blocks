/**
 * Material transitions (#1167; doc/presentation-contracts.md, "Committed transition fact and
 * independent responses"): a committed `block.materialChanged` is shown as the block's old look
 * dissolving into its new one, in the committed action's own pre- or post-score presentation phase.
 * The model has already changed the card and the table already draws its new look; this only
 * presents the change.
 *
 * - **Registered handlers.** A transition is a registered handler, chosen by the action's own
 *   response, else the scene's default, else `perlinDissolve`, never by material.
 * - **Held, then played in its phase.** As soon as the table has redrawn the block (the first
 *   frame after commit), a ghost of the fact's captured `before` card is built, following the
 *   block's live cube, and paired with the cube's own look through the shared paired mask at its
 *   start: the old look shows, the new one is masked. It waits so until its action's phase opens,
 *   then dissolves: one block-local domain, complementary coverage, each look's declared adapters.
 *   A look the mask can't pair is reported and simply shows its new look.
 * - **Newest change wins.** A second committed change cancels the first at once (its ghost freed,
 *   the cube's materials restored) and starts from that change's own `before`, which is the
 *   previous committed target. No continuity solver, no stack of transitions.
 * - **Lifecycle.** A block removed or redrawn mid-transition ends it at once; scope cancellation
 *   (the scene leaving, the action's record ending) does the same. It owns only the ghost and the
 *   mask's clones. It never reads the run, mutates the model, draws session RNG or holds input.
 */
import * as THREE from "three";
import type { CardBlock } from "./cards";
import { Registry } from "./core/registry";
import type { RenderedBlock } from "./rendered-blocks";
import { createPairedMask } from "./visual/paired-mask";
import { unitsToMs, visualHandlers, type EffectHandle } from "./visual-events/scheduler";

/** A transition's tunable presentation settings, in game-time units (1/15 s). */
export type MaterialTransitionSettings = {
  /** Its dissolve (default 7.5 units, 0.5 s). */
  durationUnits?: number;
  /** Its reduced-motion crossfade (default 1.8 units, 0.12 s). */
  reducedDurationUnits?: number;
};

/** One captured transition request. */
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

/** A prepared transition: built and held at its start until played. */
export type PreparedTransition = {
  /** Keep following the block while held; false once it can no longer play (gone, redrawn). */
  hold(): boolean;
  /** Advance by `deltaMs` while playing; false once finished (and freed). */
  play(deltaMs: number): boolean;
  /** End it now, restoring the block's own look and freeing what it owns. Idempotent. */
  cancel(): void;
};

/** Prepare a transition for its block, or null when there is nothing to show. */
export type MaterialTransitionHandler = (
  request: MaterialTransitionRequest,
  host: Host,
) => PreparedTransition | null;

export const materialTransitionHandlers = new Registry<MaterialTransitionHandler>(
  "material transition",
);

/** The default handler's name, used when neither the action nor the scene chooses one. */
export const defaultMaterialTransition = "perlinDissolve";

materialTransitionHandlers.register(defaultMaterialTransition, (request, host) => {
  const target = host.block(request.blockId);
  const parent = target?.cube.parent;
  // Not on the table (in the hand, already gone): its new look simply shows.
  if (!target || !parent) return null;
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
  const units = reduced
    ? (request.settings.reducedDurationUnits ?? 1.8)
    : (request.settings.durationUnits ?? 7.5);
  const made = createPairedMask({
    mount,
    outgoing: { root: ghost.cube, maskAdapter: ghost.maskAdapter },
    incoming: { root: cube, maskAdapter: target.maskAdapter },
    // The mask's primitive takes seconds: converted here, at the presentation boundary.
    seconds: unitsToMs(units) / 1000,
    reduced,
  });
  let settled = false;
  const free = () => {
    if (settled) return;
    settled = true;
    if (made.ok) made.mask.cancel();
    mount.removeFromParent();
    host.release(ghost);
  };
  if (!made.ok) {
    host.diagnose(`material transition of ${request.blockId} not shown: ${made.diagnostic}`);
    free();
    return null;
  }
  const { mask } = made;
  // Still the block's own cube: removed or redrawn since, it can't play.
  const live = () => host.block(request.blockId)?.cube === cube;
  return {
    hold() {
      if (settled) return false;
      if (!live()) {
        free();
        return false;
      }
      follow();
      return true;
    },
    play(deltaMs) {
      if (settled || !this.hold()) return false;
      if (mask.update(deltaMs / 1000)) return true;
      // Finished: the mask has restored the cube's own look; the ghost goes.
      free();
      return false;
    },
    cancel: free,
  };
});

/**
 * Each request's state, by an opaque name: a captured card carries its traits' own functions,
 * which a scheduled payload may not hold, so payloads name the request and it stays here.
 */
type Entry = {
  request: MaterialTransitionRequest;
  handler: string;
  /** Undefined until first prepared; null once there turned out to be nothing to show. */
  prepared: PreparedTransition | null | undefined;
  started: boolean;
};
const entries = new Map<string, Entry>();
/** Each block's latest request: a newer one replaces it. */
const latestFor = new Map<string, string>();
let nextEntry = 0;

/** Hold a request for its scheduled events; the returned name goes in their payloads. */
export function captureTransition(request: MaterialTransitionRequest, handler: string): string {
  const id = `material-transition-${++nextEntry}`;
  const previous = latestFor.get(request.blockId);
  if (previous) forgetTransition(previous);
  latestFor.set(request.blockId, id);
  entries.set(id, { request, handler, prepared: undefined, started: false });
  return id;
}

/** End a request, wherever it is: held, playing or not yet prepared. Idempotent. */
export function forgetTransition(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  if (latestFor.get(entry.request.blockId) === id) latestFor.delete(entry.request.blockId);
  entry.prepared?.cancel();
}

/** Prepared once: nothing to show stays nothing, never retried into a late flip. */
const prepare = (entry: Entry, host: Host) => {
  if (entry.prepared === undefined)
    entry.prepared = materialTransitionHandlers.get(entry.handler)(entry.request, host);
  return entry.prepared;
};

const hostOf = (services: unknown) => (services as MaterialTransitionServices).materialTransitions;

/**
 * The hold: on the first frame after commit (the table has redrawn the block by then) the
 * transition is built at its start and follows the block until its phase plays it.
 */
export const materialTransitionHoldHandler = "material.transitionHold";
visualHandlers.register(
  materialTransitionHoldHandler,
  (payload, context): EffectHandle | "done" => {
    const id = (payload as { request: string }).request;
    const entry = entries.get(id);
    if (!entry || entry.started) return "done";
    if (!prepare(entry, hostOf(context.services))) return "done";
    return {
      update() {
        const current = entries.get(id);
        if (!current || current.started) return "finished";
        if (current.prepared?.hold()) return "running";
        forgetTransition(id);
        return "finished";
      },
      // The scene leaving: a transition not yet playing ends with its hold.
      cancel: () => {
        if (!entries.get(id)?.started) forgetTransition(id);
      },
      dispose: () => {},
    };
  },
);

/** The play: its action's phase has opened, so the held transition dissolves. */
export const materialTransitionHandler = "material.transition";
visualHandlers.register(materialTransitionHandler, (payload, context): EffectHandle | "done" => {
  const id = (payload as { request: string }).request;
  const entry = entries.get(id);
  if (!entry) return "done";
  entry.started = true;
  const prepared = prepare(entry, hostOf(context.services));
  if (!prepared) {
    forgetTransition(id);
    return "done";
  }
  let last: number | null = null;
  return {
    update(nowMs) {
      const delta = last === null ? 0 : nowMs - last;
      last = nowMs;
      if (prepared.play(delta)) return "running";
      forgetTransition(id);
      return "finished";
    },
    cancel: () => forgetTransition(id),
    dispose: () => forgetTransition(id),
  };
});
