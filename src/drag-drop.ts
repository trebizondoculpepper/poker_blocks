/**
 * Drag and drop (#273, epic #271), in the standard vocabulary of HTML5 drag and drop and React
 * DnD: **drop targets** are places dragged things can be dropped, each owning its own decision.
 * A drop target is composed into a scene by the `dropTarget` trait, which enables it while the
 * scene shows. While something is dragged, the drag-and-drop manager **hit-tests** the enabled
 * targets in priority order (highest first), and the first to answer takes the point:
 *
 * - `accept`: it can take the dragged things here; on **drop** it takes them, committing to the
 *   model at once (#272, model first);
 * - `reject`: the point is its, but it won't take them (the bin with no discards left); a drop
 *   there is rejected;
 * - `null`: not here; the next target is asked.
 *
 * While dragged things are over a target it shows **hover** feedback. The manager never names a
 * target or asks what one is: target kinds are a registry keyed by name, and a scene's
 * `dropTarget` data names the ones it allows and their priority. (Drag sources, `dragSource`,
 * and the gesture arena that decides what a pointer becomes, follow in #276 and #282.)
 */
import type { RenderedBlock } from "./rendered-blocks";

export type DropVerdict = "accept" | "reject";

export type DropTarget = {
  /** Whether this target can take the dragged blocks at a point, or null if it isn't there. */
  canDrop(carried: readonly RenderedBlock[], clientX: number, clientY: number): DropVerdict | null;
  /** Show hover feedback while the dragged blocks are over it, or clear it with null. */
  hover(verdict: DropVerdict | null): void;
  /** Take the dropped blocks; true when the rules accept them. */
  drop(carried: readonly RenderedBlock[]): boolean;
  /** The blocks were dropped here while it rejected them. */
  reject(): void;
  /** Words for the action-history trace. */
  describe(verdict: DropVerdict): string;
};

/** One drop target a scene allows, from its `dropTarget` data. */
export type DropTargetConfig = { target: string; priority: number };

/** The drop target hit at a point during a drag. */
export type DropHit = { name: string; target: DropTarget; verdict: DropVerdict };

export type DragDropManager = {
  /** Allow a drop target while a scene shows; returns a function that disallows it again. */
  enable(config: DropTargetConfig): () => void;
  /** Hit-test: the first enabled drop target, by priority, with an answer at this point. */
  hitTest(carried: readonly RenderedBlock[], clientX: number, clientY: number): DropHit | null;
  /** Show this hit's hover feedback on its target and clear every other target's. */
  hover(hit: DropHit | null): void;
};

export function createDragDropManager(kinds: { get(name: string): DropTarget }): DragDropManager {
  /** Enabled drop targets; one enabled by two scenes stays until both disable it. */
  const enabled: DropTargetConfig[] = [];
  const ordered = () => [...enabled].sort((a, b) => b.priority - a.priority);
  return {
    enable(config) {
      kinds.get(config.target);
      const entry = { ...config };
      enabled.push(entry);
      return () => {
        const at = enabled.indexOf(entry);
        if (at >= 0) enabled.splice(at, 1);
        kinds.get(config.target).hover(null);
      };
    },
    hitTest(carried, clientX, clientY) {
      for (const { target: name } of ordered()) {
        const target = kinds.get(name);
        const verdict = target.canDrop(carried, clientX, clientY);
        if (verdict) return { name, target, verdict };
      }
      return null;
    },
    hover(hit) {
      for (const name of new Set(enabled.map(({ target }) => target))) {
        const target = kinds.get(name);
        target.hover(hit?.target === target ? hit.verdict : null);
      }
    },
  };
}
