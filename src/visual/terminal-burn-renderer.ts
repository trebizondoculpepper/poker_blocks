/**
 * The terminal-field burn renderer (#1212; doc/loss-field-burn.md): the `TerminalBurnRenderer`
 * the terminal-field burn presenter (#945, `terminal-field-burn.ts`) drives. It draws; the
 * presenter decides order, starts, the gate and every timing.
 *
 * - **Captured ghosts.** `capture` builds one independent ghost per captured card from its own
 *   immutable snapshot (the card as it was, its pose relative to the given parent), under one
 *   outgoing root this renderer owns. Ghosts are presentation only: no field entry, never
 *   hit-tested, untouched by a later board, hand or model change. Which cards are captured is the
 *   caller's composition (the terminal playfield); this never asks what a card is or where from.
 * - **Burn.** Each burn runs the shared paired mask (#1166) in reverse: the ghost is the side
 *   whose coverage is decided by the shared per-ray noise, its threshold sweeping from whole to
 *   nothing with the mask's burning rim, so every declared contribution of its look (custom
 *   shaders, extras, contained parts, prepasses, outlines) burns through its own adapter. A look
 *   the mask can't pair is never drawn whole and silent: the burn throws, and the presenter shows
 *   its summary.
 * - **Timing** is the presenter's: a burn's progress comes from the supplied clock and its
 *   scheduled start, so late or batched starts keep their stagger. No timers of its own.
 * - **Summary** (reduced motion, a failed start, a refused admission, a cancelled burn) shows a
 *   ghost's captured end state at once: burnt away, and its resources freed.
 * - **Ownership.** Each ghost's resources are freed exactly once (burnt, summarized or disposed);
 *   `dispose` frees everything still held and removes the root. Shared renderer resources (block
 *   prepasses, textures it didn't make) are never disposed here.
 *
 * It reads no model, changes nothing, draws no session randomness and plays no sound.
 */
import * as THREE from "three";
import type { CardBlock } from "../cards";
import type { RenderedBlock } from "../rendered-blocks";
import type { TerminalBurnRenderer } from "./terminal-field-burn";
import { materialiseAt } from "./materialise";
import { createPairedMask, type PairedMask } from "./paired-mask";
import type { EffectHandle } from "../visual-events/scheduler";

/** One captured terminal-field card: its snapshot and its pose relative to the capture parent. */
export type CapturedFieldCard = {
  block: CardBlock;
  position: THREE.Vector3Tuple;
  quaternion: THREE.Vector4Tuple;
  scale?: THREE.Vector3Tuple;
};

/** What makes and frees a ghost's look (the ordinary block views, detached). */
export type GhostViews = {
  /** A detached view of a captured card, owned by the caller until released. */
  detachedView(block: CardBlock): RenderedBlock;
  /** Free a detached view, once. */
  release(view: RenderedBlock): void;
};

export type TerminalBurnRendererOptions = {
  views: GhostViews;
  /** The burning rim's colour. */
  glow?: string;
  /** Where a look the mask can't burn is reported (default: the console). */
  diagnose?(message: string): void;
};

type Ghost = { view: RenderedBlock; mount: THREE.Group; mask: PairedMask | null; freed: boolean };

export function createTerminalBurnRenderer(options: TerminalBurnRendererOptions) {
  const ghosts = new Map<string, Ghost>();
  const glow = options.glow ?? "#ff7a1a";
  let root: THREE.Group | null = null;
  let next = 0;
  const diagnose = (message: string) =>
    options.diagnose ? options.diagnose(message) : console.warn(message);

  /** A ghost's end state: burnt away, its mask's clones and its own look freed, once. */
  const settle = (ghost: Ghost) => {
    if (ghost.freed) return;
    ghost.freed = true;
    ghost.mask?.cancel();
    ghost.mask = null;
    ghost.mount.removeFromParent();
    options.views.release(ghost.view);
  };

  const renderer = {
    /**
     * Capture the terminal field's cards as ghosts under one outgoing root, added to `parent` (it
     * follows that parent's pose). Returns their ghost IDs, in the order given.
     */
    capture(parent: THREE.Object3D, cards: readonly CapturedFieldCard[]): string[] {
      root ??= new THREE.Group();
      root.name = "terminal-field-burn";
      parent.add(root);
      return cards.map(({ block, position, quaternion, scale }) => {
        const view = options.views.detachedView(block);
        const mount = new THREE.Group();
        mount.position.fromArray(position);
        mount.quaternion.fromArray(quaternion);
        if (scale) mount.scale.fromArray(scale);
        view.cube.removeFromParent();
        view.cube.position.set(0, 0, 0);
        view.cube.quaternion.identity();
        view.cube.scale.set(1, 1, 1);
        mount.add(view.cube);
        root!.add(mount);
        const id = `terminal-ghost-${++next}`;
        ghosts.set(id, { view, mount, mask: null, freed: false });
        return id;
      });
    },

    burn(ghostId: string, timing: { startMs: number; durationMs: number }): EffectHandle {
      const ghost = ghosts.get(ghostId);
      if (!ghost || ghost.freed) throw new Error(`terminal burn: no ghost ${ghostId}`);
      // The ghost is the side the noise decides, run from whole to nothing: it burns away with
      // the mask's rim, every part through its own declared adapter.
      const made = createPairedMask({
        mount: ghost.mount,
        outgoing: { root: new THREE.Group(), maskAdapter: "chunkSurface" },
        incoming: { root: ghost.view.cube, maskAdapter: ghost.view.maskAdapter },
        glow,
      });
      if (!made.ok) {
        diagnose(`terminal burn of ${ghostId} can't be drawn: ${made.diagnostic}`);
        throw new Error(made.diagnostic);
      }
      ghost.mask = made.mask;
      const { mask } = made;
      let last: number | null = null;
      const draw = (nowMs: number) => {
        // Follow the root's pose, then set this burn's own progress from the supplied clock.
        mask.update(0);
        const t = Math.max(0, nowMs - timing.startMs);
        mask.uniforms.matTime.value += last === null ? 0 : Math.max(0, nowMs - last) / 1000;
        last = nowMs;
        mask.uniforms.matProgress.value = 1 - materialiseAt(t, timing.durationMs);
        return t >= timing.durationMs;
      };
      return {
        update(nowMs) {
          if (ghost.freed) return "finished";
          if (!draw(nowMs)) return "running";
          settle(ghost);
          return "finished";
        },
        // Cancelled mid-burn: its summary, as the presenter expects of the renderer.
        cancel: () => settle(ghost),
        dispose: () => settle(ghost),
      };
    },

    summary(ghostId: string): void {
      const ghost = ghosts.get(ghostId);
      if (ghost) settle(ghost);
    },

    /** Free every ghost still held and remove the outgoing root (teardown, a new run). */
    dispose(): void {
      for (const ghost of ghosts.values()) settle(ghost);
      ghosts.clear();
      root?.removeFromParent();
      root = null;
    },
  } satisfies TerminalBurnRenderer & Record<string, unknown>;
  return renderer;
}

export type TerminalBurnRendererService = ReturnType<typeof createTerminalBurnRenderer>;
