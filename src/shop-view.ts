import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clamp01, easeInOutCubic, lerp } from "./easing";
import { playSfx } from "./audio/sfx";
import { cardName } from "./cards";
import { getMaterialDefinition, materialOf } from "./materials";
import { createPassiveVisual } from "./passive-visual";
import { passiveAppearance, passiveDefinitions } from "./passives";
import type { ShopOffer } from "./shop-stock";
import { offerKind, type OfferBlock, type OfferDestination } from "./offer-kinds";
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import type { PassiveBlock } from "./passives";
import { createBlockAppearance } from "./visual/block-appearance";
import { createMaterialise } from "./visual/materialise";
import "./shop-view.css";

type DisplayedOffer = {
  item: HTMLElement;
  slot: HTMLElement;
  cube: THREE.Object3D;
  dispose(): void;
};

type Entrance = { startedAt: number; landed: Set<number> };

export type ShopView = {
  /** The shop's purchase drop target, placed by the shared HUD frame. */
  readonly buyTarget: HTMLElement;
  render(offers: readonly ShopOffer[], visible: boolean, animateEntrance?: boolean): void;
  burnUnsold(reducedMotion: boolean): Promise<void>;
  frame(): void;
  dispose(): void;
};

type OfferCube = { cube: THREE.Object3D; dispose(): void };

/** How the shop draws and names one kind of offer (#67); the rules are in src/offer-kinds.ts. */
export type OfferView<Block extends OfferBlock> = {
  cube(block: Block): OfferCube;
  name(block: Block): string;
  /** Its inspection text, shown on hover and read out. */
  describe(block: Block): string;
  /** A class for the offer's button. */
  className: string;
};

const offerViews = new Registry<OfferView<OfferBlock>>("offer view");

/** Register how a kind of offer looks in the shop. */
export function registerOfferView<Block extends OfferBlock>(
  name: string,
  view: OfferView<Block>,
): void {
  offerViews.register(name, view as unknown as OfferView<OfferBlock>);
}

/** A price in words: "1 coin", "4 coins". */
const coins = (amount: number) => `${amount} coin${amount === 1 ? "" : "s"}`;

/** What each destination is called in an offer's description. */
const destinationLabels: Record<OfferDestination, string> = {
  hand: "BUY to add to the deck",
  "passive-rack": "BUY to install in the passive rack",
};

/** A passive offer's token: its own shape and faces (src/passive-visual.ts). */
function passiveCube(block: PassiveBlock): OfferCube {
  const appearance = passiveAppearance(block);
  const visual = createPassiveVisual(appearance, 1.35);
  const mesh = new THREE.Mesh(visual.geometry, visual.materials);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: appearance.palette.edge });
  mesh.add(new THREE.LineSegments(visual.edges, edgeMaterial));
  return {
    cube: mesh,
    dispose: () => {
      visual.dispose();
      edgeMaterial.dispose();
    },
  };
}

