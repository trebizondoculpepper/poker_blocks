/**
 * The title screen's attract sequence (#147): a slow field of card cubes drifting toward the
 * camera on a black background, with no table under them.
 *
 * It is deliberately its own scene, its own camera and its own small resolution: the title
 * renders this to a low-resolution target and blurs it, so the menu drawn over it stays sharp
 * and the cards read as a background rather than as playable pieces.
 *
 * The cards it picks are **cosmetic**. Their randomness comes from a source given at
 * construction — never the session's seeded stream — so decorating the title cannot change a
 * replayable run (#134). See doc/randomness.md.
 */
import * as THREE from "three";
import { standardDeck, type CardBlock, type IdentityTrait } from "./cards";
import { getMaterialDefinition, materialOf } from "./materials";
import { createAttractTuningPanel } from "./attract-tuning-panel";
import { createBlockAppearance } from "./visual/block-appearance";

/** How many cards are in flight at once. The ticket caps this at four. */
const cardsInFlight = 4;
/** Each card's cube size, matching the table's so the cards read as the same objects. */
const cubeSize = 1.5;
/** A card is replaced once it is close enough to fill the view. */
const despawnZ = 4;
/** Where a replacement starts: deep in the scene, behind the title menu's panel. */
const spawnZ = -46;
/** Fractions of the view the cards spread across, kept narrow so they pass near the centre. */
const spread = 5.5;
const verticalSpread = 3.2;

/**
 * One tunable value: a mean and the spread around it. A card is dealt a value from this
 * distribution, so tuning the mean moves the field and the deviation makes it uneven.
 */
export type MeanSpread = { mean: number; deviation: number };

/** How the attract sequence moves and refills, as configuration rather than constants. */
export type AttractTuning = {
  /** How fast a card drifts toward the camera, in units per second. */
  velocity: MeanSpread;
  /** How fast a card tumbles, in radians per second. */
  spin: MeanSpread;
  /** Seconds between a card passing the camera and its replacement appearing. */
  spawnInterval: MeanSpread;
};

/** The attract sequence as the title shows it (#147). A dev mode overrides parts of this. */
export const defaultAttractTuning: AttractTuning = {
  velocity: { mean: 4.2, deviation: 0.7 },
  spin: { mean: 0.45, deviation: 0.18 },
  spawnInterval: { mean: 0, deviation: 0 },
};

type AttractCard = {
  cube: THREE.Mesh;
  /** The spin axis, tilting each card's tumble slightly differently. */
  axis: THREE.Vector3;
  spin: number;
  speed: number;
  dispose(): void;
};

export type AttractScene = {
  /** The scene to render, and its camera. */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Per frame: drift the cards, replacing any that have passed the camera. */
  update(delta: number): void;
  dispose(): void;
};

/** A value drawn from a mean and spread, never negative. Box-Muller, so it is symmetric. */
function sample({ mean, deviation }: MeanSpread, random: () => number): number {
  if (deviation <= 0) return Math.max(0, mean);
  // Two uniforms make one normal sample; the second is discarded.
  const u = Math.max(Number.EPSILON, random());
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  return Math.max(0, mean + normal * deviation);
}

/** A card-shaped identity and material for the attract field, chosen cosmetically. */
function randomCard(random: () => number): { identity: IdentityTrait; material: CardBlock } {
  return {
    identity: {
      rank: standardDeck[Math.floor(random() * standardDeck.length)].traits.identity.rank,
      suit: standardDeck[Math.floor(random() * standardDeck.length)].traits.identity.suit,
    },
    material: standardDeck[Math.floor(random() * standardDeck.length)],
  };
}

