import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { Registry } from "../core/registry";
import type { DragLifecycle } from "../drag-drop";
import {
  createDropTargetGuide,
  type DropGuideProvider,
  type DropTargetGuideConfig,
} from "./drop-target-guide";
import type { createHudOverlay } from "./hud-overlay";

const config: DropTargetGuideConfig = {
  provider: "offers",
  accept: { shape: "rectangle", colour: 0x65f4dd },
  refuse: { shape: "cross", colour: 0xff3344 },
};

function setup() {
  const buy = { isConnected: true } as Element;
  const rack = { isConnected: true } as Element;
  let listener: ((event: DragLifecycle) => void) | null = null;
  let refusal: string | null = null;
  let preferred: Element[] = [buy];
  const providers = new Registry<DropGuideProvider>("drop guide provider");
  providers.register("offers", { preferred: () => preferred, refusal: () => refusal });
  const scene = new THREE.Scene();
  const observed = new Set<Element>();
  let disposed = false;
  let renders = 0;
  const overlay = (() => ({
    scene,
    rectOf: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    observe: (element: Element) => {
      observed.add(element);
      return () => observed.delete(element);
    },
    onLayout: () => () => undefined,
    render: () => {
      renders++;
    },
    dispose: () => {
      disposed = true;
    },
  })) as unknown as typeof createHudOverlay;
  const guide = createDropTargetGuide(config, {
    element: {} as HTMLElement,
    observeDrag: (next) => {
      listener = next;
      return () => void (listener = null);
    },
    providers,
    overlay,
  });
  const drag = (phase: DragLifecycle["phase"]) =>
    listener?.({
      phase,
      live: phase === "began" || phase === "changed",
      source: "shop",
      picked: {},
      at: { clientX: 0, clientY: 0 },
    });
  return {
    guide,
    scene,
    observed,
    buy,
    rack,
    drag,
    refuse: (reason: string | null) => void (refusal = reason),
    prefer: (areas: Element[]) => void (preferred = areas),
    listening: () => listener !== null,
    disposed: () => disposed,
    renders: () => renders,
  };
}

describe("drag target guide (#922)", () => {
  it("shows nothing until a drag begins, then marks only the preferred area", () => {
    const t = setup();
    expect(t.guide.showing()).toEqual([]);
    t.drag("began");
    expect(t.guide.showing()).toEqual([{ area: t.buy, refused: false }]);
    expect(t.scene.children).toHaveLength(1);
    expect(t.observed.has(t.buy)).toBe(true);
    expect(t.scene.children[0]!.position.toArray()).toEqual([60, -40, 0]);
  });

  it("switches to the refusal look when the live verdict refuses, mid-drag", () => {
    const t = setup();
    t.drag("began");
    t.refuse("unaffordable");
    t.guide.frame(0.1, false);
    expect(t.guide.showing()).toEqual([{ area: t.buy, refused: true }]);
    expect(t.scene.children).toHaveLength(1);
  });

  it("clears at once on end and on cancel (lost capture)", () => {
    for (const phase of ["ended", "cancelled"] as const) {
      const t = setup();
      t.drag("began");
      t.drag(phase);
      expect(t.guide.showing()).toEqual([]);
      expect(t.scene.children).toHaveLength(0);
      expect(t.observed.size).toBe(0);
      // Drawn cleared at once, without waiting for a frame.
      expect(t.renders()).toBe(1);
    }
  });

  it("drops a guide whose area left the page", () => {
    const t = setup();
    t.prefer([t.buy, t.rack]);
    t.drag("began");
    expect(t.guide.showing()).toHaveLength(2);
    (t.rack as { isConnected: boolean }).isConnected = false;
    t.guide.frame(0.1, false);
    expect(t.guide.showing()).toEqual([{ area: t.buy, refused: false }]);
  });

  it("disposes its subscription, guides and overlay", () => {
    const t = setup();
    t.drag("began");
    t.guide.dispose();
    expect(t.listening()).toBe(false);
    expect(t.scene.children).toHaveLength(0);
    expect(t.disposed()).toBe(true);
  });
});
