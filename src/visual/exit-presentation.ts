/**
 * Block exits (#439): the shared presentation lifecycle for a block leaving play, which the
 * per-material blast responses (#438) and the exit effects (#440–#444) build on. Nothing here
 * decides whether a block leaves: the model removes it first (destroyed, self-destructed,
 * nothingified), and only then does presentation play its exit.
 *
 * - **The snapshot.** The caller hands over what the block was and where (`ExitSnapshot`), taken
 *   before the model removed it, and the visual that showed it. From then on that visual is the
 *   exit's: no longer a gameplay entity, never hit-tested, owned and finally disposed here.
 * - **Composition.** An exit is a sequence of steps, run in order; each step runs its effects in
 *   parallel and ends when all of them have. Effects are registered handlers (`exitEffects`),
 *   keyed by name and configured as data, so a material's exit is a list on its definition.
 * - **Targets.** An effect acts on a registered target (`exitTargets`): the whole block, its
 *   shell, or its contents (a contained block's fluid or flame). A target with nothing in it
 *   gives the effect an empty list, never a special case.
 * - **Effect lifecycle.** An effect is updated until it reports it has finished, then never
 *   again; one still running at the step's cap (or on cancellation) is told to `finish`. Every
 *   effect is disposed exactly once, when its step ends.
 * - **Bounds.** Every step has a time cap (`maxSeconds`, default 2): an effect still running at
 *   the cap is finished there, so no exit lingers. Under reduced motion effects get the flag and
 *   should finish at once or soon; the cap still holds.
 * - **Cancellation and cleanup.** Cancelling an exit (its cell is reused, the scene leaves)
 *   finishes and disposes every effect at once. When an exit ends, by completion or cancellation,
 *   each effect's `dispose` releases what it made, the visual is removed from its parent, and the
 *   owner's `release` frees the visual's own resources. Disposing the presenter cancels them all.
 * - **Timing (#549).** Exits run on the one shared visual-event scheduler: each is a `block.exit`
 *   event whose effect handle is the exit's sequence, advanced on the presentation clock. Steps
 *   and their caps stay the exit's own lifecycle; there is no separate exit clock or frame loop.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import type { Cell } from "../traits/attachable";
import {
  unitMs,
  visualHandlers,
  type EffectHandle,
  type ScopeHandle,
  type VisualScheduler,
} from "../visual-events/scheduler";

/** What the block was and where, captured before the model removed it. */
export type ExitSnapshot = { blockId: string; cell?: Cell; material?: string };

/** The departing block's visual, split so effects can act on part of it. */
export type ExitVisual = {
  /** The whole block: what is detached and removed at the end. */
  root: THREE.Object3D;
  /** Its outer body (faces, edges, container). */
  shell: readonly THREE.Object3D[];
  /** What it contains (a fluid, a flame); empty for a solid block. */
  contents: readonly THREE.Object3D[];
  /** Frees the visual's own geometry, materials and textures (the owner's dispose). */
  release(): void;
};

export type ExitContext = {
  snapshot: ExitSnapshot;
  visual: ExitVisual;
  /** The objects this effect acts on, from its configured target. */
  targets: readonly THREE.Object3D[];
  reducedMotion: boolean;
  /**
   * Whether an object is part of the departing block itself, as it was handed over, rather than
   * something an effect added (a burst's particles, a crack overlay): so one effect never treats
   * another's output as the block (#512 review).
   */
  ownsObject: (object: THREE.Object3D) => boolean;
  /** Parts of the block this target leaves out even when nested inside it (#490 review). */
  excluded: readonly THREE.Object3D[];
};

/** One running effect. `update` returns false once it has finished. */
export type ExitEffectInstance = {
  update(delta: number): boolean;
  /** Jump to its end state (at the step's cap, or on cancellation). */
  finish(): void;
  /** Release everything it made. Called exactly once. */
  dispose(): void;
};

export type ExitEffect = (context: ExitContext, config: unknown) => ExitEffectInstance;
export const exitEffects = new Registry<ExitEffect>("exit effect");

