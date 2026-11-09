import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { IdentityTrait } from "../cards";
import type { MaterialDefinition } from "../materials";
import { createCrystalFire } from "./crystal-fire";
import { createFireCore } from "./fire-core";

export type BlockAppearance = {
  geometry: THREE.BufferGeometry;
  textures: THREE.CanvasTexture[];
  materials: THREE.MeshStandardMaterial[];
  /**
   * Materials for the block once it is on the table, when they differ from the hand's
   * (glass and crystal refract there). Swap them in when the block lands.
   */
  boardMaterials?: THREE.MeshStandardMaterial[];
  edgeColor: number;
  edgeOpacity: number;
  /** Extra meshes to add inside the block (the crystal's fire); dispose their materials. */
  extras?: THREE.Mesh[];
};

const SIZE = 256;

function randomFor(identity: IdentityTrait, kind: string, endGrain: boolean): () => number {
  let seed = 2166136261;
  for (const char of `${identity.rank}-${identity.suit.name}-${kind}-${endGrain}`) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  }
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}

function gradient(g: CanvasRenderingContext2D, stops: [number, string][]): void {
  const fill = g.createLinearGradient(0, 0, SIZE, SIZE);
  stops.forEach(([at, color]) => fill.addColorStop(at, color));
  g.fillStyle = fill;
  g.fillRect(0, 0, SIZE, SIZE);
}

function flecks(
  g: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  color: string,
  maxSize = 3,
): void {
  g.fillStyle = color;
  for (let n = 0; n < count; n++) {
    const size = 0.5 + random() * maxSize;
    g.fillRect(random() * SIZE, random() * SIZE, size, size);
  }
}

function border(g: CanvasRenderingContext2D, color: string, width = 5): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.strokeRect(13, 13, SIZE - 26, SIZE - 26);
}

function drawWood(g: CanvasRenderingContext2D, random: () => number, endGrain: boolean): void {
  gradient(g, [
    [0, "#d8ac6c"],
    [0.5, "#e7c386"],
    [1, "#b98146"],
  ]);
  g.lineWidth = 1.5;
  if (endGrain) {
    for (let n = 0; n < 13; n++) {
      g.beginPath();
      g.strokeStyle = n % 3 === 0 ? "#8853266b" : "#a36d3460";
      g.ellipse(130, 127, 16 + n * 12, 13 + n * 11, 0.25, 0, Math.PI * 2);
      g.stroke();
    }
  } else {
    for (let n = 0; n < 44; n++) {
      const x = n * 6 + random() * 3;
      g.beginPath();
      g.strokeStyle = n % 5 === 0 ? "#79502778" : "#9c6a3570";
      g.moveTo(x, 0);
      for (let y = 0; y <= SIZE; y += 12) {
        g.lineTo(x + Math.sin(y * 0.045 + n) * (3 + random() * 2), y);
      }
      g.stroke();
    }
  }
  border(g, "#7d4d2a", 6);
  border(g, "#f4d49c88", 1.5);
}

/**
 * Brushed steel: fine parallel scratches at `angle` (radians), over an even mid-grey. The
 * shading comes from the material's anisotropic reflections, so nothing is baked in but
 * the grain, the rim and the rivets.
 */
function drawSteel(g: CanvasRenderingContext2D, random: () => number, angle: number): void {
  g.fillStyle = "#959ca1";
  g.fillRect(0, 0, SIZE, SIZE);
  g.save();
  g.translate(SIZE / 2, SIZE / 2);
  g.rotate(angle);
  // Long, slightly uneven strokes; the canvas is over-covered so rotation leaves no gaps.
  for (let n = 0; n < 900; n++) {
    const y = -SIZE + random() * SIZE * 2;
    const x = -SIZE + random() * SIZE * 2;
    const length = 40 + random() * 220;
    const light = random() < 0.5;
    g.strokeStyle = light
      ? `rgba(240, 246, 250, ${0.08 + random() * 0.18})`
      : `rgba(40, 50, 58, ${0.06 + random() * 0.16})`;
    g.lineWidth = random() < 0.85 ? 1 : 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + length, y + (random() - 0.5) * 0.8);
    g.stroke();
  }
  g.restore();
  border(g, "#3a444b", 9);
  border(g, "#dfe5e8aa", 2);
  for (const x of [29, SIZE - 29])
    for (const y of [29, SIZE - 29]) {
      g.beginPath();
      g.fillStyle = "#3a434a";
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.fillStyle = "#d4d9db";
      g.arc(x - 1, y - 1, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#5f686d";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 5, y + 2);
      g.lineTo(x + 5, y - 3);
      g.stroke();
    }
}

