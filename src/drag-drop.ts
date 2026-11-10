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
 * `dropTarget` data names the ones it allows and their priority. dnd-kit (#282) supplies the
 * droppables, collision ordering and the drag lifecycle; see `createDragDropManager`.
 */
import { type CollisionDetector, CollisionType, sortCollisions } from "@dnd-kit/abstract";
import { type DragDropManager as DndKitManager, Draggable, Droppable } from "@dnd-kit/dom";
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

/**
 * A drag source (#282, #276, #277): something that can be picked up. It answers what is picked
 * up under a pointer (or null where it has nothing), and it runs its own drag: dnd-kit decides
 * when a press becomes a drag and when it ends, and the manager hands each step to the source
 * that started it, never asking what the source is.
 */
export type DragSource<Picked = any> = {
  /** The element pressed to pick from this source; the manager's surface when omitted. */
  readonly surface?: Element;
  /** What is picked up at a point, or null. */
  pick(clientX: number, clientY: number): Picked | null;
  /** The drag began: `press` is where the pointer went down, `at` where the drag started. */
  begin(picked: Picked, press: Point, at: Point): void;
  /** The pointer moved during the drag. */
  move(at: Point): void;
  /** The drag ended: dropped at `at`, or cancelled (put everything back). */
  end(at: Point, canceled: boolean): void;
};

/** A point on the screen, in client pixels. */
export type Point = { clientX: number; clientY: number };

/** One drag source a scene allows, from its `dragSource` data. */
export type DragSourceConfig = { source: string };

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
  /** Allow a drag source while a scene shows; returns a function that disallows it again. */
  enableSource(config: DragSourceConfig): () => void;
  /** What an enabled drag source would pick up at a point, if anything. */
  pickUp(clientX: number, clientY: number): unknown;
  /**
   * Whether a dnd-kit draggable may start a drag from a press at a point: its source picks
   * something up there. What it picks up, and where, is kept for `pressed`.
   */
  canStart(draggable: Draggable, clientX: number, clientY: number): boolean;
  /**
   * What the press that started a draggable's drag picked up, and where. dnd-kit starts a drag
   * on the move that crosses its threshold, by which time the pointer may be off the block.
   */
  pressed(draggable: Draggable): Press | null;
  /** Forget every pending press: a cancelled gesture can't become a drag later. */
  forgetPresses(): void;
};

/** A press on a drag source: what it picked up and where the pointer went down. */
export type Press = Point & { picked: unknown };

/**
 * The drag-and-drop manager over dnd-kit (#282): each enabled drop target is a dnd-kit
 * **droppable** whose collision detector is the target's own `canDrop`, with the scene's
 * priority as its collision priority. Hit-testing runs those detectors and orders the
 * collisions with dnd-kit's `sortCollisions`, synchronously, so the decision for a pointer
 * position is made at that position.
 */
