import * as THREE from "three";
import { tweenValue } from "./easing";
import "./passive-rack.css";
import { passiveAppearance, type PassiveBlock } from "./passives";
import { createPassiveVisual } from "./passive-visual";

const slotWidth = 72;
const slotGap = 8;
const canvasHeight = 76;
const cubeSize = 1.45;

type RenderedPassive = {
  id: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  textures: THREE.CanvasTexture[];
  targetX: number;
  arrivalAt: number | null;
  item: HTMLElement;
};

/** A fixed screen-space rack with one Three.js scene for all rotating passive blocks. */
export function createPassiveRack(
  host: HTMLElement,
  options: {
    /** How many slots the rack shows; empty ones are drawn as outlines. */
    capacity?: number;
    /** A pointer went down on an installed passive (the start of a possible drag). */
    onPickUp?(block: PassiveBlock, event: PointerEvent): void;
  } = {},
): {
  element: HTMLElement;
  /** Change the number of visible slots for the active mode. */
  setCapacity(capacity: number): void;
  render(rack: readonly PassiveBlock[]): void;
  /** Hide one passive's cube while it is being dragged (null shows them all). */
  lift(id: string | null): void;
  /** The rack slot under a screen point (clamped to the filled slots), or null off the rack. */
  slotAt(clientX: number, clientY: number): number | null;
  /** Glide the cubes into this order while a reorder is previewed; null restores the rack. */
  preview(order: readonly string[] | null): void;
  frame(time: number, reducedMotion: boolean): void;
  dispose(): void;
} {
  const element = document.createElement("aside");
  element.className = "passive-rack";
  element.setAttribute("aria-label", "Passive rack");
  element.innerHTML =
    '<span class="passive-rack-title">PASSIVES</span><div class="passive-rack-slots"></div>';
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
  let capacity = options.capacity ?? 1;
  const slotX = (index: number) =>
    (index - (slotCount - 1) / 2) * ((2.3 * (slotWidth + slotGap)) / canvasHeight);
  const place = (ids: readonly string[]) => {
    for (const [index, id] of ids.entries()) {
      const entry = rendered.get(id);
      if (entry) entry.targetX = slotX(index);
    }
  };

  const clear = () => {
    for (const { mesh, edges, textures } of rendered.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.forEach((material) => material.dispose());
      edges.material.dispose();
      edges.geometry.dispose();
      textures.forEach((texture) => texture.dispose());
    }
    rendered.clear();
  };

  return {
    element,
    setCapacity(nextCapacity) {
      capacity = Math.max(1, nextCapacity);
    },
    render(rack) {
      const ids = new Set(rack.map(({ id }) => id));
      for (const [id, entry] of rendered) {
        if (ids.has(id)) continue;
        scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.forEach((material) => material.dispose());
        entry.edges.material.dispose();
        entry.edges.geometry.dispose();
        entry.textures.forEach((texture) => texture.dispose());
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
          item.addEventListener("pointerdown", (event) => options.onPickUp?.(block, event));
          const description = document.createElement("span");
          description.className = "passive-description";
          description.textContent = block.traits.inspectable.inspect();
          item.append(description);
          entry = {
            id: block.id,
            mesh,
            edges,
            textures: visual.textures,
            targetX: 0,
            arrivalAt: performance.now() + arrivals++ * 180,
            item,
          };
          rendered.set(block.id, entry);
          mesh.scale.setScalar(0.001);
        }
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
    dispose() {
      clear();
      renderer.dispose();
      element.remove();
    },
  };
}
