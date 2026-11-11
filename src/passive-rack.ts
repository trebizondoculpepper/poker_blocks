import { Registry } from "./core/registry";
import * as THREE from "three";
import { tweenValue } from "./easing";
import "./passive-rack.css";
import { passiveAppearance, type PassiveBlock } from "./passives";
import { createPassiveVisual, type PassiveVisual } from "./passive-visual";
import { categoryDefaults } from "./passive-categories";
import { applyGlow, tokenEffects } from "./passive-activation-effects";
import { playSfx } from "./audio/sfx";

const slotWidth = 72;
const slotGap = 8;
const canvasHeight = 76;
const cubeSize = 1.45;

type RenderedPassive = {
  id: string;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  visual: PassiveVisual;
  targetX: number;
  arrivalAt: number | null;
  item: HTMLElement;
  block: PassiveBlock;
  /** When its activation effect started, while one is playing. */
  activatedAt: number | null;
};

/**
 * Badges a rack item shows, keyed by trait name (#391): each trait that registers one draws it
 * from its own value. The rack never asks what kind of item it holds.
 */
export const rackBadges = new Registry<(value: unknown) => HTMLElement>("rack badge");

function rackBadgesFor(block: PassiveBlock): HTMLElement[] {
  return Object.entries(block.traits).flatMap(([trait, value]) =>
    rackBadges.has(trait) ? [rackBadges.get(trait)(value)] : [],
  );
}

/**
 * A clock-like dial of uses left (#384): full when unused, a half-moon after one of two uses.
 * It shows charges, not a cooldown.
 */
rackBadges.register("limitedUse", (value) => {
  const { uses, total } = value as { uses: number; total: number };
  const dial = document.createElement("span");
  dial.className = "rack-badge rack-charges";
  dial.style.setProperty("--charge", `${(uses / total) * 360}deg`);
  dial.setAttribute("aria-label", `${uses} of ${total} uses left`);
  dial.title = `${uses} of ${total} uses left`;
  return dial;
});

/** One frame of a token's activation effect, from its category's config; then back to rest. */
function activationFrame(entry: RenderedPassive, time: number, reducedMotion: boolean): void {
  if (entry.activatedAt === null) return;
  const { effect } = categoryDefaults(entry.block.traits).activation;
  const handler = tokenEffects.get(effect.id);
  const progress = (time - entry.activatedAt) / handler.milliseconds;
  const done = progress >= 1;
  const { scale, glow } = done ? { scale: 1, glow: 0 } : handler.frame(progress, reducedMotion);
  entry.mesh.scale.multiplyScalar(scale);
  applyGlow(entry.visual.materials, effect.colour, glow);
  if (done) entry.activatedAt = null;
}