/** Which parts of a block an effect acts on, by name. */
export const exitTargets = new Registry<(visual: ExitVisual) => readonly THREE.Object3D[]>(
  "exit target",
);
exitTargets.register("whole", (visual) => [visual.root]);
exitTargets.register("shell", (visual) => visual.shell);
exitTargets.register("contents", (visual) => visual.contents);
/**
 * What each target leaves out even when it is nested inside it (#490 review): the shell never
 * includes contents parented under it, and contents never include the shell. The whole block
 * leaves nothing out, even when its root is also its shell.
 */
export const exitTargetExclusions = new Registry<(visual: ExitVisual) => readonly THREE.Object3D[]>(
  "exit target exclusion",
);
exitTargetExclusions.register("whole", () => []);
exitTargetExclusions.register("shell", (visual) => visual.contents);
exitTargetExclusions.register("contents", (visual) => visual.shell);

export type ExitEffectConfig = { effect: string; target?: string; config?: unknown };
export type ExitStep = { effects: readonly ExitEffectConfig[]; maxSeconds?: number };
export type ExitSequence = { steps: readonly ExitStep[] };

const defaultStepSeconds = 2;

/** One block's exit in progress. */
class Exit {
  /** The sequence still to play, first to last, and the step now playing. */
  private remaining: ExitStep[];
  private current: ExitStep | undefined;
  private running: ExitEffectInstance[] = [];
  /** Effects of this step that have reported they are finished: never updated again. */
  private finished = new Set<ExitEffectInstance>();
  private elapsed = 0;
  done = false;

  readonly snapshot: ExitSnapshot;
  private readonly visual: ExitVisual;
  private readonly reducedMotion: () => boolean;
  /** Everything that made up the block when it was handed over. */
  private readonly own = new Set<THREE.Object3D>();

  constructor(
    snapshot: ExitSnapshot,
    visual: ExitVisual,
    sequence: ExitSequence,
    reducedMotion: () => boolean,
  ) {
    this.snapshot = snapshot;
    this.visual = visual;
    this.reducedMotion = reducedMotion;
    visual.root.traverse((object) => void this.own.add(object));
    this.remaining = [...sequence.steps];
    this.next();
  }

  private next(): void {
    this.running.forEach((effect) => effect.dispose());
    this.running = [];
    this.finished = new Set();
    this.elapsed = 0;
    this.current = this.remaining.shift();
    if (!this.current) return this.end();
    // Built one by one, so an effect that can't be made (#1035 review) releases those before it.
    for (const { effect, target = "whole", config } of this.current.effects) {
      try {
        this.running.push(
          exitEffects.get(effect)(
            {
              snapshot: this.snapshot,
              visual: this.visual,
              targets: exitTargets.get(target)(this.visual),
              excluded: exitTargetExclusions.get(target)(this.visual),
              reducedMotion: this.reducedMotion(),
              ownsObject: (object) => this.own.has(object),
            },
            config,
          ),
        );
      } catch (error) {
        this.cancel();
        throw error;
      }
    }
  }

  update(delta: number): void {
    if (this.done) return;
    this.elapsed += delta;
    const cap = this.current?.maxSeconds ?? defaultStepSeconds;
    for (const effect of this.running.filter((each) => !this.finished.has(each)))
      if (!effect.update(delta)) this.finished.add(effect);
    const unfinished = this.running.filter((each) => !this.finished.has(each));
    if (unfinished.length && this.elapsed < cap) return;
    // At the cap, anything still running jumps to its end; finished effects are left alone.
    unfinished.forEach((effect) => effect.finish());
    this.next();
  }

  cancel(): void {
    if (this.done) return;
    this.running.filter((each) => !this.finished.has(each)).forEach((effect) => effect.finish());
    this.running.forEach((effect) => effect.dispose());
    this.running = [];
    this.end();
  }

  private end(): void {
    this.done = true;
    this.visual.root.removeFromParent();
    this.visual.release();
  }
}

/** A block exit waiting for its scheduled start: the scheduler's payload holds only its id. */
type PendingExit = {
  snapshot: ExitSnapshot;
  visual: ExitVisual;
  sequence: ExitSequence;
  reducedMotion: () => boolean;
};

/** The exits waiting to start, as the scheduler's `blockExits` service (#549). */
export type BlockExitServices = {
  blockExits: { take(id: number): PendingExit | null };
};

/**
 * A block's exit on the shared scheduler (#549): its sequence becomes one effect handle, advanced
 * on the presentation clock from its due time. Cancelling the handle (the scope is cancelled, the
 * scene leaves, the scheduler's time limit) finishes and disposes its effects and releases the
 * visual, exactly once.
 */