export function createDragDropManager(
  kinds: { get(name: string): DropTarget },
  dnd: DndKitManager,
  sources: { kinds: { get(name: string): DragSource }; surface?: Element } = {
    kinds: { get: (name) => missingSource(name) },
  },
): DragDropManager {
  /**
   * Enabled drag sources, each a dnd-kit draggable bound to the surface the pointer presses
   * (the canvas): dnd-kit's sensors start it, and only where its source picks something up.
   */
  const sourcesEnabled: { config: DragSourceConfig; draggable: Draggable }[] = [];
  const presses = new Map<Draggable, Press>();
  /** The source running the current drag, if any. */
  let running: DragSource | null = null;
  const sourceOf = (draggable: unknown) =>
    sourcesEnabled.find((enabled) => enabled.draggable === draggable);
  dnd.monitor.addEventListener("dragstart", ({ operation }) => {
    const entry = sourceOf(operation.source);
    const press = entry && presses.get(entry.draggable);
    if (!entry || !press) {
      dnd.actions.stop({ canceled: true });
      return;
    }
    running = sources.kinds.get(entry.config.source);
    const { x, y } = operation.position.current;
    running.begin(press.picked, press, { clientX: x, clientY: y });
  });
  dnd.monitor.addEventListener("dragmove", ({ operation, to }) => {
    const { x, y } = to ?? operation.position.current;
    running?.move({ clientX: x, clientY: y });
  });
  dnd.monitor.addEventListener("dragend", ({ operation, canceled, nativeEvent }) => {
    const source = running;
    running = null;
    const release = nativeEvent as PointerEvent | undefined;
    const { x, y } = operation.position.current;
    source?.end(
      release && !canceled
        ? { clientX: release.clientX, clientY: release.clientY }
        : { clientX: x, clientY: y },
      canceled,
    );
  });
  type Enabled = { config: DropTargetConfig; droppable: Droppable };
  /** Enabled drop targets; one enabled by two scenes stays until both disable it. */
  const enabled: Enabled[] = [];
  /** What a hit test is asking about: read by the droppables' collision detectors. */
  let query: { carried: readonly RenderedBlock[]; x: number; y: number } = {
    carried: [],
    x: 0,
    y: 0,
  };
  let serial = 0;
  function detector(config: DropTargetConfig): CollisionDetector {
    return ({ droppable }) => {
      const verdict = kinds.get(config.target).canDrop(query.carried, query.x, query.y);
      return verdict
        ? {
            id: droppable.id,
            value: 1,
            type: CollisionType.PointerIntersection,
            priority: config.priority,
            data: { verdict },
          }
        : null;
    };
  }
  return {
    enable(config) {
      kinds.get(config.target);
      const entry: Enabled = {
        config: { ...config },
        droppable: new Droppable(
          {
            id: `${config.target}:${(serial += 1)}`,
            collisionPriority: config.priority,
            collisionDetector: detector(config),
            data: { target: config.target },
          },
          dnd,
        ),
      };
      enabled.push(entry);
      return () => {
        const at = enabled.indexOf(entry);
        if (at >= 0) enabled.splice(at, 1);
        entry.droppable.destroy();
        kinds.get(config.target).hover(null);
      };
    },
    hitTest(carried, clientX, clientY) {
      query = { carried, x: clientX, y: clientY };
      const collisions = enabled.flatMap(({ droppable }) => {
        const collision = droppable.collisionDetector({
          droppable,
          dragOperation: dnd.dragOperation,
        });
        return collision ? [collision] : [];
      });
      const first = collisions.sort(sortCollisions)[0];
      const hit = first && enabled.find(({ droppable }) => droppable.id === first.id);
      if (!first || !hit) return null;
      const name = hit.config.target;
      return { name, target: kinds.get(name), verdict: first.data!.verdict as DropVerdict };
    },
    enableSource(config) {
      sources.kinds.get(config.source);
      const entry = {
        config: { ...config },
        draggable: new Draggable(
          {
            id: `${config.source}:${(serial += 1)}`,
            handle: sources.kinds.get(config.source).surface ?? sources.surface,
            data: { source: config.source },
          },
          dnd,
        ),
      };
      sourcesEnabled.push(entry);
      return () => {
        const at = sourcesEnabled.indexOf(entry);
        if (at >= 0) sourcesEnabled.splice(at, 1);
        presses.delete(entry.draggable);
        entry.draggable.destroy();
      };
    },
    pickUp(clientX, clientY) {
      for (const { config } of sourcesEnabled) {
        const picked = sources.kinds.get(config.source).pick(clientX, clientY);
        if (picked) return picked;
      }
      return null;
    },
    canStart(draggable, clientX, clientY) {
      const entry = sourcesEnabled.find((enabled) => enabled.draggable === draggable);
      const picked = entry ? sources.kinds.get(entry.config.source).pick(clientX, clientY) : null;
      if (picked) presses.set(draggable, { picked, clientX, clientY });
      else presses.delete(draggable);
      return Boolean(picked);
    },
    pressed: (draggable) => presses.get(draggable) ?? null,
    forgetPresses: () => presses.clear(),
    hover(hit) {
      for (const name of new Set(enabled.map(({ config }) => config.target))) {
        const target = kinds.get(name);
        target.hover(hit?.target === target ? hit.verdict : null);
      }
    },
  };
}

function missingSource(name: string): never {
  throw new Error(`Unknown drag source: ${name}`);
}