/** A fixed screen-space rack with one Three.js scene for all rotating passive blocks. */
export function createPassiveRack(host: HTMLElement): {
  element: HTMLElement;
  /**
   * A scene composing `passiveRackView` came to the front, or left (#187). The rack is shown,
   * with `capacity` slots, while any such scene is on the stack.
   */
  viewEntered(entered: boolean, capacity: number): void;
  render(rack: readonly PassiveBlock[]): void;
  /** Hide one passive's cube while it is being dragged (null shows them all). */
  lift(id: string | null): void;
  /** The installed passive under a screen point, or null (the rack's drag source picks it). */
  blockAt(clientX: number, clientY: number): PassiveBlock | null;
  /** The rack slot under a screen point (clamped to the filled slots), or null off the rack. */
  slotAt(clientX: number, clientY: number): number | null;
  /** Glide the cubes into this order while a reorder is previewed; null restores the rack. */
  preview(order: readonly string[] | null): void;
  frame(time: number, reducedMotion: boolean): void;
  /**
   * A rule from this source fired: if it is an installed passive, play its category's
   * activation effect and sound. Other sources (a card's own rules) are not in the rack.
   */
  activate(sourceId: string): void;
  dispose(): void;
} {
  const element = document.createElement("aside");
  element.className = "passive-rack";
  element.setAttribute("aria-label", "Items");
  element.innerHTML =
    '<span class="passive-rack-title">ITEMS</span><div class="passive-rack-slots"></div>';
  // Hidden until a scene composing `passiveRackView` comes to the front (#187).
  element.hidden = true;
  host.append(element);
  const slots = element.querySelector<HTMLElement>(".passive-rack-slots")!;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x728091, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(-3, 5, 7);
  scene.add(keyLight);
  // The whole-window screenshot clones this canvas as part of the DOM overlay.
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "passive-rack-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  const camera = new THREE.OrthographicCamera(-1, 1, 1.15, -1.15, 0.1, 30);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  const rendered = new Map<string, RenderedPassive>();
  let liftedId: string | null = null;
  let order: string[] = [];
  let slotCount = 1;
  let capacity = 1;
  /** How many scenes in front compose `passiveRackView`. */
  let viewScenes = 0;
  /** The rack last rendered, so a change of slots redraws it. */
  let shown: readonly PassiveBlock[] = [];
  const slotX = (index: number) =>
    (index - (slotCount - 1) / 2) * ((2.3 * (slotWidth + slotGap)) / canvasHeight);
  const place = (ids: readonly string[]) => {
    for (const [index, id] of ids.entries()) {
      const entry = rendered.get(id);
      if (entry) entry.targetX = slotX(index);
    }
  };

  const remove = (entry: RenderedPassive) => {
    scene.remove(entry.mesh);
    entry.edges.material.dispose();
    entry.visual.dispose();
  };
  const clear = () => {
    for (const entry of rendered.values()) remove(entry);
    rendered.clear();
  };

  return {
    element,
    viewEntered(entered, nextCapacity) {
      viewScenes = Math.max(0, viewScenes + (entered ? 1 : -1));
      element.hidden = viewScenes === 0;
      capacity = Math.max(1, nextCapacity);
      this.render(shown);
    },
    render(rack) {
      shown = rack;
      const ids = new Set(rack.map(({ id }) => id));
      for (const [id, entry] of rendered) {
        if (ids.has(id)) continue;
        remove(entry);
        rendered.delete(id);
      }
      // GameMode for every slot the rack has, filled or not.
      slotCount = Math.max(rack.length, capacity, 1);
      order = rack.map(({ id }) => id);
      const width = slotCount * slotWidth + (slotCount - 1) * slotGap;
      renderer.setSize(width, canvasHeight, false);
      camera.left = (-width / canvasHeight) * 1.15;
      camera.right = (width / canvasHeight) * 1.15;
      camera.updateProjectionMatrix();
      slots.replaceChildren(renderer.domElement);
      let arrivals = 0;
      for (const [index, block] of rack.entries()) {
        let entry = rendered.get(block.id);
        if (!entry) {
          const appearance = passiveAppearance(block);
          const visual = createPassiveVisual(appearance, cubeSize);
          const mesh = new THREE.Mesh(visual.geometry, visual.materials);
          mesh.add(...(visual.extras ?? []));
          const edges = new THREE.LineSegments(
            visual.edges,
            new THREE.LineBasicMaterial({ color: appearance.palette.edge }),
          );
          mesh.add(edges);
          scene.add(mesh);
          const item = document.createElement("div");
          item.className = "passive-item";
          item.setAttribute("role", "img");
          item.setAttribute("aria-label", block.traits.inspectable.inspect());
          item.tabIndex = 0;
          item.dataset.passiveId = block.id;
          const description = document.createElement("span");
          description.className = "passive-description";
          description.textContent = block.traits.inspectable.inspect();
          item.append(description);
          entry = {
            id: block.id,
            mesh,
            edges,
            visual,
            targetX: 0,
            arrivalAt: performance.now() + arrivals++ * 180,
            item,
            block,
            activatedAt: null,
          };
          rendered.set(block.id, entry);
          mesh.scale.setScalar(0.001);
        }
        // Badges from the item's traits (a transmogrifier's charge dial, #391), redrawn each
        // render so they follow the item's state.
        entry.item.querySelectorAll(".rack-badge").forEach((badge) => badge.remove());
        entry.item.append(...rackBadgesFor(block));
        entry.item.setAttribute("aria-label", block.traits.inspectable.inspect());
        entry.item.dataset.passiveId = block.id;
        entry.block = block;
        entry.targetX = slotX(index);
        if (entry.mesh.scale.x === 0.001) entry.mesh.position.x = entry.targetX + 0.65;
        slots.append(entry.item);
      }
      for (let empty = rack.length; empty < slotCount; empty++) {
        const slot = document.createElement("div");
        slot.className = "passive-item passive-empty";
        slot.setAttribute("aria-label", "Empty passive slot");
        slots.append(slot);
      }
      renderer.render(scene, camera);
    },
    lift(id) {
      liftedId = id;
      for (const passive of rendered.values()) passive.mesh.visible = passive.id !== id;
      renderer.render(scene, camera);
    },
    blockAt(clientX, clientY) {
      for (const passive of rendered.values()) {
        const box = passive.item.getBoundingClientRect();
        if (
          clientX >= box.left &&
          clientX <= box.right &&
          clientY >= box.top &&
          clientY <= box.bottom
        )
          return passive.block;
      }
      return null;
    },
    slotAt(clientX, clientY) {
      const bounds = element.getBoundingClientRect();
      if (
        order.length === 0 ||
        clientX < bounds.left ||
        clientX > bounds.right ||
        clientY < bounds.top ||
        clientY > bounds.bottom
      )
        return null;
      const canvas = renderer.domElement.getBoundingClientRect();
      const slot = Math.floor(((clientX - canvas.left) / canvas.width) * slotCount);
      return Math.max(0, Math.min(order.length - 1, slot));
    },
    preview(next) {
      place(next ?? order);
    },
    frame(time, reducedMotion) {
      for (const [index, entry] of [...rendered.values()].entries()) {
        const { mesh, targetX, arrivalAt, item } = entry;
        const arrived = arrivalAt === null || time >= arrivalAt || reducedMotion;
        mesh.visible = arrived && entry.id !== liftedId;
        item.style.visibility = arrived ? "" : "hidden";
        if (arrived) {
          mesh.position.x += (targetX - mesh.position.x) * (reducedMotion ? 1 : 0.18);
          mesh.scale.setScalar(
            arrivalAt === null || reducedMotion ? 1 : tweenValue(0.001, 1, time - arrivalAt, 360),
          );
          if (arrivalAt !== null && (reducedMotion || time - arrivalAt >= 360))
            entry.arrivalAt = null;
          activationFrame(entry, time, reducedMotion);
        }
        const angle = reducedMotion ? 0 : time * 0.00028;
        mesh.rotation.set(
          0.28 + (reducedMotion ? 0 : Math.sin(time * 0.00037 + index) * 0.12),
          0.48 + angle,
          0,
        );
      }
      if (rendered.size) renderer.render(scene, camera);
    },
    activate(sourceId) {
      const entry = rendered.get(sourceId);
      if (!entry) return;
      entry.activatedAt = performance.now();
      playSfx(categoryDefaults(entry.block.traits).activation.sfx);
    },
    dispose() {
      clear();
      renderer.dispose();
      element.remove();
    },
  };
}
