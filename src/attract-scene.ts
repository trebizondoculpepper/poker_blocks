import { cardFaceArt } from "./visual/face-art";
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
import { playSfx } from "./audio/sfx";
import * as THREE from "three";
import { standardDeck, type IdentityTrait, pokerIdentity } from "./cards";
import { blockMaterials, getMaterialDefinition, type BlockMaterial } from "./materials";
import { createAttractTuningPanel, type TuningControl } from "./attract-tuning-panel";
import { createBlockAppearance, disposeMaterialTextures } from "./visual/block-appearance";
import {
  addAttractLighting,
  attractFieldOfView,
  configureAttractRenderer,
  sparkleEnvironment,
} from "./visual/attract-look";
import { trailEffects, type Trail } from "./attract-trails";

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
/**
 * How far off the camera's axis a card's path may sit. Paths fill this disc evenly, so most
 * pass beside the camera and now and then one comes straight at it, and bounces off.
 */
export const fieldRadius = 8.3;

/** One full back-and-forth of the camera's roll, in seconds. */
export const cameraRollPeriod = 140;
/**
 * How far the camera rolls each way from level: half a revolution, so each sweep from one
 * extreme to the other turns the view through one full revolution before it reverses.
 */
export const cameraRollAmplitude = Math.PI;

/**
 * The camera's roll about its line of sight after `seconds`: simple harmonic motion, so it
 * turns fastest through level, eases to a stop at each extreme and reverses (#203).
 */
export function cameraRoll(seconds: number): number {
  return cameraRollAmplitude * Math.sin((2 * Math.PI * seconds) / cameraRollPeriod);
}

/** No card is slower than this, however its speed is dealt, so none stalls in the field. */
const minimumSpeed = 1.2;

/** Where a card is, how it moves and how it spins: what collisions act on. */
export type Body = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Spin axis scaled by its rate, in radians per second. */
  angular: THREE.Vector3;
};

/** Two cards whose centres come this close touch, and collide. */
export const contactDistance = cubeSize * 1.2;
/** How much of their closing speed two colliding cards keep: a little is lost to the knock. */
const restitution = 0.85;
/** How much a glancing knock sets a card spinning. */
const spinKick = 0.35;
/** The fastest any card spins, so a run of knocks never sets one whirling. */
const maximumSpin = 4;

/**
 * Collide touching cards (#203). Equal masses, so an elastic impulse along the line between
 * their centres trades their closing speed: a fast card catching a slow one passes its speed
 * on, and an off-centre knock sends both away at an angle. The sliding part of the knock adds
 * spin, so they tumble off differently. Overlap is pushed out evenly, so they never sink in.
 */
export function collide(bodies: readonly Body[]): void {
  const normal = new THREE.Vector3();
  const relative = new THREE.Vector3();
  const torque = new THREE.Vector3();
  for (let first = 0; first < bodies.length; first++) {
    for (let second = first + 1; second < bodies.length; second++) {
      const a = bodies[first]!;
      const b = bodies[second]!;
      normal.subVectors(a.position, b.position);
      const distance = normal.length();
      if (distance >= contactDistance || distance < 1e-6) continue;
      normal.divideScalar(distance);
      const overlap = contactDistance - distance;
      a.position.addScaledVector(normal, overlap / 2);
      b.position.addScaledVector(normal, -overlap / 2);
      relative.subVectors(a.velocity, b.velocity);
      const closing = relative.dot(normal);
      // Already moving apart: nothing to exchange.
      if (closing >= 0) continue;
      const impulse = (-(1 + restitution) * closing) / 2;
      a.velocity.addScaledVector(normal, impulse);
      b.velocity.addScaledVector(normal, -impulse);
      // The sliding part of the knock spins them in opposite senses.
      relative.addScaledVector(normal, -closing);
      torque.crossVectors(normal, relative).multiplyScalar(spinKick);
      a.angular.add(torque).clampLength(0, maximumSpin);
      b.angular.sub(torque).clampLength(0, maximumSpin);
    }
  }
}

