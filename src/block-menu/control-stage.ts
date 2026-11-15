/**
 * A grouped 3D control stage (#1146; doc/shop-control-blocks.md, "Three configured controls,
 * common presentation" and "Access, lifecycle and validation"). One rendering host per composed
 * group of word-cube controls, each at its own configured anchor and size.
 *
 * - **Composition supplies everything.** Each control definition carries its label,
 *   description, appearance, layout (a function of the host size, so narrow viewports can
 *   reflow), optional click action and optional ambient precession. The stage never chooses
 *   behaviour from a label, scene, material or control id; it reuses `createWordCube`, which
 *   composes menu action, availability, inspection, interaction feedback and precession.
 * - **Input only over controls.** The canvas takes no pointer events. Each control gets one
 *   semantic button (its keyboard/accessibility mount) placed over the control's actual projected
 *   bounds every frame: it is the hit region, so nothing else on the page is intercepted.
 * - **Published geometry.** `hitRegion(id)` and `destinationAnchor(id)` give the control's current
 *   transformed bounds and centre in client CSS px. `dropTarget(id, binding)` wraps an existing drop
 *   target so it is hit only over that control; the binding keeps all its rules.
 * - **Lifecycle.** The group owns its renderer, environment and frame loop; each control owns its
 *   cube and button. `cover()` suspends drawing and motion, `resume()` continues without
 *   duplicating anything, `dispose()` releases everything once.
 */
import * as THREE from "three";
import type { DropTarget } from "../drag-drop";
import { createWordCube, type WordCubeOptions } from "../word-cube";
import { createPointerRouter } from "./pointer-router";
import { useStageReflections } from "./cube-stage";

/** Where a control sits, in host CSS px: its centre and its cube's edge. */
export type ControlLayout = { x: number; y: number; size: number };

export type ControlDefinition = {
  id: string;
  label: string;
  description: string;
  /** Host size in, this control's layout out: composition decides, including narrow reflow. */
  layout(host: { width: number; height: number }): ControlLayout;
  /** The opaque action a click dispatches (`menu.action`); a pure drop target has none. */
  action?: string;
  enabled?: boolean;
  disabledReason?: string;
  /** Appearance, precession, feedback and sound settings for the cube. */
  cube?: Partial<Omit<WordCubeOptions, "id" | "action">>;
};

/** What a host page gives the stage: its element and a WebGL renderer for the group. */
export type ControlStageHost = {
  element: HTMLElement;
  /** One renderer for the whole group; the stage disposes it. */
  createRenderer(): Pick<
    THREE.WebGLRenderer,
    "domElement" | "setSize" | "render" | "dispose" | "setPixelRatio"
  >;
  /** The group's frame loop; injected so tests and covered scenes control it. */
  requestFrame(callback: (nowMs: number) => void): number;
  cancelFrame(handle: number): void;
  /**
   * The stage's reflection environment, made on its own renderer: metallic and glossy cubes
   * reflect it (gold is black without one). The stage disposes it. None: unlit by reflections.
   */
  environment?(renderer: unknown): THREE.Texture;
};

type Mounted = {
  definition: ControlDefinition;
  cube: Awaited<ReturnType<typeof createWordCube>>;
  button: HTMLButtonElement;
  stops: (() => void)[];
  region: { left: number; top: number; width: number; height: number } | null;
};

const corner = new THREE.Vector3();
const box = new THREE.Box3();

/**
 * The control's current bounds on screen, from its actual transformed geometry, in host CSS px.
 * The camera maps one world unit to one CSS px with y up from the host's bottom edge.
 */
