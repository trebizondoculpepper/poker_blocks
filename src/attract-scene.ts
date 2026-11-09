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
import { standardDeck, type IdentityTrait } from "./cards";
import { blockMaterials, getMaterialDefinition, type BlockMaterial } from "./materials";
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
export const spawnZ = -40;
/**
 * Where a card has fully faded in. A card's opacity follows its depth, not its age: it is
 * invisible at `spawnZ` and eases up to fully opaque by here, so it emerges from the distance
 * rather than switching on.
 */
export const fadedInZ = -35;

/** A card's opacity at depth `z`: 0 at `spawnZ`, eased (smoothstep) up to 1 at `fadedInZ`. */
export function depthOpacity(z: number): number {
  const progress = Math.min(1, Math.max(0, (z - spawnZ) / (fadedInZ - spawnZ)));
  return progress * progress * (3 - 2 * progress);
}
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
  /**
   * The card materials the field draws from, each with a weight relative to the others. Equal
   * by default; a weight of 0 leaves that material out.
   */
  materialWeights: readonly MaterialWeight[];
};

/** One material the attract field can show, and how often relative to the others. */
export type MaterialWeight = { material: BlockMaterial; weight: number };

/** Every card material, equally likely. */
export const equalMaterialWeights: readonly MaterialWeight[] = blockMaterials.map((material) => ({
  material,
  weight: 1,
}));

/**
 * A material chosen by weight, using the attract sequence's cosmetic randomness. With no
 * positive weight at all it falls back to paper, the default card stock.
 */
export function pickMaterial(
  weights: readonly MaterialWeight[],
  random: () => number,
): BlockMaterial {
  const choices = weights.filter(({ weight }) => weight > 0);
  const total = choices.reduce((sum, { weight }) => sum + weight, 0);
  let roll = random() * total;
  for (const { material, weight } of choices) {
    roll -= weight;
    if (roll < 0) return material;
  }
  return choices.at(-1)?.material ?? "paper";
}

/** The attract sequence as the title shows it (#147). A dev mode overrides parts of this. */
export const defaultAttractTuning: AttractTuning = {
  velocity: { mean: 4.2, deviation: 0.7 },
  spin: { mean: 0.45, deviation: 0.18 },
  spawnInterval: { mean: 0, deviation: 0 },
  materialWeights: equalMaterialWeights,
};