/** The camera, as something a card can hit: a ball around the lens, at the camera's spot. */
const cameraPosition = new THREE.Vector3(0, 0, cameraZ);
/**
 * A card bounces off the camera when its centre comes this close: by then it fills the screen,
 * which is the joke.
 */
export const cameraHitDistance = 1.9;
/** How much sideways a card glances off the camera, as a share of the speed it hit with. */
const glance = 0.9;

/**
 * Bounce a card off the camera (#203). A card coming at the lens rebounds back the way it came,
 * glances off sideways in a random direction so it does not retrace its path, and is set
 * spinning by the knock. A card moving away, or not touching, is left alone. True when it
 * bounced, so the scene can play the bonk.
 */
export function bounceOffCamera(body: Body, random: () => number): boolean {
  const away = new THREE.Vector3().subVectors(body.position, cameraPosition);
  const distance = away.length();
  if (distance >= cameraHitDistance) return false;
  // Dead on the lens has no direction to bounce in: straight back down the field.
  if (distance < 1e-6) away.set(0, 0, -1);
  else away.divideScalar(distance);
  body.position.copy(cameraPosition).addScaledVector(away, cameraHitDistance);
  const towards = body.velocity.dot(away);
  if (towards >= 0) return false;
  body.velocity.addScaledVector(away, -(1 + restitution) * towards);
  // A random sideways glance, at right angles to the bounce.
  const sideways = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5)
    .cross(away)
    .normalize();
  body.velocity.addScaledVector(sideways, -towards * glance);
  body.angular
    .add(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(4))
    .clampLength(0, maximumSpin);
  return true;
}

/** Seconds a card may stay in the field at most, so a ricochet that lingers still leaves. */
const longestStay = 40;

/** A card knocked this far behind its spawn, or this far off the axis, has left the field. */
const lostBehindZ = spawnZ - 8;
const lostRadius = 40;

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
  velocity: { mean: 4.2, deviation: 1.6 },
  spin: { mean: 0, deviation: 0.78 },
  spawnInterval: { mean: 0.8, deviation: 0.25 },
  materialWeights: equalMaterialWeights,
};

