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
 *   owner's `release` frees the visual's own resources. Disposing the runner cancels them all.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import type { Cell } from "../traits/attachable";

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
    this.running = this.current.effects.map(({ effect, target = "whole", config }) =>
      exitEffects.get(effect)(
        {
          snapshot: this.snapshot,
          visual: this.visual,
          targets: exitTargets.get(target)(this.visual),
          reducedMotion: this.reducedMotion(),
          ownsObject: (object) => this.own.has(object),
        },
        config,
      ),
    );
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

/** Runs every block exit in a scene; the scene updates it each frame and disposes it on exit. */
export function createExitRunner(reducedMotion: () => boolean = () => false) {
  let exits: Exit[] = [];
  return {
    /** Start a block's exit. Its visual is the exit's from now on. */
    start(snapshot: ExitSnapshot, visual: ExitVisual, sequence: ExitSequence): void {
      exits.push(new Exit(snapshot, visual, sequence, reducedMotion));
      exits = exits.filter(({ done }) => !done);
    },
    update(delta: number): void {
      exits.forEach((exit) => exit.update(delta));
      exits = exits.filter(({ done }) => !done);
    },
    /** End one block's exit now (its cell is reused), cleaning up everything. */
    cancel(blockId: string): void {
      exits.filter(({ snapshot }) => snapshot.blockId === blockId).forEach((exit) => exit.cancel());
      exits = exits.filter(({ done }) => !done);
    },
    /** How many exits are still playing. */
    get active(): number {
      return exits.length;
    },
    dispose(): void {
      exits.forEach((exit) => exit.cancel());
      exits = [];
    },
  };
}

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
