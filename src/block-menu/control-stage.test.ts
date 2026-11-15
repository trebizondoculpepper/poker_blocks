import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { Block } from "../core/block";
import { menuAction } from "../traits/menu-action";
import type { DropTarget } from "../drag-drop";
import { createControlStage, type ControlDefinition } from "./control-stage";

vi.mock("../audio/sfx", () => ({ playSfx: vi.fn() }));
const disposed: string[] = [];
vi.mock("../word-cube", () => ({
  createWordCube: (text: string, options: { id: string; action: string; enabled?: boolean }) => {
    const block = new Block(options.id);
    block.add(menuAction, { action: options.action, enabled: options.enabled ?? true, sfx: null });
    const object = new THREE.Group();
    object.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    return Promise.resolve({
      block,
      object,
      dispose: () => {
        disposed.push(text);
        block.dispose();
      },
    });
  },
}));

/** A minimal element: listeners, style, attributes, children, bounds. */
function fakeElement(tag = "div") {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const element = {
    tag,
    style: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as unknown[],
    parent: null as { children: unknown[] } | null,
    disabled: false,
    /** What the browser's :focus-visible would say for the next focus. */
    focusVisible: true,
    matches: (selector: string) => selector === ":focus-visible" && element.focusVisible,
    type: "",
    className: "",
    textContent: "",
    clientWidth: 800,
    clientHeight: 400,
    ownerDocument: null as unknown,
    setAttribute(name: string, value: string) {
      element.attributes[name] = value;
    },
    append(child: { parent: unknown }) {
      element.children.push(child);
      child.parent = element;
    },
    remove() {
      const siblings = element.parent?.children;
      if (siblings) siblings.splice(siblings.indexOf(element), 1);
      element.parent = null;
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string, event: object = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    listenerCount: () => Array.from(listeners.values()).reduce((n, set) => n + set.size, 0),
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  };
  return element;
}

function harness() {
  const host = fakeElement();
  const buttons: ReturnType<typeof fakeElement>[] = [];
  host.ownerDocument = {
    defaultView: { devicePixelRatio: 1 },
    createElement: (tag: string) => {
      const made = fakeElement(tag);
      buttons.push(made);
      return made;
    },
  };
  const canvas = fakeElement("canvas");
  const renderer = {
    domElement: canvas,
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    setPixelRatio: vi.fn(),
  };
  const frames: ((now: number) => void)[] = [];
  return {
    host,
    buttons,
    canvas,
    renderer,
    frames,
    stageHost: {
      element: host as unknown as HTMLElement,
      createRenderer: () => renderer as unknown as THREE.WebGLRenderer,
      requestFrame: (callback: (now: number) => void) => frames.push(callback),
      cancelFrame: (handle: number) => void (frames[handle - 1] = () => {}),
    },
  };
}

const controls: ControlDefinition[] = [
  {
    id: "a",
    label: "ALPHA",
    description: "First configured control",
    action: "configured.first",
    layout: ({ width, height }) => ({ x: width * 0.25, y: height / 2, size: 100 }),
  },
  {
    id: "b",
    label: "BETA",
    description: "A pure drop target",
    layout: ({ width, height }) => ({ x: width * 0.75, y: height / 2, size: 50 }),
  },
];

describe("grouped 3D control stage (#1146; doc/shop-control-blocks.md)", () => {
  it("uses one renderer and canvas for the group, which takes no pointer input", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    expect(h.canvas.style.pointerEvents).toBe("none");
    expect(h.host.children.filter((child) => child === h.canvas)).toHaveLength(1);
    expect(h.buttons).toHaveLength(2);
    stage.dispose();
  });

  it("places each control at its configured layout and publishes its real hit region", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    // ALPHA: centre (200, 200) host px, edge 100; the host sits at (10, 20) on screen.
    expect(stage.hitRegion("a")).toEqual({ left: 160, top: 170, width: 100, height: 100 });
    expect(stage.destinationAnchor("a")).toEqual({ x: 210, y: 220 });
    expect(h.buttons[0].style).toMatchObject({ left: "150px", top: "150px", width: "100px" });
    // Turning the control (precession) changes its projected bounds, and the region follows.
    stage.object("a")!.children[0].rotation.set(0, Math.PI / 4, 0);
    h.frames.at(-1)?.(16);
    stage.resume();
    h.frames.at(-1)!(32);
    expect(stage.hitRegion("a")!.width).toBeCloseTo(100 * Math.SQRT2, 3);
    stage.dispose();
  });

  it("reflows from composition: an alternate host size moves controls by their own layout", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    h.host.clientWidth = 400;
    stage.resize();
    expect(stage.destinationAnchor("b")).toEqual({ x: 10 + 300, y: 20 + 200 });
    stage.dispose();
  });

  it("dispatches a click action once through the cube's own traits", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    const actions: [string, string][] = [];
    const stop = stage.onAction((action, id) => actions.push([action, id]));
    // A pointer press and release on the hit region.
    h.buttons[0].fire("pointerdown", { pointerType: "mouse" });
    h.buttons[0].fire("pointerup", { pointerType: "mouse", clientX: 210, clientY: 220 });
    // The browser's click after that pointer press is not a second activation.
    h.buttons[0].fire("click", { detail: 1 });
    // Keyboard activation: one more.
    h.buttons[0].fire("click", { detail: 0 });
    expect(actions).toEqual([
      ["configured.first", "a"],
      ["configured.first", "a"],
    ]);
    stop();
    stage.dispose();
  });

  it("does not activate on a touch released off the control (#1191)", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    const actions: string[] = [];
    stage.onAction((action) => actions.push(action));
    h.buttons[0].fire("pointerdown", { pointerType: "touch" });
    // The finger slid away: the captured release arrives at the button, but far off it.
    h.buttons[0].fire("pointerup", { pointerType: "touch", clientX: 600, clientY: 380 });
    expect(actions).toEqual([]);
    stage.dispose();
  });

  it("gives keyboard focus the same lift and description as hover (#1191)", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    const seen: string[] = [];
    const events = ["input.enter", "input.focus", "input.blur", "input.leave"];
    const stops = events.map((name) => stage.cube("a")!.block.on(name, () => void seen.push(name)));
    h.buttons[0].fire("focus");
    h.buttons[0].fire("blur");
    expect(seen).toEqual(events);
    stops.forEach((stop) => stop());
    stage.dispose();
  });

  it("ignores focus a pointer press caused, keeping the pointer's own hover (#1202)", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    const seen: string[] = [];
    const events = ["input.enter", "input.focus", "input.blur", "input.leave"];
    const stops = events.map((name) => stage.cube("a")!.block.on(name, () => void seen.push(name)));
    h.buttons[0].fire("pointerdown", { pointerType: "mouse" });
    // The pointer's own hover; what follows must add nothing.
    seen.length = 0;
    // Focus from a press is not :focus-visible.
    h.buttons[0].focusVisible = false;
    h.buttons[0].fire("focus");
    h.buttons[0].fire("blur");
    expect(seen).toEqual([]);
    // Keyboard focus afterwards still forwards.
    h.buttons[0].focusVisible = true;
    h.buttons[0].fire("focus");
    expect(seen).toEqual(["input.enter", "input.focus"]);
    stops.forEach((stop) => stop());
    stage.dispose();
  });

  it("treats a touch's late focus as the touch's, whatever order it arrives in (#1241)", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    const seen: string[] = [];
    const stop = stage.cube("a")!.block.on("input.focus", () => void seen.push("focus"));
    h.buttons[0].fire("pointerdown", { pointerType: "touch" });
    h.buttons[0].fire("pointerup", { pointerType: "touch", clientX: 210, clientY: 220 });
    await Promise.resolve();
    // The browser focuses after the release; it isn't :focus-visible.
    h.buttons[0].focusVisible = false;
    h.buttons[0].fire("focus");
    expect(seen).toEqual([]);
    stop();
    stage.dispose();
  });

  it("forgets a press that moved no focus, so later keyboard focus still forwards (#1234)", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    const seen: string[] = [];
    const stop = stage.cube("a")!.block.on("input.focus", () => void seen.push("focus"));
    h.buttons[0].fire("pointerdown", { pointerType: "mouse" });
    h.buttons[0].fire("pointerup", { pointerType: "mouse", clientX: 0, clientY: 0 });
    await Promise.resolve();
    h.buttons[0].fire("focus");
    expect(seen).toEqual(["focus"]);
    stop();
    stage.dispose();
  });

  it("displays the canvas at the host's CSS size, whatever its drawing buffer (#1191)", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    expect(h.canvas.style).toMatchObject({ width: "800px", height: "400px" });
    stage.dispose();
  });

  it("binds an existing drop target to a control's region without changing its rules", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    const canDrop = vi.fn(() => ({ accepted: true }) as never);
    const drop = vi.fn(() => true);
    const binding: DropTarget = {
      canDrop,
      hover: vi.fn(),
      drop,
      reject: vi.fn(),
      describe: () => "binding",
    };
    const target = stage.dropTarget("b", binding);
    // BETA: centre (600, 200) host px, edge 50 → client 585..635 × 195..245.
    expect(target.canDrop([], 100, 100)).toBeNull();
    expect(canDrop).not.toHaveBeenCalled();
    expect(target.canDrop([], 610, 220)).toEqual({ accepted: true });
    expect(target.drop([])).toBe(true);
    expect(drop).toHaveBeenCalledTimes(1);
    stage.dispose();
  });

  it("presents availability from its owner on the cube and its semantic button", async () => {
    const h = harness();
    const stage = await createControlStage(h.stageHost, controls);
    stage.setEnabled("a", false, "Not enough coins");
    expect(h.buttons[0].disabled).toBe(true);
    const actions: string[] = [];
    stage.onAction((action) => actions.push(action));
    h.buttons[0].fire("click", { detail: 0 });
    expect(actions).toEqual([]);
    stage.dispose();
  });

  it("covers, resumes with one loop, and disposes everything once", async () => {
    const h = harness();
    disposed.length = 0;
    const stage = await createControlStage(h.stageHost, controls);
    stage.resume();
    stage.resume();
    expect(h.frames).toHaveLength(1);
    stage.cover();
    stage.resume();
    expect(h.frames).toHaveLength(2);
    stage.dispose();
    stage.dispose();
    expect(disposed).toEqual(["ALPHA", "BETA"]);
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(h.host.children).toHaveLength(0);
    for (const button of h.buttons) expect(button.listenerCount()).toBe(0);
  });
});
