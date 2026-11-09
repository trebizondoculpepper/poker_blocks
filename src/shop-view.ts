import * as THREE from "three";
import { cardName } from "./cards";
import { materialOf } from "./materials";
import { passiveFaceTexture } from "./passive-rack";
import { passiveDefinitions } from "./passives";
import type { ShopOffer } from "./shop-stock";
import { createBlockAppearance } from "./visual/block-appearance";
import { createMaterialise } from "./visual/materialise";
import "./shop-view.css";

type Destination = "hand" | "passive-rack";
type DisplayedOffer = {
  item: HTMLElement;
  slot: HTMLElement;
  cube: THREE.Object3D;
  dispose(): void;
};

/** Shop stock is drawn with the same real cube appearances as cards and installed passives. */
export function createShopView(
  host: HTMLElement,
  rack: HTMLElement | null,
  price: (offer: ShopOffer) => number,
  buy: (id: string, destination: Destination) => boolean,
) {
  const stock = document.createElement("section");
  stock.className = "shop-stock";
  stock.setAttribute("aria-label", "Shop stock");
  const handTarget = document.createElement("div");
  handTarget.className = "shop-hand-target";
  handTarget.textContent = "DROP PLAYABLE BLOCKS INTO HAND";
  host.append(stock, handTarget);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x788091, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(-3, 5, 8);
  scene.add(keyLight);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  camera.position.z = 15;
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "shop-cubes-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);
  const displayed: DisplayedOffer[] = [];
  let burn: {
    startedAt: number;
    seconds: number;
    reduced: boolean;
    jobs: {
      entry: DisplayedOffer;
      delay: number;
      lastAt: number;
      effect?: ReturnType<typeof createMaterialise>;
    }[];
    resolve(): void;
  } | null = null;
  let burnPromise: Promise<void> | null = null;
  const pixelsPerUnit = 50;
  let canvasWidth = 0;
  let canvasHeight = 0;

  function clear(): void {
    for (const job of burn?.jobs ?? []) job.effect?.finish();
    burn?.resolve();
    burn = null;
    burnPromise = null;
    for (const entry of displayed) {
      scene.remove(entry.cube);
      entry.dispose();
    }
    displayed.length = 0;
  }

  function makeCube(offer: ShopOffer): { cube: THREE.Object3D; dispose(): void } {
    if (offer.kind === "passive") {
      const appearance =
        offer.block.traits.appearance ?? passiveDefinitions.get(offer.block.definitionId);
      const texture = passiveFaceTexture(appearance);
      const geometry = new THREE.BoxGeometry(1.35, 1.35, 1.35);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.7,
        metalness: 0.12,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const edgeGeometry = new THREE.EdgesGeometry(geometry);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: appearance.palette.edge });
      mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
      return {
        cube: mesh,
        dispose: () => {
          texture.dispose();
          geometry.dispose();
          material.dispose();
          edgeGeometry.dispose();
          edgeMaterial.dispose();
        },
      };
    }
    const appearance = createBlockAppearance(
      offer.block.traits.identity,
      materialOf(offer.block),
      1.35,
    );
    const mesh = new THREE.Mesh(appearance.geometry, appearance.materials);
    const edgeGeometry = new THREE.EdgesGeometry(appearance.geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: appearance.edgeColor,
      transparent: appearance.edgeOpacity < 1,
      opacity: appearance.edgeOpacity,
    });
    mesh.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));
    for (const extra of appearance.extras ?? []) mesh.add(extra);
    return {
      cube: mesh,
      dispose: () => {
        appearance.geometry.dispose();
        for (const texture of appearance.textures) texture.dispose();
        for (const material of new Set([
          ...appearance.materials,
          ...(appearance.boardMaterials ?? []),
        ]))
          material.dispose();
        for (const extra of appearance.extras ?? []) {
          for (const material of ([] as THREE.Material[]).concat(extra.material)) {
            (material as THREE.MeshStandardMaterial).map?.dispose();
            material.dispose();
          }
        }
        edgeGeometry.dispose();
        edgeMaterial.dispose();
      },
    };
  }

  const contains = (element: HTMLElement | null, x: number, y: number) => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  };

  function render(offers: readonly ShopOffer[], visible: boolean): void {
    stock.hidden = handTarget.hidden = renderer.domElement.hidden = !visible;
    clear();
    stock.replaceChildren();
    stock.classList.remove("is-burning");
    if (!visible) return;
    for (const offer of offers) {
      const passive = offer.kind === "passive";
      const definition = passive ? passiveDefinitions.get(offer.block.definitionId) : null;
      const name = passive ? definition!.name : cardName(offer.block.traits.identity);
      const description = offer.block.traits.inspectable?.inspect() ?? name;
      const item = document.createElement("button");
      item.type = "button";
      item.className = `shop-offer ${passive ? "is-passive" : "is-card"}`;
      item.setAttribute(
        "aria-label",
        `${description}, ${price(offer)} coin, drag to ${passive ? "passive rack" : "hand"}`,
      );
      const slot = document.createElement("span");
      slot.className = "shop-cube-slot";
      const label = document.createElement("span");
      label.className = "shop-offer-label";
      label.textContent = `${name} · ${price(offer)} coin`;
      const tooltip = document.createElement("span");
      tooltip.className = "shop-offer-description";
      tooltip.textContent = description;
      item.append(slot, label, tooltip);
      const cube = makeCube(offer);
      cube.cube.rotation.set(-0.34, 0.48, 0);
      scene.add(cube.cube);
      displayed.push({ item, slot, ...cube });
      item.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        item.setPointerCapture(event.pointerId);
        item.classList.add("is-dragging");
        const x = event.clientX;
        const y = event.clientY;
        const move = (next: PointerEvent) => {
          item.style.translate = `${next.clientX - x}px ${next.clientY - y}px`;
        };
        const cancel = () => {
          item.removeEventListener("pointermove", move);
          item.removeEventListener("pointerup", finish);
          item.removeEventListener("pointercancel", cancel);
          item.style.translate = "";
          item.classList.remove("is-dragging");
        };
        const finish = (end: PointerEvent) => {
          item.removeEventListener("pointermove", move);
          item.removeEventListener("pointerup", finish);
          item.removeEventListener("pointercancel", cancel);
          if (burn) {
            cancel();
            return;
          }
          const destination = contains(rack, end.clientX, end.clientY)
            ? "passive-rack"
            : contains(handTarget, end.clientX, end.clientY)
              ? "hand"
              : null;
          if (!destination || !buy(offer.block.id, destination)) cancel();
        };
        item.addEventListener("pointermove", move);
        item.addEventListener("pointerup", finish);
        item.addEventListener("pointercancel", cancel);
      });
      stock.append(item);
    }
    frame();
  }

  /** Stagger the unsold offers' Perlin burn-out across roughly 1.5 seconds. */
  function burnUnsold(reducedMotion: boolean): Promise<void> {
    if (burnPromise) return burnPromise;
    if (displayed.length === 0) {
      render([], false);
      return Promise.resolve();
    }
    stock.classList.add("is-burning");
    handTarget.hidden = true;
    const seconds = reducedMotion ? 0.4 : displayed.length === 1 ? 1.5 : 1.05;
    const stagger = reducedMotion || displayed.length === 1 ? 0 : 0.45 / (displayed.length - 1);
    burnPromise = new Promise((resolve) => {
      burn = {
        startedAt: performance.now(),
        seconds,
        reduced: reducedMotion,
        jobs: displayed.map((entry, index) => ({
          entry,
          delay: index * stagger * 1000,
          lastAt: 0,
        })),
        resolve,
      };
    });
    return burnPromise;
  }

  function frame(): void {
    if (renderer.domElement.hidden) return;
    if (burn) {
      const now = performance.now();
      for (const job of burn.jobs) {
        if (now < burn.startedAt + job.delay) continue;
        if (!job.effect) {
          job.entry.item.classList.add("is-burning");
          job.entry.cube.traverse((part) => {
            if (part instanceof THREE.LineSegments) part.visible = false;
          });
          job.effect = createMaterialise(job.entry.cube, {
            seconds: burn.seconds,
            reduced: burn.reduced,
            out: true,
          });
          job.lastAt = now;
        }
        job.effect.update((now - job.lastAt) / 1000);
        job.lastAt = now;
      }
      if (burn.jobs.every(({ effect }) => effect && !effect.running)) {
        render([], false);
        return;
      }
    }
    const bounds = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (width !== canvasWidth || height !== canvasHeight) {
      canvasWidth = width;
      canvasHeight = height;
      renderer.setSize(width, height, false);
      camera.left = -width / (2 * pixelsPerUnit);
      camera.right = width / (2 * pixelsPerUnit);
      camera.top = height / (2 * pixelsPerUnit);
      camera.bottom = -height / (2 * pixelsPerUnit);
      camera.updateProjectionMatrix();
    }
    for (const entry of displayed) {
      const slot = entry.slot.getBoundingClientRect();
      entry.cube.position.set(
        (slot.left + slot.width / 2 - bounds.left - width / 2) / pixelsPerUnit,
        (height / 2 - (slot.top + slot.height / 2 - bounds.top)) / pixelsPerUnit,
        0,
      );
    }
    renderer.render(scene, camera);
  }

  return {
    render,
    burnUnsold,
    frame,
    dispose: () => {
      clear();
      renderer.dispose();
      renderer.domElement.remove();
      stock.remove();
      handTarget.remove();
    },
  };
}