/**
 * Fire: an open iron frame, nothing in the openings. Everything left transparent here is
 * cut away by the material, so only the bars (and the iron rank and suit) remain.
 */
function drawFireFrame(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, SIZE, SIZE);
  g.strokeStyle = "#2b2f33";
  g.lineWidth = 34;
  g.strokeRect(0, 0, SIZE, SIZE);
  // A bright bevel on the inside edge and a dark one outside, so the bars read as metal.
  g.strokeStyle = "#7d858b";
  g.lineWidth = 3;
  g.strokeRect(17, 17, SIZE - 34, SIZE - 34);
  g.strokeStyle = "#16191c";
  g.lineWidth = 3;
  g.strokeRect(2, 2, SIZE - 4, SIZE - 4);
}

/** Prismatic crystal: nearly clear, with faint rainbow fire; the cut does the rest. */
function drawPrismatic(g: CanvasRenderingContext2D, random: () => number): void {
  g.clearRect(0, 0, SIZE, SIZE);
  gradient(g, [
    [0, "#c9b8ff30"],
    [0.3, "#b8f0ff28"],
    [0.55, "#ffd0ea28"],
    [0.8, "#fff1b828"],
    [1, "#b8c8ff30"],
  ]);
  for (let n = 0; n < 24; n++) {
    const x = random() * SIZE,
      y = random() * SIZE,
      radius = 2 + random() * 5;
    g.strokeStyle = "#ffffffaa";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - radius, y);
    g.lineTo(x + radius, y);
    g.moveTo(x, y - radius);
    g.lineTo(x, y + radius);
    g.stroke();
  }
}

/**
 * Gold: one solid, polished block. The face is plain gold; the gloss and the warm
 * reflections come from the material, not the texture.
 */
function drawGold(g: CanvasRenderingContext2D): void {
  g.fillStyle = "#d4a12a";
  g.fillRect(0, 0, SIZE, SIZE);
}

/**
 * Paper: one playing card per face, its corners rounded, so the block reads as six sheets
 * of card joined at their edges around nothing. The corners are left transparent and cut
 * away by the material, so the hollow inside shows through.
 */
function drawPaper(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, SIZE, SIZE);
  const card = new Path2D();
  card.roundRect(3, 3, SIZE - 6, SIZE - 6, 26);
  g.fillStyle = "#f6f0e3";
  g.fill(card);
  // The card's own printed frame, inset like a real card's.
  g.strokeStyle = "#b8b0a2";
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(18, 18, SIZE - 36, SIZE - 36, 14);
  g.stroke();
  // A faint edge highlight where the card's rim catches the light.
  g.strokeStyle = "#ffffffaa";
  g.lineWidth = 2;
  g.stroke(card);
}

type Crack = { x: number; y: number }[];

/**
 * Hairline cracks running in from the edges, as on old pottery: each starts at a random
 * point on a side, wanders inward and sometimes forks. Seeded per card so the colour and
 * the relief agree.
 */
function potteryCracks(identity: IdentityTrait): Crack[] {
  const random = randomFor(identity, "terracotta", true);
  const cracks: Crack[] = [];
  const count = 3 + Math.floor(random() * 4);
  for (let n = 0; n < count; n++) {
    const side = Math.floor(random() * 4);
    const along = 20 + random() * (SIZE - 40);
    let x = side === 0 ? 0 : side === 1 ? SIZE : along;
    let y = side === 2 ? 0 : side === 3 ? SIZE : along;
    // Heading inward from that side, give or take.
    let heading = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side] + (random() - 0.5) * 0.9;
    const crack: Crack = [{ x, y }];
    const steps = 4 + Math.floor(random() * 6);
    for (let step = 0; step < steps; step++) {
      heading += (random() - 0.5) * 1.1;
      const length = 6 + random() * 14;
      x += Math.cos(heading) * length;
      y += Math.sin(heading) * length;
      crack.push({ x, y });
      if (random() < 0.25) {
        // A short fork off this point.
        const forkHeading = heading + (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.6);
        cracks.push([
          { x, y },
          {
            x: x + Math.cos(forkHeading) * (8 + random() * 14),
            y: y + Math.sin(forkHeading) * (8 + random() * 14),
          },
        ]);
      }
    }
    cracks.push(crack);
  }
  return cracks;
}