export function createAttractScene(
  random: () => number,
  initialTuning: AttractTuning = defaultAttractTuning,
): AttractScene & { retune(next: AttractTuning): void } {
  let tuning = initialTuning;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);

  // The same neutral studio light the hand uses, so a card looks like itself.
  // The table's room light is far dimmer than a black backdrop needs, and a card face is mostly
  // a dark pattern, so the attract scene lights them from both sides quite strongly.
  const key = new THREE.DirectionalLight(0xffffff, 6);
  key.position.set(3, 5, 10);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 3.5);
  fill.position.set(-4, -2, 4);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202838, 2.5));

  /** One card cube, built once per replacement so materials are disposed with it. */
  function makeCard(): AttractCard {
    const { identity, material } = randomCard(random);
    const appearance = createBlockAppearance(
      identity,
      getMaterialDefinition(materialOf(material)),
      cubeSize,
    );
    const cube = new THREE.Mesh(
      // A card's own appearance: the same geometry and face textures the table uses, so the
      // field reads as this game's cards rather than as generic blocks.
      appearance.geometry,
      appearance.materials,
    );
    for (const extra of appearance.extras ?? []) cube.add(extra);
    scene.add(cube);
    return {
      cube,
      // A different axis per card: mostly y, tilted a little, so the tumbling varies.
      axis: new THREE.Vector3(random() - 0.5, 1, random() - 0.5).normalize(),
      // Dealt from the tuned distributions, so changing a mean changes what appears next
      // rather than teleporting cards already in flight.
      spin: sample(tuning.spin, random),
      speed: sample(tuning.velocity, random),
      dispose() {
        scene.remove(cube);
        appearance.geometry.dispose();
        for (const material of appearance.materials) material.dispose();
        for (const texture of appearance.textures) texture.dispose();
      },
    };
  }

  const cards: AttractCard[] = [];
  /**
   * Place a card somewhere along the whole travel range, not at its far end. Spreading them
   * means a replacement appears at a random depth, so the field stays evenly populated instead
   * of all four bunching deep in the scene after the first cycle. Off-centre horizontally and
   * vertically, so they do not all pass through the middle.
   */
  function placeAlongPath(card: AttractCard): void {
    card.cube.position.set(
      (random() - 0.5) * spread,
      (random() - 0.5) * verticalSpread,
      despawnZ - random() * (despawnZ - spawnZ),
    );
  }

  for (let index = 0; index < cardsInFlight; index++) {
    const card = makeCard();
    placeAlongPath(card);
    // Stagger the starting depths so they do not arrive together, with the nearest already
    // in view so the title is never empty.
    // Stagger across the visible depth so a card is in view from the first frame.
    card.cube.position.z += index * 13;
    cards.push(card);
  }

  /** Seconds until the next replacement, from the tuned spawn interval. */
  let sinceSpawn = 0;

  return {
    scene,
    camera,
    /** Change the tuning live: later cards use it, cards in flight keep theirs. */
    retune(next) {
      tuning = next;
    },
    update(delta) {
      sinceSpawn -= delta;
      for (const card of cards) {
        card.cube.position.z += card.speed * delta * 2.4;
        card.cube.rotateOnAxis(card.axis, card.spin * delta);
        // A card is replaced once it has passed the camera, and never sooner than the tuned
        // interval allows, so the field can be made busier or calmer without changing depth.
        if (card.cube.position.z <= despawnZ || sinceSpawn > 0) continue;
        card.dispose();
        const replacement = makeCard();
        placeAlongPath(replacement);
        cards[cards.indexOf(card)] = replacement;
        sinceSpawn = sample(tuning.spawnInterval, random);
      }
    },
    dispose() {
      for (const card of cards) card.dispose();
      cards.length = 0;
    },
  };
}

/** The host element the attract canvas attaches to, sized by CSS. */
export function attractHost(host: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = "attract-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  return canvas;
}

/**
 * The attract background as a service main.ts can wire: it owns the scene, whether it is
 * running, and the cosmetic randomness. Main asks it to start, stop and advance; it never
 * decides anything about scenes (#147).
 */
export type AttractBackground = {
  start(): void;
  stop(): void;
  /** Per frame: advance the sequence if it is running, and say what to draw if so. */
  frame(delta: number): { scene: THREE.Scene; camera: THREE.Camera } | null;
  /** The tuning in force (a dev mode edits it live; see #166). */
  tuning(): AttractTuning;
  /** Replace the tuning; cards already in flight keep the values they were dealt. */
  retune(next: AttractTuning): void;
  /** Testing only: show the live tuning panel, which drives `retune` (#166). */
  showTuning(): void;
  dispose(): void;
};

export function createAttractBackground(
  initial: AttractTuning = defaultAttractTuning,
): AttractBackground {
  // Cosmetic randomness only: `Math.random`, never the session's seeded stream, so the title
  // cannot change a replayable run (#134).
  const scene = createAttractScene(() => Math.random(), initial);
  let running = false;
  let tuning = initial;
  let panel: ReturnType<typeof createAttractTuningPanel> | null = null;
  const scope: AttractBackground = {
    start: () => (running = true),
    stop: () => (running = false),
    frame(delta) {
      if (!running) return null;
      scene.update(delta);
      return { scene: scene.scene, camera: scene.camera };
    },
    tuning: () => tuning,
    retune(next) {
      tuning = next;
      scene.retune(next);
    },
    showTuning() {
      // Created unless a focused element already exists, so a re-entry does not stack panels.
      if (panel) return;
      panel = createAttractTuningPanel({ tuning, onChange: (next) => scope.retune(next) });
    },
    dispose() {
      panel?.dispose();
      panel = null;
      scene.dispose();
    },
  };
  return scope;
}
