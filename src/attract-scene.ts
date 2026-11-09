/**
 * The title screen's attract sequence (#147): a slow field of card cubes drifting toward the
 * camera on a black background, with no table under them.
 *
 * It is deliberately its own scene and camera. It first drew at quarter resolution behind a
 * Gaussian blur, so the cards read as a soft backdrop and the menu over them stayed sharp; that
 * pass is off while their appearance is being tuned, because a blur hides exactly what is being
 * judged.
 *
 * The cards it picks are **cosmetic**. Their randomness comes from a source given at
 * construction — never the session's seeded stream — so decorating the title cannot change a
 * replayable run (#134). See doc/randomness.md.
 */
import { createSceneLayer } from "./scene-layer";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { standardDeck, type CardBlock, type IdentityTrait } from "./cards";
import { getMaterialDefinition, materialOf } from "./materials";
import { createAttractTuningPanel } from "./attract-tuning-panel";
import { createBlockAppearance } from "./visual/block-appearance";

/**
 * How many cards are in flight at once. The ticket allows three or four in view; the travel is
 * deep enough that a card is only visibly near the camera for part of it, so a few more than
 * four keep the field populated without ever showing more than four at once.
 */
const cardsInFlight = 9;
/** Each card's cube size, matching the table's so the cards read as the same objects. */
const cubeSize = 1.5;
/** The camera's distance from the origin, looking down -z. */
const cameraZ = 8;
/**
 * How far past the camera a card travels before it is replaced. A card is a cube of `cubeSize`
 * that tumbles, so its half-diagonal (about 1.3) is how far its furthest corner reaches; this
 * clears that, so a card is gone only once no part of it can be on screen. Replacing it any
 * earlier made cards vanish in full view.
 */
const despawnMargin = cubeSize;
const despawnZ = cameraZ + despawnMargin;
/**
 * Where a replacement starts. Far enough back to read as distance, but not so far that most of
 * the field is spent as an invisible speck: the travel is what a card is seen over, so a deep
 * spawn with few cards leaves the screen nearly empty.
 */
const spawnZ = -30;
/** How far beyond the clearance ring a card's path may sit, so the field is not all one ring. */
const spread = 5.5;
/**
 * How far off the camera's axis a card's path must stay. A path straight through the origin
 * would pass through the lens and fill the screen with one card; this is a lane the cards
 * orbit rather than cross. It is also what keeps a card on screen for most of its travel: the
 * frustum is narrower the closer a card gets, so a large clearance leaves the frame early and
 * spends the rest of its journey invisible.
 */
export const lensClearance = 2.8;

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

/** How long a newly spawned card takes to fade up from nothing. */
const fadeInSeconds = 0.5;

type AttractCard = {
  cube: THREE.Mesh;
  /** Seconds since this card spawned; drives its fade-in. */
  age: number;
  /** The materials to fade, so the geometry and textures are not touched. */
  materials: THREE.MeshStandardMaterial[];
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
  /**
   * Install the environment the cards reflect. A card's material is nearly a mirror, so this is
   * most of what makes it look bright and glossy; it needs the renderer that will draw the
   * scene, which exists only once the background has mounted.
   */
  setEnvironment(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
};

/**
 * Where a card's path sits around the camera's axis, and how far from it. Exported so the rule
 * that no card passes through the lens can be tested directly, rather than by copying the
 * arithmetic into a test and hoping both stay right.
 */
export function pathPoint(random: () => number): { x: number; y: number; radius: number } {
  // A true circle, not an ellipse. Squashing the ring vertically to match the view's
  // proportions looks natural but shortens the distance to the axis on mostly vertical paths,
  // which is exactly where a card would drift through the lens.
  const angle = random() * Math.PI * 2;
  const radius = lensClearance + random() * spread;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, radius };
}

/**
 * The attract scene's backdrop: near-black with a soft pool of light low and centre, so the
 * drifting cards read against something rather than floating in a void. A canvas texture costs
 * nothing per frame; a real lit backdrop would be a second pass.
 */
