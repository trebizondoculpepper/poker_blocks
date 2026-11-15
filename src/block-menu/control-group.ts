/**
 * One shared control-stage rendering host per composed group of controls (#1078;
 * doc/shop-control-blocks.md: "Use one shared control-stage rendering host per composed group,
 * with reusable per-control mounts, rather than a new WebGL renderer for each button").
 *
 * A transparent overlay over the scene carries the group's one canvas; it takes no pointer
 * input. Each owner (the shop's Buy, the bin's Sell presenter) places its control at a slot
 * element it owns: the control is laid out over that slot's current bounds every frame. An owner
 * hides its control while its scene is covered and removes it when it leaves; the group draws only
 * while some control is shown. Owners never see the renderer.
 */
import * as THREE from "three";
import { sparkleEnvironment } from "../visual/attract-look";
import { createControlStage, type ControlDefinition, type ControlStage } from "./control-stage";

/** A control as an owner places it: everything but its layout, which follows its slot. */
export type GroupControl = Omit<ControlDefinition, "layout"> & {
  /** The edge of the cube as a share of the slot's smaller side. */
  fill?: number;
};

export type PlacedControl = {
  /** Hidden while its owner's scene is covered; shown again on resume. */
  setHidden(hidden: boolean): void;
  /** The control's current bounds in client px, for flights and drop geometry. */
  hitRegion(): { left: number; top: number; width: number; height: number } | null;
  /** A drag over its owner would be accepted: the block shows it (#1364 review). */
  setTargeted(targeted: boolean): void;
  /** Its owner no longer composes it. */
  remove(): void;
};

export function createControlGroup(overlay: HTMLElement, reducedMotion: () => boolean) {
  overlay.classList.add("control-group");
  /** How many placed blocks each host element presents. */
  const presenting = new WeakMap<HTMLElement, number>();
  let stage: ControlStage | null = null;
  const ready = createControlStage(
    {
      element: overlay,
      createRenderer: () => new THREE.WebGLRenderer({ alpha: true, antialias: true }),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      environment: (renderer) => sparkleEnvironment(renderer as THREE.WebGLRenderer, 0),
    },
    [],
  ).then((made) => (stage = made));
  const shown = new Set<string>();
  /** Draw while any control is shown, with the game's resolved reduced-motion setting. */
  const run = () => {
    if (!stage) return;
    if (shown.size === 0) return stage.cover();
    stage.setReducedMotion(reducedMotion());
    stage.resume();
  };
  return {
    /** Place a control over `slot`; it shows at once unless hidden. */
    place(slot: HTMLElement, control: GroupControl): PlacedControl {
      let removed = false;
      // The element the slot sits in presents a block now: it shows no HTML chrome of its own
      // (#1364; doc/shop-control-blocks.md, "Standalone menu blocks"). Counted, so a host keeps
      // the mark while any of its blocks is placed.
      const owner = slot.parentElement;
      if (owner) presenting.set(owner, (presenting.get(owner) ?? 0) + 1);
      owner?.classList.add("presents-block");
      const layout = () => {
        const box = slot.getBoundingClientRect();
        const origin = overlay.getBoundingClientRect();
        return {
          x: box.left - origin.left + box.width / 2,
          y: box.top - origin.top + box.height / 2,
          size: Math.min(box.width, box.height) * (control.fill ?? 0.62),
        };
      };
      let hidden = false;
      shown.add(control.id);
      // Mounting is asynchronous: whatever the owner asked meanwhile is applied once it lands
      // (#1298), so an early hide or removal is never lost or applied out of order.
      void ready
        .then((made) => (removed ? undefined : made.add({ ...control, layout })))
        .then(() => {
          if (removed) stage?.remove(control.id);
          else stage?.setHidden(control.id, hidden);
          run();
        });
      return {
        setHidden(value) {
          hidden = value;
          if (value) shown.delete(control.id);
          else if (!removed) shown.add(control.id);
          stage?.setHidden(control.id, value);
          run();
        },
        hitRegion: () => stage?.hitRegion(control.id) ?? null,
        setTargeted(targeted) {
          if (!removed) stage?.setTargeted(control.id, targeted);
          run();
        },
        remove() {
          if (removed) return;
          removed = true;
          shown.delete(control.id);
          const left = owner ? (presenting.get(owner) ?? 1) - 1 : 0;
          if (owner) presenting.set(owner, left);
          if (owner && left <= 0) owner.classList.remove("presents-block");
          stage?.remove(control.id);
          run();
        },
      };
    },
    dispose() {
      void ready.then((made) => made.dispose());
    },
  };
}

export type ControlGroup = ReturnType<typeof createControlGroup>;
