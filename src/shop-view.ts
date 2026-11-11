import { cardFaceArt } from "./visual/face-art";
import { cardLook } from "./card-look";
import { createScatterPlacer } from "./shop-scatter";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clamp01, easeInOutCubic, lerp } from "./easing";
import { playSfx } from "./audio/sfx";
import { cardName } from "./cards";
import { createPassiveVisual } from "./passive-visual";
import { passiveAppearance, passiveDefinitions } from "./passives";
import type { ShopOffer } from "./shop-stock";
import { offerKind, type OfferBlock, type OfferDestination } from "./offer-kinds";
import { Registry } from "./core/registry";
import type { CardBlock } from "./cards";
import type { PassiveBlock } from "./passives";
import { createBlockAppearance } from "./visual/block-appearance";
import { createMaterialise } from "./visual/materialise";
import type { DragSource, Point } from "./drag-drop";
import "./shop-view.css";

type DisplayedOffer = {
  offer: ShopOffer;
  item: HTMLElement;
  slot: HTMLElement;
  cube: THREE.Object3D;
  dispose(): void;
};

type Entrance = { startedAt: number; landed: Set<number> };

export type ShopView = {
  /** The shop's purchase drop target, placed by the shared HUD frame. */
  readonly buyTarget: HTMLElement;
  /**
   * The shop's stock as a drag source (#277), run by dnd-kit like every drag: an offer pressed
   * and moved follows the pointer, and dropped on BUY it's bought.
   */
  readonly dragSource: DragSource<DisplayedOffer>;
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
  /** Destination explained to the player and used by the purchase flight. */
  purchaseDescription: string;
  flightTarget: "deck" | "rack";
  /**
   * Where dropping it buys it: the BUY box, and for a passive the rack itself, where it will
   * be installed. A target the shop doesn't show (no rack) is skipped.
   */
  dropTargets: readonly ("buy" | "rack")[];
};

const offerViews = new Registry<OfferView<OfferBlock>>("offer view");

/** Whether an offer kind has a view, so a shop holding one can be drawn. */
export const hasOfferView = (kind: string): boolean => offerViews.has(kind);

/** Register how a kind of offer looks in the shop. */
export function registerOfferView<Block extends OfferBlock>(
  name: string,
  view: OfferView<Block>,
): void {
  offerViews.register(name, view as unknown as OfferView<OfferBlock>);
}

/** A price in words: "1 coin", "4 coins". */
const coins = (amount: number) => `${amount} coin${amount === 1 ? "" : "s"}`;

/** A passive offer's token: its own shape and faces (src/passive-visual.ts). */
function passiveCube(block: PassiveBlock): OfferCube {
  const appearance = passiveAppearance(block);
  const visual = createPassiveVisual(appearance, 1.35);
  const mesh = new THREE.Mesh(visual.geometry, visual.materials);
  mesh.add(...(visual.extras ?? []));
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
    cardFaceArt(block.traits.identity),
    cardLook(block),
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
  purchaseDescription: "BUY to add to the deck",
  flightTarget: "deck",
  dropTargets: ["buy"],
});

registerOfferView<PassiveBlock>("passive", {
  cube: passiveCube,
  name: (block) => passiveDefinitions.get(block.definitionId).name,
  describe: (block) => block.traits.inspectable.inspect(),
  className: "is-passive",
  purchaseDescription: "BUY or the passive rack to install it",
  flightTarget: "rack",
  dropTargets: ["buy", "rack"],
});

// A transmogrifier (#388): an Items-rack item, shown as its passive token until its own look
// (#391), bought like a passive.
registerOfferView<PassiveBlock>("transmogrifier", {
  cube: passiveCube,
  name: (block) => passiveDefinitions.get(block.definitionId).name,
  describe: (block) => block.traits.inspectable.inspect(),
  className: "is-passive",
  purchaseDescription: "BUY or the Items rack to keep it",
  flightTarget: "rack",
  dropTargets: ["buy", "rack"],
});