function strokeCracks(
  g: CanvasRenderingContext2D,
  cracks: Crack[],
  color: string,
  width: number,
): void {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const crack of cracks) {
    g.beginPath();
    crack.forEach(({ x, y }, index) => (index ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
}

function drawTerracotta(g: CanvasRenderingContext2D, random: () => number, cracks: Crack[]): void {
  gradient(g, [
    [0, "#e6a174"],
    [0.5, "#b65d3d"],
    [1, "#d67f58"],
  ]);
  flecks(g, random, 650, "#63392255", 2.5);
  flecks(g, random, 250, "#ffd0a653", 2);
  border(g, "#713c29", 7);
  border(g, "#f4bd8c88", 2);
  g.strokeStyle = "#733e2c88";
  g.lineWidth = 3;
  for (let n = 0; n < 4; n++) {
    g.beginPath();
    g.moveTo(0, 45 + n * 54);
    g.lineTo(SIZE, 45 + n * 54);
    g.stroke();
  }
  // Cracks: a dark line with a pale chipped lip beside it.
  strokeCracks(g, cracks, "#f2b48a66", 3);
  strokeCracks(g, cracks, "#3a1a0fcc", 1.4);
}

/** Ice: pale, frosted blue with fine crystals; no rim, it is one lump of ice. */
function drawIce(g: CanvasRenderingContext2D, random: () => number): void {
  gradient(g, [
    [0, "#e9f8fbcc"],
    [0.4, "#b7dce8bb"],
    [0.75, "#d6eef4cc"],
    [1, "#9fcbdcbb"],
  ]);
  flecks(g, random, 520, "#ffffff70", 2);
  for (let n = 0; n < 24; n++) {
    const x = random() * SIZE,
      y = random() * SIZE;
    g.strokeStyle = "#f4ffff77";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 14, y + 8);
    g.lineTo(x, y);
    g.lineTo(x + 8, y - 14);
    g.stroke();
  }
}

/** Ice's rough relief: a field of soft lumps and pits, like a frozen, frosted face. */
function iceRoughHeight(identity: IdentityTrait): THREE.CanvasTexture {
  const { canvas, g } = heightCanvas();
  const random = randomFor(identity, "ice", true);
  for (let n = 0; n < 420; n++) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const radius = 2 + random() * 9;
    const raised = random() < 0.5;
    const lump = g.createRadialGradient(x, y, 0, x, y, radius);
    lump.addColorStop(0, raised ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)");
    lump.addColorStop(1, "rgba(128,128,128,0)");
    g.fillStyle = lump;
    g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Meltwater: beads of water with short wet trails above them, on a transparent canvas
 * that tiles top to bottom. Used as both colour (faint glints) and bump (raised beads), and
 * scrolled downwards over time so the drops appear to run down the face.
 */
function meltwater(identity: IdentityTrait): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d")!;
  const random = randomFor(identity, "meat", true);
  for (let n = 0; n < 11; n++) {
    const x = 18 + random() * (SIZE - 36);
    const y = random() * SIZE;
    const radius = 3 + random() * 4;
    const trail = 20 + random() * 50;
    // Draw each drop three times, a canvas apart, so it wraps seamlessly top to bottom.
    for (const shift of [-SIZE, 0, SIZE]) {
      const wet = g.createLinearGradient(x, y + shift - trail, x, y + shift);
      wet.addColorStop(0, "rgba(255,255,255,0)");
      wet.addColorStop(1, "rgba(255,255,255,0.35)");
      g.fillStyle = wet;
      g.fillRect(x - radius * 0.45, y + shift - trail, radius * 0.9, trail);
      const bead = g.createRadialGradient(
        x - radius * 0.3,
        y + shift - radius * 0.3,
        0,
        x,
        y + shift,
        radius,
      );
      bead.addColorStop(0, "rgba(255,255,255,0.95)");
      bead.addColorStop(1, "rgba(255,255,255,0.15)");
      g.fillStyle = bead;
      g.beginPath();
      g.arc(x, y + shift, radius, 0, Math.PI * 2);
      g.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Each BoxGeometry face's texture axes in the block's own space (u, then v), in face order
 * +X, -X, +Y, -Y, +Z, -Z. Used to turn world "down" into a direction across each face.
 */
const faceAxes: [THREE.Vector3, THREE.Vector3][] = [
  [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
  [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
];

/**
 * A glossy skin of meltwater over the ice. The drops obey world gravity, not the block:
 * every frame each face's copy of the drop texture is turned so the drops point along
 * world "down" across that face, and scrolled that way at a speed set by how steep the
 * face is (one transform change per face, no redraw). On a level face they barely move.
 */
function meltwaterSkin(
  identity: IdentityTrait,
  geometry: THREE.BufferGeometry,
): { skin: THREE.Mesh; texture: THREE.CanvasTexture } {
  const texture = meltwater(identity);
  // Seconds for a drop to slide the height of an upright face, varied a little per block.
  const secondsPerFace = 14 + randomFor(identity, "ice", false)() * 10;
  const turned = new THREE.Quaternion();
  const down = new THREE.Vector3();
  const materials = faceAxes.map(([u, v]) => {
    const faceTexture = texture.clone();
    faceTexture.wrapS = faceTexture.wrapT = THREE.RepeatWrapping;
    faceTexture.center.set(0.5, 0.5);
    faceTexture.needsUpdate = true;
    const material = new THREE.MeshPhysicalMaterial({
      map: faceTexture,
      bumpMap: faceTexture,
      bumpScale: 4,
      transparent: true,
      depthWrite: false,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMap: reflectionEnvironment,
      envMapIntensity: 1.4,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    let last = performance.now();
    let travelled = randomFor(identity, "ice", true)();
    material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
      const now = performance.now();
      const seconds = Math.min((now - last) / 1000, 0.1);
      last = now;
      // World down, in the block's own space, then across this face.
      object.getWorldQuaternion(turned);
      down.set(0, -1, 0).applyQuaternion(turned.invert());
      const across = down.dot(u);
      const along = down.dot(v);
      const steepness = Math.hypot(across, along);
      // Turn the texture so its "down" lies along world down on this face...
      if (steepness > 0.05) faceTexture.rotation = Math.atan2(across, -along);
      // ...and slide the drops that way, faster on steeper faces.
      travelled = (travelled + (seconds * steepness) / secondsPerFace) % 1;
      faceTexture.offset.set(0, travelled);
    };
    return material;
  });
  const skin = new THREE.Mesh(geometry, materials);
  skin.renderOrder = 15;
  return { skin, texture };
}

/**
 * Ice on the table: a cheap frosted refraction. Transmission lets the scene through, but
 * high roughness blurs it, and a short absorption distance clouds it, so little light gets
 * through and what does is soft and pale blue.
 */
function cloudyIce(
  texture: THREE.CanvasTexture,
  height: THREE.CanvasTexture,
  size: number,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    bumpMap: height,
    bumpScale: 3,
    transmission: 0.7,
    roughness: 0.6,
    ior: 1.31,
    thickness: size * 0.8,
    attenuationColor: new THREE.Color(0xcfe9f2),
    attenuationDistance: size * 0.35,
    clearcoat: 0.4,
    clearcoatRoughness: 0.5,
    envMap: reflectionEnvironment,
    envMapIntensity: 0.8,
  });
}

function drawMeat(g: CanvasRenderingContext2D, random: () => number): void {
  gradient(g, [
    [0, "#d78387"],
    [0.48, "#8d3c48"],
    [1, "#cc7776"],
  ]);
  for (let n = 0; n < 24; n++) {
    g.strokeStyle = n % 3 === 0 ? "#ffe5ce88" : "#671f3466";
    g.lineWidth = 2 + random() * 7;
    g.beginPath();
    const y = random() * SIZE;
    g.moveTo(-10, y);
    g.bezierCurveTo(70, y - 22, 170, y + 28, SIZE + 10, y + (random() - 0.5) * 45);
    g.stroke();
  }
  flecks(g, random, 90, "#f5c1b966", 4);
  border(g, "#722e3e", 6);
}

/** The rank and suit, in the colours that suit the material. */
function drawPrint(
  g: CanvasRenderingContext2D,
  identity: IdentityTrait,
  appearance: MaterialDefinition["appearance"],
): void {
  const ink = appearance.ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = ink.onDark ? "#28170caa" : "#ffffffbb";
  g.shadowBlur = ink.onDark ? 5 : 3;
  g.fillStyle = identity.suit.color === "#bd3651" ? ink.red : ink.black;
  g.font = "bold 80px system-ui, sans-serif";
  g.fillText(identity.rank, 128, 100);
  g.font = "94px Georgia, serif";
  g.fillText(identity.suit.symbol, 128, 180);
}

/**
 * For see-through blocks (fire, ice, crystal): the rank and suit on a thin skin just
 * outside the block, drawn on front faces only. Faces turned away from the camera, seen
 * through the block, then show no lettering, so the faces you look at read clearly.
 */
function printSkin(
  identity: IdentityTrait,
  appearance: MaterialDefinition["appearance"],
  geometry: THREE.BufferGeometry,
): { skin: THREE.Mesh; texture: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas 2D is unavailable");
  drawPrint(g, identity, appearance);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const skin = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.3,
      depthWrite: false,
      side: THREE.FrontSide,
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  skin.renderOrder = 20;
  return { skin, texture };
}

type PatternHandler = (
  g: CanvasRenderingContext2D,
  random: () => number,
  identity: IdentityTrait,
  endGrain: boolean,
  brushAngle: number,
) => void;

const patternRegistry = new Map<string, PatternHandler>([
  ["cardSheet", (g) => drawPaper(g)],
  ["timberGrain", (g, random, _identity, endGrain) => drawWood(g, random, endGrain)],
  ["brushedRivets", (g, random, _identity, _endGrain, angle) => drawSteel(g, random, angle)],
  ["ironFrame", (g) => drawFireFrame(g)],
  ["rainbowCrystal", (g, random) => drawPrismatic(g, random)],
  ["goldFoil", (g) => drawGold(g)],
  ["crackedClay", (g, random, identity) => drawTerracotta(g, random, potteryCracks(identity))],
  ["frostedIce", (g, random) => drawIce(g, random)],
  ["marbledFlesh", (g, random) => drawMeat(g, random)],
]);

function faceTexture(
  identity: IdentityTrait,
  definition: MaterialDefinition,
  endGrain: boolean,
  /** Brush direction for steel, in radians. */
  brushAngle = 0,
  /** False leaves the rank and suit off (see printSkin). */
  print = true,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas 2D is unavailable");
  const pattern = patternRegistry.get(definition.appearance.pattern);
  if (!pattern) throw new Error(`Unknown face pattern: ${definition.appearance.pattern}`);
  pattern(g, randomFor(identity, definition.id, endGrain), identity, endGrain, brushAngle);
  if (print) drawPrint(g, identity, definition.appearance);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Reflections for crystal, steel, gold and iron; set once by the game (see setReflectionEnvironment). */
let reflectionEnvironment: THREE.Texture | null = null;

/** Give the shiny materials something to reflect (a PMREM environment map). */
export function setReflectionEnvironment(texture: THREE.Texture): void {
  reflectionEnvironment = texture;
}

/**
 * Where a face lets light through: white where the canvas is see-through (the pane), black
 * where it is solid (frame, print). Used as a transmissionMap, so the frame and the rank
 * and suit stay opaque while the glass between them refracts.
 */
function clearMask(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  const source = texture.image as HTMLCanvasElement;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d")!;
  const pixels = source.getContext("2d")!.getImageData(0, 0, SIZE, SIZE);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const clear = data[i + 3] < 150 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = clear;
    data[i + 3] = 255;
  }
  g.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Glass and crystal in the hand: see-through from the texture's alpha. The hand is drawn in
 * its own pass with nothing behind it, so real refraction (transmission) would have nothing
 * to bend; that version is used on the table instead (see clearOnTable).
 */
function clearInHand(
  texture: THREE.CanvasTexture,
  optics: NonNullable<MaterialDefinition["appearance"]["optics"]>,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    color: optics.tint,
    roughness: 0.06,
    metalness: 0,
    ior: optics.handIor,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMap: reflectionEnvironment,
    envMapIntensity: optics.handEnvironment,
    transparent: true,
    depthWrite: false,
    ...optics.iridescence,
  });
}

/**
 * Glass and crystal on the table: physically based transmission, so what is behind them
 * (other blocks, the baize) is seen bent through them. Prismatic crystal is far more
 * refractive (diamond-like IOR, a thick body) and splits light into colours (dispersion);
 * glass panes are thin, so they shift the view only a little. The frame and print stay
 * opaque through the transmission mask.
 */
function clearOnTable(
  texture: THREE.CanvasTexture,
  mask: THREE.CanvasTexture,
  optics: NonNullable<MaterialDefinition["appearance"]["optics"]>,
  size: number,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    color: optics.tint,
    roughness: optics.tableRoughness,
    metalness: 0,
    transmission: 1,
    transmissionMap: mask,
    ior: optics.tableIor,
    thickness: size * optics.thickness,
    dispersion: optics.dispersion,
    attenuationColor: new THREE.Color(optics.tint),
    attenuationDistance: size * optics.attenuationDistance,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    specularIntensity: 1,
    envMap: reflectionEnvironment,
    envMapIntensity: optics.tableEnvironment,
    ...optics.iridescence,
  });
}

// ----- Bump maps: height in grey (white is raised), red channel read by three.js -----

function heightCanvas(): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas 2D is unavailable");
  g.fillStyle = "#808080";
  g.fillRect(0, 0, SIZE, SIZE);
  return { canvas, g };
}

/** The rank and suit, stamped: pressed slightly into the face. */
function stampPrint(g: CanvasRenderingContext2D, identity: IdentityTrait, shade: string): void {
  g.fillStyle = shade;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "bold 80px system-ui, sans-serif";
  g.fillText(identity.rank, 128, 100);
  g.font = "94px Georgia, serif";
  g.fillText(identity.suit.symbol, 128, 180);
}

/**
 * Steel's relief: brush grooves along `angle`, a raised rim with a groove inside it, domed
 * rivets at the corners and the stamped rank and suit.
 */
function steelHeight(identity: IdentityTrait, angle: number): THREE.CanvasTexture {
  const { canvas, g } = heightCanvas();
  const random = randomFor(identity, "steel", false);
  g.save();
  g.translate(SIZE / 2, SIZE / 2);
  g.rotate(angle);
  for (let n = 0; n < 700; n++) {
    const shade = 112 + Math.floor(random() * 32);
    g.strokeStyle = `rgb(${shade}, ${shade}, ${shade})`;
    g.lineWidth = 1;
    const x = -SIZE + random() * SIZE * 2;
    const y = -SIZE + random() * SIZE * 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 40 + random() * 220, y);
    g.stroke();
  }
  g.restore();
  // The rim: a raised plate edge, then a pressed groove just inside it.
  g.strokeStyle = "#d8d8d8";
  g.lineWidth = 18;
  g.strokeRect(0, 0, SIZE, SIZE);
  g.strokeStyle = "#4a4a4a";
  g.lineWidth = 3;
  g.strokeRect(13, 13, SIZE - 26, SIZE - 26);
  for (const x of [29, SIZE - 29])
    for (const y of [29, SIZE - 29]) {
      const dome = g.createRadialGradient(x - 2, y - 2, 1, x, y, 11);
      dome.addColorStop(0, "#ffffff");
      dome.addColorStop(0.7, "#c8c8c8");
      dome.addColorStop(1, "#808080");
      g.fillStyle = dome;
      g.beginPath();
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fill();
      // The screwdriver slot.
      g.strokeStyle = "#606060";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 5, y + 2);
      g.lineTo(x + 5, y - 3);
      g.stroke();
    }
  stampPrint(g, identity, "#5a5a5a");
  return new THREE.CanvasTexture(canvas);
}