/** A card offer's cube: the same appearance as a card on the table. */
function cardCube(block: CardBlock): OfferCube {
  const appearance = createBlockAppearance(
    block.traits.identity,
    getMaterialDefinition(materialOf(block)),
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

registerOfferView<CardBlock>("card", {
  cube: cardCube,
  name: (block) => cardName(block.traits.identity),
  describe: (block) => block.traits.inspectable?.inspect() ?? cardName(block.traits.identity),
  className: "is-card",
});

registerOfferView<PassiveBlock>("passive", {
  cube: passiveCube,
  name: (block) => passiveDefinitions.get(block.definitionId).name,
  describe: (block) => block.traits.inspectable.inspect(),
  className: "is-passive",
});

/** Shop stock is drawn with the same real cube appearances as cards and installed passives. */
export function createShopView(
  host: HTMLElement,
  rack: HTMLElement | null,
  price: (offer: ShopOffer) => number,
  buy: (id: string, destination: OfferDestination) => boolean,
  onEntranceDone: () => void,
  deckSize: () => number,
  reducedMotion: () => boolean,
): ShopView {
  const stock = document.createElement("section");
  stock.className = "shop-stock";
  stock.setAttribute("aria-label", "Shop stock");
  const buyTarget = document.createElement("div");
  buyTarget.className = "shop-buy-target";
  buyTarget.setAttribute("aria-label", "Buy offer");
  buyTarget.innerHTML =
    "<strong>BUY</strong><span>Cards to deck · Passives to rack</span><small></small>";
  host.append(stock, buyTarget);
  const sign = document.createElement("div");
  sign.className = "shop-open-sign";
  sign.textContent = "SHOP OPEN";
  sign.setAttribute("aria-hidden", "true");
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "shop-entrance-skip";
  skip.textContent = "Skip entrance";
  skip.hidden = true;
  skip.addEventListener("click", () => {
    finishEntrance();
    frame();
  });
  host.append(sign, skip);

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
  // The shop draws on its own WebGL context, so it can't use the table's prefiltered
  // reflections: a metal offer would reflect nothing and look black (#200). It prefilters the
  // same studio room for itself.
  const reflections = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
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
  let entrance: Entrance | null = null;
  const pixelsPerUnit = 50;
  let canvasWidth = 0;
  let canvasHeight = 0;

  function clear(): void {
    finishEntrance();
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

  function finishEntrance(): void {
    const wasEntering = entrance !== null;
    entrance = null;
    stock.inert = false;
    stock.classList.remove("is-entering");
    sign.classList.remove("is-visible");
    skip.hidden = true;
    if (wasEntering) onEntranceDone();
  }

  function makeCube(offer: ShopOffer): { cube: THREE.Object3D; dispose(): void } {
    return offerViews.get(offer.kind).cube(offer.block);
  }

  const contains = (element: HTMLElement | null, x: number, y: number) => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  };

  /** A bought offer travels to the deck badge or the installed-passive rack. */
  function animatePurchase(from: DOMRect, label: string, destination: OfferDestination): void {
    if (reducedMotion()) return;
    const target =
      destination === "passive-rack" && rack ? rack : buyTarget.querySelector("small")!;
    const to = target.getBoundingClientRect();
    const flight = document.createElement("div");
    flight.className = "shop-purchase-flight";
    flight.textContent = label;
    flight.style.left = `${from.left + from.width / 2}px`;
    flight.style.top = `${from.top + from.height / 2}px`;
    document.body.append(flight);
    const dx = to.left + to.width / 2 - from.left - from.width / 2;
    const dy = to.top + to.height / 2 - from.top - from.height / 2;
    const animation = flight.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.25 },
      ],
      { duration: 480, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" },
    );
    void animation.finished.then(
      () => flight.remove(),
      () => flight.remove(),
    );
  }

  function render(offers: readonly ShopOffer[], visible: boolean, animateEntrance = false): void {
    stock.hidden = buyTarget.hidden = renderer.domElement.hidden = !visible;
    buyTarget.querySelector("small")!.textContent = `DECK ${deckSize()}`;
    clear();
    stock.replaceChildren();
    stock.classList.remove("is-burning");
    if (!visible) return;
    for (const offer of offers) {
      const view = offerViews.get(offer.kind);
      const name = view.name(offer.block);
      const description = view.describe(offer.block);
      const destination = destinationLabels[offerKind(offer).destination];
      const item = document.createElement("button");
      item.type = "button";
      item.className = `shop-offer ${view.className}`;
      item.setAttribute(
        "aria-label",
        `${description}, ${coins(price(offer))}, drag to ${destination}`,
      );
      const slot = document.createElement("span");
      slot.className = "shop-cube-slot";
      const label = document.createElement("span");
      label.className = "shop-offer-label";
      label.textContent = `${name} · ${coins(price(offer))}`;
      const tooltip = document.createElement("span");
      tooltip.className = "shop-offer-description";
      tooltip.textContent = description;
      item.append(slot, label, tooltip);
      const cube = makeCube(offer);
      cube.cube.rotation.set(-0.34, 0.48, 0);
      reflectInShop(cube.cube, reflections.texture);
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
          const destination = offerKind(offer).destination;
          const from = item.getBoundingClientRect();
          const label = item.querySelector(".shop-offer-label")!.textContent ?? "";
          if (!contains(buyTarget, end.clientX, end.clientY) || !buy(offer.block.id, destination)) {
            cancel();
            return;
          }
          animatePurchase(from, label, destination);
          cancel();
        };
        item.addEventListener("pointermove", move);
        item.addEventListener("pointerup", finish);
        item.addEventListener("pointercancel", cancel);
      });
      stock.append(item);
    }
    if (animateEntrance && displayed.length > 0) {
      entrance = { startedAt: performance.now(), landed: new Set() };
      stock.inert = true;
      stock.classList.add("is-entering");
      sign.classList.add("is-visible");
      skip.hidden = false;
      playSfx("shop.stock.toss");
    }
    frame();
  }

  /** Stagger the unsold offers' Perlin burn-out across roughly 1.5 seconds. */
  function burnUnsold(reducedMotion: boolean): Promise<void> {
    finishEntrance();
    if (burnPromise) return burnPromise;
    if (displayed.length === 0) {
      render([], false);
      return Promise.resolve();
    }
    stock.classList.add("is-burning");
    buyTarget.hidden = true;
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
    const elapsed = entrance ? performance.now() - entrance.startedAt : 0;
    const cameraProgress = easeInOutCubic(clamp01(elapsed / 1700));
    camera.position.set(
      entrance ? lerp(-1.7, 0, cameraProgress) : 0,
      entrance ? lerp(3.2, 0, cameraProgress) : 0,
      15,
    );
    camera.lookAt(camera.position.x, camera.position.y, 0);
    for (const [index, entry] of displayed.entries()) {
      const slot = entry.slot.getBoundingClientRect();
      const x = (slot.left + slot.width / 2 - bounds.left - width / 2) / pixelsPerUnit;
      const y = (height / 2 - (slot.top + slot.height / 2 - bounds.top)) / pixelsPerUnit;
      if (!entrance) {
        entry.cube.position.set(x, y, 0);
        entry.cube.rotation.set(-0.34, 0.48, 0);
        continue;
      }
      const start = 470 + index * 155;
      const progress = clamp01((elapsed - start) / 830);
      const travel = easeInOutCubic(progress);
      const bounce = progress < 0.72 ? 0 : Math.sin(((progress - 0.72) / 0.28) * Math.PI) * 0.25;
      entry.cube.position.set(
        x + lerp(index % 2 ? 2.1 : -2.1, 0, travel),
        y + lerp(5.3, 0, travel) + bounce,
        0,
      );
      entry.cube.rotation.set(
        -0.34 + (1 - travel) * (index + 1) * 1.4,
        0.48 + (1 - travel) * (index + 1) * 2.1,
        (1 - travel) * 1.8,
      );
      if (progress === 1 && !entrance.landed.has(index)) {
        entrance.landed.add(index);
        playSfx("shop.stock.land");
      }
    }
    if (entrance) {
      sign.style.setProperty(
        "--shop-sign-offset",
        `${lerp(-110, 0, easeInOutCubic(clamp01(elapsed / 850)))}vh`,
      );
      // The sign fades out as the last offer lands, so it never vanishes mid-fade.
      const landedAt = 470 + (displayed.length - 1) * 155 + 830;
      sign.style.opacity = String(clamp01((landedAt - elapsed) / 350));
      if (elapsed >= landedAt) finishEntrance();
    }
    renderer.render(scene, camera);
  }

  return {
    buyTarget,
    render,
    burnUnsold,
    frame,
    dispose: () => {
      clear();
      reflections.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stock.remove();
      buyTarget.remove();
      sign.remove();
      skip.remove();
    },
  };
}

/** Point every reflective material in an offer at the shop's own reflections (#200). */
function reflectInShop(object: THREE.Object3D, environment: THREE.Texture): void {
  object.traverse((child) => {
    const materials = (child as THREE.Mesh).material;
    for (const material of [materials].flat())
      if (material && "envMap" in material && material.envMap) {
        material.envMap = environment;
        material.needsUpdate = true;
      }
  });
}