export function projectedRegion(
  object: THREE.Object3D,
  camera: THREE.Camera,
  host: { width: number; height: number },
): { left: number; top: number; width: number; height: number } | null {
  object.updateWorldMatrix(true, true);
  box.setFromObject(object);
  if (box.isEmpty()) return null;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      )
      .project(camera);
    const x = ((corner.x + 1) / 2) * host.width;
    const y = ((1 - corner.y) / 2) * host.height;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export async function createControlStage(
  host: ControlStageHost,
  definitions: readonly ControlDefinition[],
) {
  const document = host.element.ownerDocument;
  const renderer = host.createRenderer();
  renderer.setPixelRatio(Math.min(document.defaultView?.devicePixelRatio ?? 1, 2));
  const canvas = renderer.domElement;
  // Input arrives only through the controls' own hit regions.
  canvas.style.pointerEvents = "none";
  host.element.append(canvas);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.4, 0.8, 1);
  scene.add(key);
  // One world unit is one CSS px; deep enough that a turning cube never clips.
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -4000, 4000);
  camera.position.z = 2000;

  const size = { width: 1, height: 1 };
  const resize = () => {
    size.width = Math.max(1, host.element.clientWidth);
    size.height = Math.max(1, host.element.clientHeight);
    renderer.setSize(size.width, size.height, false);
    // The drawing buffer follows the pixel ratio; the displayed size is the host's, in CSS px.
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    camera.left = 0;
    camera.right = size.width;
    camera.top = 0;
    camera.bottom = -size.height;
    camera.updateProjectionMatrix();
  };
  resize();

  const environment = host.environment?.(renderer) ?? null;
  const mounted: Mounted[] = [];
  const router = createPointerRouter(() => mounted.map(({ cube }) => cube));
  for (const definition of definitions) {
    const cube = await createWordCube(definition.label, {
      id: `control-${definition.id}`,
      action: definition.action ?? "",
      enabled: definition.enabled ?? true,
      description: definition.description,
      ...(definition.disabledReason ? { disabledReason: definition.disabledReason } : {}),
      ...definition.cube,
    });
    if (environment) useStageReflections(cube.object, environment);
    scene.add(cube.object);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-stage-hit";
    button.textContent = definition.label;
    button.setAttribute("aria-label", definition.label);
    button.setAttribute("aria-description", definition.description);
    button.style.position = "absolute";
    button.style.opacity = "0";
    host.element.append(button);
    const entry: Mounted = { definition, cube, button, stops: [], region: null };
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
    ) => {
      button.addEventListener(type, listener);
      entry.stops.push(() => button.removeEventListener(type, listener));
    };
    on("pointerenter", (event) => router.move(cube, event.pointerType));
    on("pointerleave", () => router.leave());
    on("pointerdown", (event) => router.down(cube, event.pointerType));
    // A touch keeps implicit capture on the button, so its release may be anywhere: count it as
    // released on the control only when it is over the control's current region.
    on("pointerup", (event) =>
      router.up(within(entry, event.clientX, event.clientY) ? cube : null, event.pointerType),
    );
    // Keyboard focus is the hover of keyboard users: lift and describe it as a pointer would.
    // A pointer or touch press also focuses the button; that focus is the pointer's, whose own
    // hover already shows. The browser's own `:focus-visible` says which focus is which, whatever
    // order touch events and focus arrive in (#1202, #1234, #1241).
    let keyboardFocused = false;
    on("focus", () => {
      keyboardFocused = button.matches(":focus-visible");
      if (!keyboardFocused) return;
      cube.block.emit("input.enter");
      cube.block.emit("input.focus");
    });
    on("blur", () => {
      if (!keyboardFocused) return;
      keyboardFocused = false;
      cube.block.emit("input.blur");
      cube.block.emit("input.leave");
    });
    // Keyboard and assistive activation: one press and release, so one action, never a second
    // synthetic click after a pointer press (detail 0 marks a keyboard/assistive click).
    on("click", (event) => {
      if (event.detail !== 0) return;
      cube.block.emit("input.press");
      cube.block.emit("input.release");
    });
    mounted.push(entry);
  }

  /** Whether a client point is over the entry's current region. */
  const within = (entry: Mounted, x: number, y: number) => {
    const region = entry.region;
    if (!region) return false;
    const bounds = host.element.getBoundingClientRect();
    const left = region.left + bounds.left;
    const top = region.top + bounds.top;
    return x >= left && x <= left + region.width && y >= top && y <= top + region.height;
  };

  const place = () => {
    for (const entry of mounted) {
      const { x, y, size: edge } = entry.definition.layout(size);
      entry.cube.object.position.set(x, -y, 0);
      entry.cube.object.scale.setScalar(edge);
      entry.region = projectedRegion(entry.cube.object, camera, size);
      const { style } = entry.button;
      const region = entry.region;
      style.left = `${region?.left ?? 0}px`;
      style.top = `${region?.top ?? 0}px`;
      style.width = `${region?.width ?? 0}px`;
      style.height = `${region?.height ?? 0}px`;
    }
  };

  let frame: number | null = null;
  let last: number | null = null;
  let disposed = false;
  const tick = (now: number) => {
    const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    // A host laid out after the stage was made (shown later, reflowed) is measured again.
    if (
      Math.max(1, host.element.clientWidth) !== size.width ||
      Math.max(1, host.element.clientHeight) !== size.height
    )
      resize();
    for (const { cube } of mounted) cube.block.update(dt);
    place();
    renderer.render(scene, camera);
    frame = host.requestFrame(tick);
  };

  const find = (id: string) => mounted.find(({ definition }) => definition.id === id) ?? null;
  const client = (entry: Mounted) => {
    const bounds = host.element.getBoundingClientRect();
    return entry.region
      ? {
          ...entry.region,
          left: entry.region.left + bounds.left,
          top: entry.region.top + bounds.top,
        }
      : null;
  };

  place();
  return {
    /** Each control's root, for composition that needs its transform. */
    object(id: string): THREE.Object3D | null {
      return find(id)?.cube.object ?? null;
    },
    /** A control's cube (its block and root), for composition that wires its own traits. */
    cube(id: string) {
      return find(id)?.cube ?? null;
    },
    /** The control's current transformed bounds in client CSS px, or null when it has none. */
    hitRegion(id: string) {
      const entry = find(id);
      return entry ? client(entry) : null;
    },
    /** Where a flight to this control should land: its current centre, client CSS px. */
    destinationAnchor(id: string): { x: number; y: number } | null {
      const entry = find(id);
      const region = entry && client(entry);
      return region
        ? { x: region.left + region.width / 2, y: region.top + region.height / 2 }
        : null;
    },
    /**
     * An existing drop target bound to this control: hit only over its current region, otherwise
     * unchanged. The binding keeps every rule; the stage adds geometry, not policy.
     */
    dropTarget(id: string, binding: DropTarget): DropTarget {
      return {
        ...binding,
        canDrop: (carried, x, y) => {
          const entry = find(id);
          const region = entry && client(entry);
          if (
            !region ||
            x < region.left ||
            x > region.left + region.width ||
            y < region.top ||
            y > region.top + region.height
          )
            return null;
          return binding.canDrop(carried, x, y);
        },
      };
    },
    /** Availability comes from the owning controller; the cube's own traits present it. */
    setEnabled(id: string, enabled: boolean, reason?: string) {
      const entry = find(id);
      if (!entry) return;
      entry.button.disabled = !enabled;
      entry.cube.block.emit("input.enabled", reason === undefined ? enabled : { enabled, reason });
    },
    /** The reduced-motion preference changed: every control's motion follows it (#1291). */
    setReducedMotion(reduced: boolean) {
      for (const { cube } of mounted) cube.block.emit("motion.reduced", reduced);
    },
    /** Listen for a control's dispatched action; returns an unsubscribe. */
    onAction(listener: (action: string, id: string) => void): () => void {
      const stops = mounted.map((entry) =>
        entry.cube.block.on("menu.action", (action) =>
          listener(String(action), entry.definition.id),
        ),
      );
      return () => stops.forEach((stop) => stop());
    },
    resize() {
      resize();
      place();
    },
    /** Draw and move. Starting twice keeps one loop. */
    resume() {
      if (disposed || frame !== null) return;
      last = null;
      frame = host.requestFrame(tick);
    },
    /** Covered: no drawing, no motion; resuming continues without catching up. */
    cover() {
      if (frame !== null) host.cancelFrame(frame);
      frame = null;
      router.leave();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) host.cancelFrame(frame);
      frame = null;
      for (const entry of mounted) {
        entry.stops.forEach((stop) => stop());
        entry.button.remove();
        entry.cube.dispose();
      }
      mounted.length = 0;
      environment?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export type ControlStage = Awaited<ReturnType<typeof createControlStage>>;