/** Fire: the iron frame stands proud; the openings are cut away anyway. */
function frameHeight(): THREE.CanvasTexture {
  const { canvas, g } = heightCanvas();
  g.fillStyle = "#606060";
  g.fillRect(0, 0, SIZE, SIZE);
  g.strokeStyle = "#e0e0e0";
  g.lineWidth = 30;
  g.strokeRect(0, 0, SIZE, SIZE);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 6;
  g.strokeRect(6, 6, SIZE - 12, SIZE - 12);
  return new THREE.CanvasTexture(canvas);
}

/** A height map from a face's own pattern, softened so it reads as gentle relief. */
function reliefFrom(texture: THREE.CanvasTexture): {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
} {
  const { canvas, g } = heightCanvas();
  g.filter = "grayscale(1) contrast(0.45)";
  g.drawImage(texture.image as HTMLCanvasElement, 0, 0);
  g.filter = "none";
  return { canvas, g };
}

/** Wood: the grain, plus the rank, suit and key lines carved into the surface. */
function woodHeight(texture: THREE.CanvasTexture, identity: IdentityTrait): THREE.CanvasTexture {
  const { canvas, g } = reliefFrom(texture);
  border(g, "#383838", 7);
  border(g, "#505050", 2.5);
  stampPrint(g, identity, "#303030");
  return new THREE.CanvasTexture(canvas);
}