function fakeBackdrop(): THREE.Texture {
  const source = document.createElement("canvas");
  source.width = 128;
  source.height = 80;
  const context = source.getContext("2d")!;
  context.fillStyle = "#05070b";
  context.fillRect(0, 0, source.width, source.height);
  // A wide, dim pool low in the frame, hinting at a light source off-camera.
  const pool = context.createRadialGradient(
    source.width * 0.5,
    source.height * 0.82,
    0,
    source.width * 0.5,
    source.height * 0.82,
    source.width * 0.6,
  );
  pool.addColorStop(0, "#1b2a44");
  pool.addColorStop(0.5, "#101828");
  pool.addColorStop(1, "#05070b00");
  context.fillStyle = pool;
  context.fillRect(0, 0, source.width, source.height);
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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
  // A faked backdrop rather than a flat black: a faint pool of light behind the field, so the
  // cards sit in something and an edge separates from the dark. Faked as a texture, because a
  // real vignette would be a second render pass for a background nobody looks at directly.
  scene.background = fakeBackdrop();

  /** What the cards reflect, once this scene's renderer exists (see `setEnvironment`). */
  let environment: THREE.Texture | null = null;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  camera.position.set(0, 0, cameraZ);
  camera.lookAt(0, 0, 0);

  // The game's own hand lighting, not an approximation of it. A card is judged against how it
  // looks in play, so the attract scene uses the exact pair `createTableRenderer` lights the
  // hand with: a bright neutral hemisphere and a single white key above and to the left. Anything
  // dimmer reads as grey, however many extra lights are added around it.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x56627b, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 6, 7);
  scene.add(key);

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
    // A card fades up from nothing over `fadeInSeconds`, so it does not pop into being at the
    // start of its travel. The material starts fully transparent; `update` raises it.
    for (const material of appearance.materials) material.opacity = 0;
    reflect(appearance.materials);

    return {
      cube,
      age: 0,
      materials: appearance.materials,
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
    // A path is a point on a ring around the camera's axis, carried toward the viewer. Picking
    // the point on the ring keeps every path `lensClearance` from the axis, so no card ever
    // passes through the lens; picking the angle rather than an x/y pair means the field still
    // looks scattered rather than arranged.
    // A true circle, not an ellipse. Squashing the ring vertically to match the view looks
    // natural but shortens the distance to the axis on the vertical paths, which is exactly
    // where a card would drift through the lens. A circle keeps the closest approach at
    // `lensClearance` whichever way a card is placed.
    const angle = random() * Math.PI * 2;
    const radius = lensClearance + random() * spread;
    card.cube.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      // Somewhere along the whole travel, so the field stays evenly populated after the first
      // cycle instead of bunching deep in the scene.
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

  /**
   * Point a card's materials at the attract renderer's own environment (#203). The materials
   * are built with the game's `reflectionEnvironment`, which the game's renderer prefiltered in
   * its own WebGL context; a texture cannot cross contexts, so in this renderer it is empty,
   * and a near-mirror card reflecting nothing reads as dull grey whatever the lights do.
   */
  function reflect(materials: readonly THREE.MeshStandardMaterial[]): void {
    for (const material of materials) {
      material.envMap = environment;
      material.needsUpdate = true;
    }
  }

  return {
    scene,
    camera,
    setEnvironment(renderer) {
      if (environment) return;
      // The game's own environment, a prefiltered RoomEnvironment as `createTableRenderer`
      // makes for the hand, but built by this renderer so it exists in this WebGL context.
      environment = new THREE.PMREMGenerator(renderer).fromScene(
        new RoomEnvironment(),
        0.04,
      ).texture;
      for (const card of cards) reflect(card.materials);
    },
    /** Change the tuning live: later cards use it, cards in flight keep theirs. */
    retune(next) {
      tuning = next;
    },
    update(delta) {
      sinceSpawn -= delta;
      for (const card of cards) {
        card.cube.position.z += card.speed * delta * 1.2;
        card.cube.rotateOnAxis(card.axis, card.spin * delta);
        // Ease the fade in, so a card appears softly rather than switching on.
        if (card.age < fadeInSeconds) {
          card.age = Math.min(fadeInSeconds, card.age + delta);
          const progress = card.age / fadeInSeconds;
          const eased = progress * progress * (3 - 2 * progress);
          for (const material of card.materials) material.opacity = eased;
        }
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
      environment?.dispose();
      environment = null;
    },
  };
}

/** What the attract background draws with: a renderer on its own canvas. */
export type AttractRenderer = Pick<
  THREE.WebGLRenderer,
  "render" | "setSize" | "getSize" | "dispose"
>;

/** The attract sequence's canvas and renderer (#147). */
function createAttractCanvas(): { canvas: HTMLCanvasElement; renderer: AttractRenderer } {
  const canvas = document.createElement("canvas");
  canvas.className = "attract-canvas";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return { canvas, renderer };
}

/**
 * The attract background as a service main.ts can wire: it owns the scene, its canvas and
 * renderer, and the cosmetic randomness. The `attractBackground` trait starts and stops it; the
 * canvas is in the page only while a scene composing that trait is on the stack (#147, #189).
 */
export type AttractBackground = {
  /** A scene composing `attractBackground` came to the front: mount the canvas and run. */
  start(): void;
  /** That scene left: the last one to leave takes the canvas out of the page. */
  stop(): void;
  /** Whether the canvas is in the page and the sequence running. */
  readonly running: boolean;
  /** Per frame: advance the sequence and draw it, while it runs. */
  frame(delta: number): void;
  /** The tuning in force (a dev mode edits it live; see #166). */
  tuning(): AttractTuning;
  /** Replace the tuning; cards already in flight keep the values they were dealt. */
  retune(next: AttractTuning): void;
  /** Testing only: show the live tuning panel, which drives `retune` (#166). */
  showTuning(): void;
  /** Testing only: remove the tuning panel, when its scene leaves. */
  hideTuning(): void;
  dispose(): void;
};

export function createAttractBackground(
  backgrounds: Pick<HTMLElement, "append" | "clientWidth" | "clientHeight">,
  initial: AttractTuning = defaultAttractTuning,
  createLayer: () => {
    canvas: Pick<HTMLCanvasElement, "remove">;
    renderer: AttractRenderer;
  } = createAttractCanvas,
): AttractBackground {
  // Cosmetic randomness only: `Math.random`, never the session's seeded stream, so the title
  // cannot change a replayable run (#134).
  const scene = createAttractScene(() => Math.random(), initial);
  let tuning = initial;
  // Made the first time it is needed and reused after, so a browser's limited WebGL contexts
  // are not used up by entering and leaving the title.
  let layer: ReturnType<typeof createLayer> | null = null;
  const mount = createSceneLayer(
    () => {
      layer ??= createLayer();
      scene.setEnvironment(layer.renderer as THREE.WebGLRenderer);
      backgrounds.append(layer.canvas as HTMLCanvasElement);
    },
    () => layer?.canvas.remove(),
  );
  let panel: ReturnType<typeof createAttractTuningPanel> | null = null;
  const scope: AttractBackground = {
    start: () => mount.entered(true),
    stop: () => mount.entered(false),
    get running() {
      return mount.mounted;
    },
    frame(delta) {
      if (!mount.mounted || !layer) return;
      scene.update(delta);
      // Full resolution, no blur: the cards are being judged on their own appearance, so
      // nothing may hide or soften them. Restore the quarter-resolution pass to make them a
      // deliberately soft backdrop again.
      const width = Math.max(1, Math.floor(backgrounds.clientWidth || 1));
      const height = Math.max(1, Math.floor(backgrounds.clientHeight || 1));
      const size = layer.renderer.getSize(new THREE.Vector2());
      if (size.x !== width || size.y !== height) {
        layer.renderer.setSize(width, height, false);
        scene.camera.aspect = width / height;
        scene.camera.updateProjectionMatrix();
      }
      layer.renderer.render(scene.scene, scene.camera);
    },
    tuning: () => tuning,
    retune(next) {
      tuning = next;
      scene.retune(next);
    },
    showTuning() {
      // Created unless one already exists, so a re-entry does not stack panels.
      if (panel) return;
      panel = createAttractTuningPanel({ tuning, onChange: (next) => scope.retune(next) });
    },
    hideTuning() {
      panel?.dispose();
      panel = null;
    },
    dispose() {
      panel?.dispose();
      panel = null;
      layer?.canvas.remove();
      layer?.renderer.dispose();
      scene.dispose();
    },
  };
  return scope;
}