type AttractCard = {
  cube: THREE.Mesh;
  /** The materials to fade, so the geometry and textures are not touched. */
  materials: THREE.MeshStandardMaterial[];
  /** The particle trails the card's material leaves (`appearance.trails`). */
  trails: readonly Trail[];
  /** Extra meshes on the card (a crystal's fire, a fire block's glass). */
  extras: readonly (THREE.Mesh | THREE.Points)[];
  /** Still fading in; drawn transparent until fully opaque. */
  fading: boolean;
  /** Fully faded in: give each material back its own transparency. */
  settle(): void;
  /** The spin axis, tilting each card's tumble slightly differently. */
  /** How it moves: forward toward the camera, and wherever knocks have sent it. */
  velocity: THREE.Vector3;
  /** Its spin axis scaled by its rate, in radians per second. */
  angular: THREE.Vector3;
  /** Seconds since it entered the field. */
  age: number;
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
 * Where a card's path sits around the camera's axis: anywhere in the field's disc, evenly by
 * area (the square root spreads them out from the middle), so the camera's axis is no more
 * crowded than anywhere else. A path through the middle hits the camera and bounces off it.
 */
export function pathPoint(random: () => number): { x: number; y: number; radius: number } {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * fieldRadius;
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
      rank: pokerIdentity(standardDeck[Math.floor(random() * standardDeck.length)]).rank,
      suit: pokerIdentity(standardDeck[Math.floor(random() * standardDeck.length)]).suit,
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

  const camera = new THREE.PerspectiveCamera(attractFieldOfView, 1, 0.1, 120);
  camera.position.set(0, 0, cameraZ);
  camera.lookAt(0, 0, 0);

  addAttractLighting(scene);

  /** One card cube, built once per replacement so materials are disposed with it. */
  function makeCard(): AttractCard {
    const { identity, material } = randomCard(random, tuning.materialWeights);
    const definition = getMaterialDefinition(material);
    const appearance = createBlockAppearance(
      cardFaceArt(identity, { face: definition.cardFace }),
      definition,
      cubeSize,
    );
    // Whatever trails the card's material lists, each built by its registered effect.
    const trails = (definition.appearance.trails ?? []).map((trail) =>
      trailEffects.get(trail.effect)(trail, scene, random),
    );
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
      age: 0,
      trails,
      extras: appearance.extras ?? [],
      fading: true,
      settle() {
        materials.forEach((surface, index) => {
          surface.transparent = ownTransparency[index]!;
          surface.needsUpdate = true;
        });
      },
      // A different axis per card: mostly y, tilted a little, so the tumbling varies.
      angular: new THREE.Vector3(random() - 0.5, 1, random() - 0.5)
        .normalize()
        .multiplyScalar(sample(tuning.spin, random)),
      // Dealt from the tuned distributions, so changing a mean changes what appears next
      // rather than teleporting cards already in flight. Normally distributed, but never so
      // slow that a card stalls in the field.
      velocity: new THREE.Vector3(
        0,
        0,
        Math.max(minimumSpeed, sample(tuning.velocity, random)) * 1.2,
      ),
      dispose() {
        for (const trail of trails) trail.dispose();
        scene.remove(cube);
        appearance.geometry.dispose();
        for (const material of new Set([...appearance.materials, ...materials])) material.dispose();
        for (const extra of appearance.extras ?? [])
          for (const used of new Array<THREE.Material>().concat(extra.material)) used.dispose();
        for (const texture of appearance.textures) if (!texture.userData.shared) texture.dispose();
        disposeMaterialTextures(
          (appearance.extras ?? []).flatMap((extra) =>
            ([] as THREE.Material[]).concat(extra.material),
          ),
        );
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
    const { x, y } = pathPoint(random);
    card.cube.position.set(x, y, z);
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

  /** Seconds the sequence has run, for the camera's slow roll. */
  let elapsed = 0;
  /** Scratch for a card's normalised spin axis each frame. */
  const spinAxis = new THREE.Vector3();

  /** Seconds until the next replacement, from the tuned spawn interval. */
  let sinceSpawn = 0;

  /**
   * Point a card's materials at the attract renderer's own environment (#203). The materials
   * are built with the game's `reflectionEnvironment`, which the game's renderer prefiltered in
   * its own WebGL context; a texture cannot cross contexts, so in this renderer it is empty,
   * and a near-mirror card reflecting nothing reads as dull grey whatever the lights do.
   */
  /** The same for a card's extra meshes: each material that reflects gets this environment. */
  function reflectExtras(extras: readonly (THREE.Mesh | THREE.Points)[]): void {
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
      elapsed += delta;
      // Looking down -z, so a turn about z rolls the view around the cards' line of travel.
      camera.rotation.set(0, 0, cameraRoll(elapsed));
      // Touching cards knock each other about, and a card that reaches the camera bounces off.
      const bodies = cards.map(({ cube, velocity, angular }) => ({
        position: cube.position,
        velocity,
        angular,
      }));
      collide(bodies);
      // A card that hits the lens goes "bonk".
      for (const body of bodies) if (bounceOffCamera(body, random)) playSfx("attract.card.bonk");
      for (const card of cards) {
        card.cube.position.addScaledVector(card.velocity, delta);
        const spin = card.angular.length();
        if (spin > 0)
          card.cube.rotateOnAxis(spinAxis.copy(card.angular).divideScalar(spin), spin * delta);
        for (const trail of card.trails)
          trail.update(delta, card.cube.position, depthOpacity(card.cube.position.z));
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
        // Knocked backward into the distance, or off the side, also leaves the field.
        const { x, y, z } = card.cube.position;
        card.age += delta;
        const gone =
          z > despawnZ ||
          z < lostBehindZ ||
          Math.hypot(x, y) > lostRadius ||
          card.age > longestStay;
        if (!gone || sinceSpawn > 0) continue;
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
  configureAttractRenderer(renderer);
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
  showTuning(controls?: readonly TuningControl[]): void;
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
    showTuning(controls) {
      // Created unless one already exists, so a re-entry does not stack panels.
      if (panel) return;
      panel = createAttractTuningPanel({
        tuning,
        controls,
        onChange: (next) => scope.retune(next),
      });
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