/** Gold: perfectly smooth, but the rank and suit are engraved. */
function goldHeight(identity: IdentityTrait): THREE.CanvasTexture {
  const { canvas, g } = heightCanvas();
  stampPrint(g, identity, "#404040");
  return new THREE.CanvasTexture(canvas);
}

/** Paper: each card stands slightly proud, its rounded rim dipping into the gaps. */
function paperHeight(): THREE.CanvasTexture {
  const { canvas, g } = heightCanvas();
  g.fillStyle = "#202020";
  g.fillRect(0, 0, SIZE, SIZE);
  g.save();
  g.shadowColor = "#000000";
  g.shadowBlur = 8;
  g.fillStyle = "#b0b0b0";
  g.beginPath();
  g.roundRect(3, 3, SIZE - 6, SIZE - 6, 26);
  g.fill();
  g.restore();
  return new THREE.CanvasTexture(canvas);
}

/** Terracotta: its pitted surface, with the cracks cut in. */
function terracottaHeight(
  texture: THREE.CanvasTexture,
  identity: IdentityTrait,
): THREE.CanvasTexture {
  const { canvas, g } = reliefFrom(texture);
  strokeCracks(g, potteryCracks(identity), "#202020", 2.2);
  return new THREE.CanvasTexture(canvas);
}