// The Nothingifier (#156): an Items-rack item, drawn as its empty dotted cube.
registerOfferView<PassiveBlock>("nothingifier", {
  cube: passiveCube,
  name: (block) => passiveDefinitions.get(block.definitionId).name,
  describe: (block) => block.traits.inspectable.inspect(),
  className: "is-passive",
  purchaseDescription: "BUY or the Items rack to keep it",
  flightTarget: "rack",
  dropTargets: ["buy", "rack"],
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
  const flightTargets = { deck: buyTarget.querySelector("small")!, rack: rack ?? buyTarget };
  /** The elements an offer may be dropped on to buy it, by the names views give them. */
  const dropTargets = { buy: [buyTarget], rack: [rack ?? []].flat() };
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
  function animatePurchase(from: DOMRect, label: string, target: HTMLElement): void {
    if (reducedMotion()) return;
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

  // Each offer keeps its scatter spot while the stock changes (#122).
  const placeOffers = createScatterPlacer();

  function render(offers: readonly ShopOffer[], visible: boolean, animateEntrance = false): void {
    stock.hidden = buyTarget.hidden = renderer.domElement.hidden = !visible;
    buyTarget.querySelector("small")!.textContent = `DECK ${deckSize()}`;
    clear();
    stock.replaceChildren();
    stock.classList.remove("is-burning");
    if (!visible) return;
    const spots = placeOffers(offers.map((offer) => offer.block.id));
    for (const offer of offers) {
      const view = offerViews.get(offer.kind);
      const name = view.name(offer.block);
      const description = view.describe(offer.block);
      const destination = view.purchaseDescription;
      const item = document.createElement("button");
      item.type = "button";
      item.className = `shop-offer ${view.className}`;
      const spot = spots.get(offer.block.id)!;
      item.style.setProperty("--x", String(spot.x));
      item.style.setProperty("--y", String(spot.y));
      item.setAttribute(
        "aria-label",
        `${description}, ${coins(price(offer))}, drag to ${destination}`,
      );
      const slot = document.createElement("span");
      slot.className = "shop-cube-slot";
      const label = document.createElement("span");
      label.className = "shop-offer-label";
      // Name and price are separate, so a small spot can shorten the name but never the price.
      const labelName = document.createElement("span");
      labelName.className = "shop-offer-name";
      labelName.textContent = name;
      const labelPrice = document.createElement("span");
      labelPrice.className = "shop-offer-price";
      labelPrice.textContent = coins(price(offer));
      label.append(labelName, labelPrice);
      item.dataset.label = `${name} · ${coins(price(offer))}`;
      const tooltip = document.createElement("span");
      tooltip.className = "shop-offer-description";
      tooltip.textContent = description;
      item.append(slot, label, tooltip);
      const cube = makeCube(offer);
      cube.cube.rotation.set(-0.34, 0.48, 0);
      reflectInShop(cube.cube, reflections.texture);
      scene.add(cube.cube);
      displayed.push({ offer, item, slot, ...cube });
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

  /**
   * Keep the scatter below the passive rack wherever the rack is drawn (#122): its position
   * varies with the screen, so the clearance is measured rather than guessed in CSS.
   */
  let measured = "";
  function clearRack(): void {
    if (!rack || rack.hidden) return;
    const hostTop = host.getBoundingClientRect().top;
    const clear = Math.round(rack.getBoundingClientRect().bottom - hostTop + 8);
    // What is left between the rack and the BUY target, wherever the layout puts it.
    const bottom = buyTarget.hidden
      ? host.clientHeight - 100
      : Math.round(buyTarget.getBoundingClientRect().top - hostTop - 8);
    const key = `${clear},${bottom}`;
    if (key === measured) return;
    measured = key;
    stock.style.setProperty("--scatter-top-clear", `${clear}px`);
    stock.style.setProperty("--scatter-bottom", `${bottom}px`);
    stock.style.setProperty("--scatter-room", `${bottom - clear}px`);
  }

  function frame(): void {
    if (renderer.domElement.hidden) return;
    clearRack();
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
      // The DOM slot is the hit area and the projection's size reference. Keep the WebGL
      // offer inside it when compact landscape CSS shrinks the slot.
      entry.cube.scale.setScalar(slot.width / 90);
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

  /** The offer being dragged and where its press went down. */
  let dragging: { entry: DisplayedOffer; press: Point } | null = null;
  const dragSource: DragSource<DisplayedOffer> = {
    surface: stock,
    pick(clientX, clientY) {
      // While the stock tosses in or burns out, nothing can be picked up.
      if (burn || stock.inert) return null;
      return displayed.find(({ item }) => contains(item, clientX, clientY)) ?? null;
    },
    begin(entry, press) {
      dragging = { entry, press };
      entry.item.classList.add("is-dragging");
    },
    move({ clientX, clientY }) {
      if (!dragging) return;
      const { entry, press } = dragging;
      entry.item.style.translate = `${clientX - press.clientX}px ${clientY - press.clientY}px`;
    },
    end({ clientX, clientY }, canceled) {
      if (!dragging) return;
      const { entry } = dragging;
      dragging = null;
      const putBack = () => {
        entry.item.style.translate = "";
        entry.item.classList.remove("is-dragging");
      };
      if (canceled || burn) return putBack();
      const view = offerViews.get(entry.offer.kind);
      const from = entry.item.getBoundingClientRect();
      const label = entry.item.dataset.label ?? "";
      const onTarget = view.dropTargets
        .flatMap((name) => dropTargets[name])
        .some((target) => contains(target, clientX, clientY));
      if (!onTarget || !buy(entry.offer.block.id, offerKind(entry.offer).destination))
        return putBack();
      animatePurchase(from, label, flightTargets[view.flightTarget]);
      putBack();
    },
  };

  return {
    buyTarget,
    dragSource,
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