type AttractCard = {
  cube: THREE.Mesh;
  /** The materials to fade, so the geometry and textures are not touched. */
  materials: THREE.MeshStandardMaterial[];
  /** Extra meshes on the card (a crystal's fire, a fire block's glass). */
  extras: readonly THREE.Mesh[];
  /** Still fading in; drawn transparent until fully opaque. */
  fading: boolean;
  /** Fully faded in: give each material back its own transparency. */
  settle(): void;
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
function randomCard(
  random: () => number,
  weights: AttractTuning["materialWeights"],
): { identity: IdentityTrait; material: BlockMaterial } {
  return {
    identity: {
      rank: standardDeck[Math.floor(random() * standardDeck.length)].traits.identity.rank,
      suit: standardDeck[Math.floor(random() * standardDeck.length)].traits.identity.suit,
    },
    material: pickMaterial(weights, random),
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
    const { identity, material } = randomCard(random, tuning.materialWeights);
    const appearance = createBlockAppearance(identity, getMaterialDefinition(material), cubeSize);
    // The card as it looks on the table, where its finish differs from the hand's: crystal and
    // glass refract there (transmission, dispersion) and reflect at full strength, while their
    // hand finish is alpha-blended, which scales every glint down (#203).
    const materials = appearance.boardMaterials ?? appearance.materials;
    const cube = new THREE.Mesh(
      // A card's own appearance: the same geometry and face textures the table uses, so the
      // field reads as this game's cards rather than as generic blocks.
      appearance.geometry,
      materials,
    );
    for (const extra of appearance.extras ?? []) cube.add(extra);
    scene.add(cube);
    // Anything on the card that reflects (a fire block's glass, say), not only its faces.
    reflectExtras(appearance.extras ?? []);
    // A card's opacity follows its depth (`depthOpacity`). Opacity only counts on a transparent
    // material, so every card is drawn transparent while it fades in; `update` restores each
    // material's own setting once the card is fully opaque.
    const ownTransparency = materials.map(({ transparent }) => transparent);
    for (const surface of materials) {
      surface.transparent = true;
      surface.opacity = 0;
      surface.needsUpdate = true;
    }
    reflect(materials);

    return {
      cube,
      materials,
      extras: appearance.extras ?? [],
      fading: true,
      settle() {
        materials.forEach((surface, index) => {
          surface.transparent = ownTransparency[index]!;
          surface.needsUpdate = true;
        });
      },
      // A different axis per card: mostly y, tilted a little, so the tumbling varies.
      axis: new THREE.Vector3(random() - 0.5, 1, random() - 0.5).normalize(),
      // Dealt from the tuned distributions, so changing a mean changes what appears next
      // rather than teleporting cards already in flight.
      spin: sample(tuning.spin, random),
      speed: sample(tuning.velocity, random),
      dispose() {
        scene.remove(cube);
        appearance.geometry.dispose();
        for (const material of new Set([...appearance.materials, ...materials])) material.dispose();
        for (const extra of appearance.extras ?? [])
          for (const used of new Array<THREE.Material>().concat(extra.material)) used.dispose();
        for (const texture of appearance.textures) texture.dispose();
      },
    };
  }

  const cards: AttractCard[] = [];
  /**
   * Put a card on its path at depth `z`, off-centre horizontally and vertically so they do not
   * all pass through the middle. A replacement starts at `spawnZ` and fades in as it nears;
   * the opening field is spread along the whole travel so the title is never empty.
   */
  function placeAlongPath(card: AttractCard, z: number): void {
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
    card.cube.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
  }

  for (let index = 0; index < cardsInFlight; index++) {
    const card = makeCard();
    // Evenly through the travel, jittered, so the opening field is populated at every depth
    // and the cards do not arrive together.
    const slot = (index + random()) / cardsInFlight;
    placeAlongPath(card, spawnZ + slot * (despawnZ - spawnZ));
    for (const material of card.materials) material.opacity = depthOpacity(card.cube.position.z);
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
  /** The same for a card's extra meshes: each material that reflects gets this environment. */
  function reflectExtras(extras: readonly THREE.Mesh[]): void {
    const reflective = extras
      .flatMap(({ material }) => [material].flat())
      .filter((material): material is THREE.MeshStandardMaterial => "envMap" in material);
    reflect(reflective);
  }

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
      environment = sparkleEnvironment(renderer);
      for (const card of cards) {
        reflect(card.materials);
        reflectExtras(card.extras);
      }
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
        // Fade in with depth, eased, between `spawnZ` and `fadedInZ`; fully opaque after.
        if (card.fading) {
          const opacity = depthOpacity(card.cube.position.z);
          for (const material of card.materials) material.opacity = opacity;
          if (opacity >= 1) {
            card.fading = false;
            card.settle();
          }
        }
        // A card is replaced once it has passed the camera, and never sooner than the tuned
        // interval allows, so the field can be made busier or calmer without changing depth.
        if (card.cube.position.z <= despawnZ || sinceSpawn > 0) continue;
        card.dispose();
        const replacement = makeCard();
        placeAlongPath(replacement, spawnZ);
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

/** How many points of light the sparkle environment scatters around the room. */
const sparkleCount = 40;

/**
 * What the attract cards reflect (#203): the game's own room environment, as
 * `createTableRenderer` makes for the hand, plus a scatter of small, bright points of light.
 * It is an environment map, so the cards see it and the camera never does: the backdrop on
 * screen stays plain, while crystal, gold and steel catch glints as they tumble.
 *
 * Built by this renderer, so it exists in this WebGL context: a texture prefiltered by the
 * game's renderer would be empty here. The points sit on a fixed golden-angle spiral, so
 * nothing here draws on any randomness.
 */
function sparkleEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const room = new RoomEnvironment();
  const geometry = new THREE.SphereGeometry(0.42, 12, 8);
  const materials: THREE.MeshBasicMaterial[] = [];
  for (let index = 0; index < sparkleCount; index++) {
    // Evenly over a sphere (golden-angle spiral), inside the room around the cards.
    const y = 1 - (2 * (index + 0.5)) / sparkleCount;
    const ring = Math.sqrt(1 - y * y);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    // Every point a pure spectral colour, the hues spread over the whole rainbow, so crystal
    // catches prismatic fire rather than white glints. Far brighter than 1, so a glint
    // survives the prefilter's blur.
    const colour = new THREE.Color().setHSL((index * 0.381966) % 1, 1, 0.55);
    const material = new THREE.MeshBasicMaterial({ color: colour.multiplyScalar(14) });
    materials.push(material);
    const point = new THREE.Mesh(geometry, material);
    point.position.set(Math.cos(angle) * ring * 6, y * 6, Math.sin(angle) * ring * 6);
    room.add(point);
  }
  // Long bright bars, like a photographer's strip softboxes. Brushed steel stretches a
  // highlight along its brush direction, so it needs a long light to streak across a face;
  // crystal edges and gold catch them as flashes. Placed at a few angles around the cards.
  const strip = new THREE.BoxGeometry(0.35, 7, 0.35);
  const stripMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffffff).multiplyScalar(9),
  });
  const strips = [
    { position: [-6, 2, 3], rotation: [0, 0, 0.25] },
    { position: [6, 1, 2], rotation: [0, 0, -0.35] },
    { position: [0, 6, -3], rotation: [0, 0, Math.PI / 2] },
    { position: [3, -5, 4], rotation: [0.4, 0, 1.1] },
    { position: [-4, 3, -6], rotation: [0.2, 0.5, -0.8] },
  ] as const;
  for (const { position, rotation } of strips) {
    const bar = new THREE.Mesh(strip, stripMaterial);
    bar.position.set(position[0], position[1], position[2]);
    bar.rotation.set(rotation[0], rotation[1], rotation[2]);
    room.add(bar);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const texture = generator.fromScene(room, 0.04).texture;
  strip.dispose();
  stripMaterial.dispose();
  generator.dispose();
  geometry.dispose();
  for (const material of materials) material.dispose();
  return texture;
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