type SurfaceHandler = (
  texture: THREE.CanvasTexture,
  relief: { bumpMap: THREE.CanvasTexture; bumpScale: number },
  angle: number,
) => THREE.MeshStandardMaterial;

const surfaceRegistry = new Map<string, SurfaceHandler>([
  [
    "brushedMetal",
    (texture, relief, angle) =>
      new THREE.MeshPhysicalMaterial({
        map: texture,
        ...relief,
        metalness: 1,
        roughness: 0.42,
        anisotropy: 0.85,
        anisotropyRotation: angle,
        envMap: reflectionEnvironment,
        envMapIntensity: 0.7,
        clearcoat: 0.15,
        clearcoatRoughness: 0.3,
      }),
  ],
  [
    "frosted",
    (texture, relief) =>
      new THREE.MeshPhysicalMaterial({
        map: texture,
        roughness: 0.48,
        metalness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.38,
        transparent: true,
        opacity: 0.94,
        ...relief,
      }),
  ],
  [
    "polishedMetal",
    (texture, relief) =>
      new THREE.MeshPhysicalMaterial({
        map: texture,
        ...relief,
        metalness: 1,
        roughness: 0.1,
        clearcoat: 0.6,
        clearcoatRoughness: 0.05,
        envMap: reflectionEnvironment,
        envMapIntensity: 2.2,
      }),
  ],
  [
    "cardSheet",
    (texture, relief) =>
      new THREE.MeshStandardMaterial({
        map: texture,
        ...relief,
        roughness: 0.8,
        metalness: 0,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      }),
  ],
  [
    "matte",
    (texture, relief) =>
      new THREE.MeshStandardMaterial({ map: texture, ...relief, roughness: 0.75, metalness: 0 }),
  ],
]);