visualHandlers.register("block.exit", (payload, context): "done" | EffectHandle => {
  const { id } = payload as { id: number };
  const pending = (context.services as BlockExitServices).blockExits.take(id);
  if (!pending) return "done";
  // An exit that can't start (an unknown effect) cancels itself, releasing its block and any
  // effects already made, then fails its scope.
  const exit = new Exit(pending.snapshot, pending.visual, pending.sequence, pending.reducedMotion);
  if (exit.done) return "done";
  let last = context.scheduledAtMs;
  return {
    update(nowMs) {
      exit.update(Math.max(0, (nowMs - last) / 1000));
      last = nowMs;
      return exit.done ? "finished" : "running";
    },
    cancel: () => exit.cancel(),
    // Already ended once finished or cancelled; this only guards a handle released otherwise.
    dispose: () => exit.cancel(),
  };
});

/**
 * Presents block exits on the shared visual-event scheduler (#549): each exit starts now, in a
 * sealed scope of its own, so exits overlap freely and a scope's completion is its exit's end.
 * Its owner exposes `blockExits` to the scheduler's services and disposes it on scene exit.
 *
 * An exit the scheduler can't admit, or that is cancelled before it starts, is released at once:
 * the block simply goes, with nothing left behind.
 */
export function createExitPresenter(
  events: VisualScheduler,
  reducedMotion: () => boolean = () => false,
) {
  let nextId = 0;
  const waiting = new Map<number, PendingExit>();
  /** Each exit's scope, with the block it is presenting, until it settles. */
  const scopes = new Map<ScopeHandle, ExitSnapshot>();
  return {
    blockExits: {
      take(id: number): PendingExit | null {
        const pending = waiting.get(id) ?? null;
        waiting.delete(id);
        return pending;
      },
    } satisfies BlockExitServices["blockExits"],
    /** Start a block's exit. Its visual is the exit's from now on. */
    start(snapshot: ExitSnapshot, visual: ExitVisual, sequence: ExitSequence): void {
      const id = ++nextId;
      waiting.set(id, { snapshot, visual, sequence, reducedMotion });
      const scope = events.createScope(null);
      const admitted = events.schedule(scope, {
        handler: "block.exit",
        payload: { id },
        dueUnits: events.nowMs / unitMs,
      });
      scopes.set(scope, snapshot);
      events.observe(scope, () => {
        scopes.delete(scope);
        const unstarted = waiting.get(id);
        if (!unstarted) return;
        waiting.delete(id);
        unstarted.visual.root.removeFromParent();
        unstarted.visual.release();
      });
      if (admitted.accepted) events.seal(scope);
      else events.cancel(scope);
    },
    /** End one block's exit now (its cell is reused), cleaning up everything. */
    cancel(blockId: string): void {
      for (const [scope, snapshot] of Array.from(scopes))
        if (snapshot.blockId === blockId) events.cancel(scope);
    },
    /** How many exits are still waiting or playing. */
    get active(): number {
      return scopes.size;
    },
    /** End every exit (the scene leaves). */
    dispose(): void {
      for (const scope of Array.from(scopes.keys())) events.cancel(scope);
    },
  };
}

export type ExitPresenter = ReturnType<typeof createExitPresenter>;

/**
 * The bounds of `targets` in the departing block's own space: measured in the root's local
 * coordinates, so neither its world scale nor its rotation changes them. Empty when the targets
 * hold no geometry (a solid block's contents).
 */
export function localBounds(visual: ExitVisual, targets: readonly THREE.Object3D[]): THREE.Box3 {
  visual.root.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(visual.root.matrixWorld).invert();
  const bounds = new THREE.Box3();
  const part = new THREE.Box3();
  for (const target of targets)
    target.traverse((child) => {
      const geometry = (child as THREE.Mesh).geometry;
      if (!geometry) return;
      geometry.computeBoundingBox();
      part
        .copy(geometry.boundingBox!)
        .applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, child.matrixWorld));
      bounds.union(part);
    });
  return bounds;
}

/** A departing block's size in its own space: the largest side of the whole block's bounds. */
export function localBlockSize(visual: ExitVisual): number {
  const bounds = localBounds(visual, [visual.root]);
  return bounds.isEmpty() ? 1 : Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
}