function surface(
  texture: THREE.CanvasTexture,
  appearance: MaterialDefinition["appearance"],
  height?: THREE.CanvasTexture,
  angle = 0,
): THREE.MeshStandardMaterial {
  const handler = surfaceRegistry.get(appearance.surface);
  if (!handler) throw new Error(`Unknown surface: ${appearance.surface}`);
  return handler(texture, { bumpMap: height ?? texture, bumpScale: appearance.reliefScale }, angle);
}

/** Directions a steel block's six faces are brushed in, varied per card. */
function brushAngles(identity: IdentityTrait): number[] {
  const random = randomFor(identity, "steel", true);
  const choices = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI / 6, -Math.PI / 3];
  return choices.map(() => choices[Math.floor(random() * choices.length)] + (random() - 0.5) * 0.2);
}

/**
 * Brushed steel: fully metallic, with anisotropic reflections stretched along the brush
 * direction (anisotropyRotation matches the face's scratches), so each face catches the
 * light differently as the block turns.
 */
type AssemblyContext = {
  identity: IdentityTrait;
  definition: MaterialDefinition;
  geometry: THREE.BufferGeometry;
  size: number;
};

type AssemblyHandler = (context: AssemblyContext) => BlockAppearance;
type HeightHandler = (
  texture: THREE.CanvasTexture,
  identity: IdentityTrait,
  angle: number,
) => THREE.CanvasTexture | undefined;

const heightRegistry = new Map<string, HeightHandler>([
  ["none", () => undefined],
  ["cardRim", () => paperHeight()],
  ["carvedTimber", (texture, identity) => woodHeight(texture, identity)],
  ["engravedGold", (_texture, identity) => goldHeight(identity)],
  ["clayRelief", (texture, identity) => terracottaHeight(texture, identity)],
  ["steelRelief", (_texture, identity, angle) => steelHeight(identity, angle)],
  ["iceRelief", () => undefined],
  ["frameRelief", () => undefined],
]);

function appearanceBase(
  context: AssemblyContext,
  textures: THREE.CanvasTexture[],
  materials: THREE.MeshStandardMaterial[],
  extras?: THREE.Mesh[],
  boardMaterials?: THREE.MeshStandardMaterial[],
): BlockAppearance {
  return {
    geometry: context.geometry,
    textures,
    materials,
    boardMaterials,
    edgeColor: context.definition.appearance.edge.color,
    edgeOpacity: context.definition.appearance.edge.opacity,
    extras,
  };
}

function sixFaces(context: AssemblyContext): BlockAppearance {
  const { identity, definition } = context;
  const appearance = definition.appearance;
  const makeHeight = heightRegistry.get(appearance.height);
  if (!makeHeight) throw new Error("Unknown relief handler: " + appearance.height);
  const faceCache = new Map<
    boolean,
    {
      texture: THREE.CanvasTexture;
      height?: THREE.CanvasTexture;
      material: THREE.MeshStandardMaterial;
    }
  >();
  const materials = Array.from({ length: 6 }, (_, face) => {
    const endGrain = appearance.endGrainFaces.includes(face);
    let entry = faceCache.get(endGrain);
    if (!entry) {
      const texture = faceTexture(identity, definition, endGrain);
      const height = makeHeight(texture, identity, 0);
      entry = { texture, height, material: surface(texture, appearance, height) };
      faceCache.set(endGrain, entry);
    }
    return entry.material;
  });
  const textures = [...faceCache.values()].flatMap(({ texture, height }) =>
    height ? [texture, height] : [texture],
  );
  return appearanceBase(context, textures, materials);
}

function brushedFaces(context: AssemblyContext): BlockAppearance {
  const { identity, definition } = context;
  const makeHeight = heightRegistry.get(definition.appearance.height);
  if (!makeHeight) throw new Error("Unknown relief handler: " + definition.appearance.height);
  const angles = brushAngles(identity);
  const textures = angles.map((angle) => faceTexture(identity, definition, false, angle));
  const heights = textures.map((texture, face) => makeHeight(texture, identity, angles[face]));
  const materials = textures.map((texture, face) =>
    surface(texture, definition.appearance, heights[face], angles[face]),
  );
  return appearanceBase(
    context,
    [...textures, ...heights.filter((height) => height !== undefined)],
    materials,
  );
}

function refractiveCrystal(context: AssemblyContext): BlockAppearance {
  const { identity, definition, geometry, size } = context;
  const optics = definition.appearance.optics;
  if (!optics) throw new Error("Refractive crystal needs optics");
  const texture = faceTexture(identity, definition, false, 0, false);
  const print = printSkin(identity, definition.appearance, geometry);
  const mask = clearMask(texture);
  const inHand = clearInHand(texture, optics);
  const onTable = clearOnTable(texture, mask, optics, size);
  return appearanceBase(
    context,
    [texture, mask, print.texture],
    Array.from({ length: 6 }, () => inHand),
    [createCrystalFire(geometry), print.skin],
    Array.from({ length: 6 }, () => onTable),
  );
}

function flameFrame(context: AssemblyContext): BlockAppearance {
  const { identity, definition, geometry, size } = context;
  const texture = faceTexture(identity, definition, false, 0, false);
  const print = printSkin(identity, definition.appearance, geometry);
  const height = frameHeight();
  const iron = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: height,
    bumpScale: 2.5,
    metalness: 0.75,
    roughness: 0.5,
    envMap: reflectionEnvironment,
    envMapIntensity: 0.8,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  return appearanceBase(
    context,
    [texture, height, print.texture],
    Array.from({ length: 6 }, () => iron),
    [createFireCore(size), print.skin],
  );
}

function frostedBlock(context: AssemblyContext): BlockAppearance {
  const { identity, definition, geometry, size } = context;
  const texture = faceTexture(identity, definition, false, 0, false);
  const height = iceRoughHeight(identity);
  const print = printSkin(identity, definition.appearance, geometry);
  const melt = meltwaterSkin(identity, geometry);
  const inHand = surface(texture, definition.appearance, height);
  const onTable = cloudyIce(texture, height, size);
  return appearanceBase(
    context,
    [texture, height, print.texture, melt.texture],
    Array.from({ length: 6 }, () => inHand),
    [melt.skin, print.skin],
    Array.from({ length: 6 }, () => onTable),
  );
}

const assemblyRegistry = new Map<string, AssemblyHandler>([
  ["sixFaces", sixFaces],
  ["brushedFaces", brushedFaces],
  ["refractiveCrystal", refractiveCrystal],
  ["flameFrame", flameFrame],
  ["frostedBlock", frostedBlock],
]);

const geometryRegistry = new Map<
  string,
  (size: number, geometry: MaterialDefinition["appearance"]["geometry"]) => THREE.BufferGeometry
>([
  ["box", (size) => new THREE.BoxGeometry(size, size, size)],
  [
    "rounded",
    (size, settings) =>
      new RoundedBoxGeometry(size, size, size, settings.segments, size * settings.radius),
  ],
]);

export function createBlockAppearance(
  identity: IdentityTrait,
  definition: MaterialDefinition,
  size: number,
): BlockAppearance {
  const appearance = definition.appearance;
  const makeGeometry = geometryRegistry.get(appearance.geometry.shape);
  if (!makeGeometry) throw new Error("Unknown block geometry: " + appearance.geometry.shape);
  const geometry = makeGeometry(size, appearance.geometry);
  geometry.scale(appearance.geometry.scale, appearance.geometry.scale, appearance.geometry.scale);
  const assemble = assemblyRegistry.get(appearance.assembly);
  if (!assemble) throw new Error("Unknown appearance assembly: " + appearance.assembly);
  return assemble({ identity, definition, geometry, size });
}
