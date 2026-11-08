import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { IdentityTrait } from "../cards";
import type { BlockMaterial } from "../materials";
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

function randomFor(identity: IdentityTrait, kind: BlockMaterial, endGrain: boolean): () => number {
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

function drawIce(g: CanvasRenderingContext2D, random: () => number): void {
  gradient(g, [
    [0, "#f4ffff"],
    [0.36, "#91c7d5"],
    [0.72, "#cdebf0"],
    [1, "#6ea4bc"],
  ]);
  flecks(g, random, 420, "#ffffff80", 2);
  for (let n = 0; n < 24; n++) {
    const x = random() * SIZE,
      y = random() * SIZE;
    g.strokeStyle = "#ecffff88";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 14, y + 8);
    g.lineTo(x, y);
    g.lineTo(x + 8, y - 14);
    g.stroke();
  }
  for (let n = 0; n < 35; n++) {
    g.beginPath();
    g.fillStyle = "#ffffff88";
    g.ellipse(
      random() * SIZE,
      random() * SIZE,
      1 + random() * 3,
      2 + random() * 5,
      0.3,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  border(g, "#efffff", 8);
  border(g, "#5d9eb4", 2);
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

function faceTexture(
  identity: IdentityTrait,
  kind: BlockMaterial,
  endGrain: boolean,
  /** Brush direction for steel, in radians. */
  brushAngle = 0,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas 2D is unavailable");
  const random = randomFor(identity, kind, endGrain);
  switch (kind) {
    case "paper":
      drawPaper(g);
      break;
    case "wood":
      drawWood(g, random, endGrain);
      break;
    case "steel":
      drawSteel(g, random, brushAngle);
      break;
    case "fire":
      drawFireFrame(g);
      break;
    case "prismatic":
      drawPrismatic(g, random);
      break;
    case "gold":
      drawGold(g);
      break;
    case "terracotta":
      drawTerracotta(g, random, potteryCracks(identity));
      break;
    case "ice":
      drawIce(g, random);
      break;
    case "meat":
      drawMeat(g, random);
      break;
  }
  // Brushed steel is now a light, bright grey, so it takes dark print like paper.
  const dark = ["wood", "gold", "terracotta", "meat"].includes(kind);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = dark ? "#28170caa" : "#ffffffbb";
  g.shadowBlur = dark ? 5 : 3;
  g.fillStyle =
    kind === "fire"
      ? identity.suit.color === "#bd3651"
        ? "#6e1a1a"
        : "#24282c"
      : identity.suit.color === "#bd3651"
        ? kind === "wood"
          ? "#a32536"
          : kind === "steel"
            ? "#a3202f"
            : "#bd3651"
        : dark
          ? kind === "steel" || kind === "meat"
            ? "#f4e9db"
            : "#422716"
          : "#182d4a";
  g.font = "bold 80px system-ui, sans-serif";
  g.fillText(identity.rank, 128, 100);
  g.font = "94px Georgia, serif";
  g.fillText(identity.suit.symbol, 128, 180);
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
  kind: "glass" | "prismatic",
  tint: number,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    color: tint,
    roughness: 0.06,
    metalness: 0,
    ior: kind === "prismatic" ? 2.33 : 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMap: reflectionEnvironment,
    envMapIntensity: kind === "prismatic" ? 1.6 : 1.1,
    transparent: true,
    depthWrite: false,
    ...(kind === "prismatic" ? prismaticFire : {}),
  });
}

/** Thin-film colour play that shifts with the view angle: the crystal's fire. */
const prismaticFire = {
  // Every bevel shaded as its own flat facet: hard edges, like a cut gem.
  flatShading: true,
  iridescence: 1,
  iridescenceIOR: 1.8,
  iridescenceThicknessMinimum: 150,
  iridescenceThicknessMaximum: 900,
};

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
  kind: "glass" | "prismatic",
  tint: number,
  size: number,
): THREE.MeshPhysicalMaterial {
  const prismatic = kind === "prismatic";
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    // Through a pane the tint is lighter than its face colour, so it still reads as clear.
    color: prismatic ? tint : new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.45),
    roughness: prismatic ? 0.02 : 0.05,
    metalness: 0,
    transmission: 1,
    transmissionMap: mask,
    ior: prismatic ? 2.33 : 1.52,
    thickness: prismatic ? size * 0.9 : size * 0.12,
    dispersion: prismatic ? 4 : 0.2,
    // Crystal deepens in colour through its body; thin panes do not.
    attenuationColor: new THREE.Color(tint),
    attenuationDistance: prismatic ? size * 6 : Infinity,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    specularIntensity: 1,
    envMap: reflectionEnvironment,
    envMapIntensity: prismatic ? 1.6 : 1.1,
    ...(prismatic ? prismaticFire : {}),
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

/**
 * How strongly each material's own pattern reads as relief, when it has no hand-made height
 * map: wood grain, terracotta pitting, meat marbling, ice cracks. 0 is flat.
 */
const patternRelief: Record<BlockMaterial, number> = {
  paper: 2,
  wood: 2.5,
  steel: 0,
  prismatic: 0,
  gold: 1.5,
  terracotta: 3,
  ice: 1.5,
  meat: 2,
  fire: 0,
};

function surface(
  texture: THREE.CanvasTexture,
  kind: BlockMaterial,
  /** A hand-made height map; otherwise the face pattern doubles as its own bump map. */
  height?: THREE.CanvasTexture,
): THREE.MeshStandardMaterial {
  const relief = { bumpMap: height ?? texture, bumpScale: patternRelief[kind] };
  if (kind === "ice") {
    return new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.48,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.38,
      transparent: true,
      opacity: 0.94,
      ...relief,
    });
  }
  if (kind === "gold") {
    // Polished solid gold: fully metallic, low roughness, a light clearcoat for gloss.
    return new THREE.MeshPhysicalMaterial({
      map: texture,
      ...relief,
      metalness: 1,
      roughness: 0.1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.05,
      envMap: reflectionEnvironment,
      envMapIntensity: 2.2,
    });
  }
  if (kind === "paper") {
    // Six sheets around nothing: the rounded corners are cut out (alphaTest), and both
    // sides of each sheet are drawn so the inside of the box shows through the gaps.
    return new THREE.MeshStandardMaterial({
      map: texture,
      ...relief,
      roughness: 0.8,
      metalness: 0,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    map: texture,
    ...relief,
    roughness: 0.75,
    metalness: 0,
  });
}

const edgeColors: Record<BlockMaterial, number> = {
  paper: 0x6b6c73,
  wood: 0x76502b,
  steel: 0x303a40,
  // The fire's iron frame.
  fire: 0x2a2f34,
  // Facet lines of the cut stone.
  prismatic: 0xf2e8ff,
  gold: 0x9c661e,
  terracotta: 0x733d2b,
  ice: 0xd3f7ff,
  meat: 0x6b2538,
};

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
function brushedSteel(
  texture: THREE.CanvasTexture,
  height: THREE.CanvasTexture,
  angle: number,
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    bumpMap: height,
    bumpScale: 3,
    metalness: 1,
    // Rough enough, and the reflections dim enough, that a face turned straight at the
    // studio's lights glows rather than blowing out to white.
    roughness: 0.42,
    anisotropy: 0.85,
    anisotropyRotation: angle,
    envMap: reflectionEnvironment,
    envMapIntensity: 0.7,
    clearcoat: 0.15,
    clearcoatRoughness: 0.3,
  });
}

export function createBlockAppearance(
  identity: IdentityTrait,
  kind: BlockMaterial,
  size: number,
): BlockAppearance {
  const geometry =
    kind === "meat"
      ? new RoundedBoxGeometry(size, size, size, 3, size * 0.09)
      : kind === "prismatic"
        ? // One segment makes the rounding a flat bevel: a chamfer, like a square cut. The
          // materials shade each facet flat, so the bevels meet the faces at hard edges.
          new RoundedBoxGeometry(size, size, size, 1, size * 0.14)
        : kind === "gold"
          ? // Softly rounded edges, as a casting comes out of the mould.
            new RoundedBoxGeometry(size, size, size, 5, size * 0.12)
          : new THREE.BoxGeometry(size, size, size);
  // See-through blocks are a hair smaller than a cell, so where they touch a neighbour the
  // two faces are not in the same plane and do not flicker (z-fight) through each other.
  if (["prismatic", "fire", "paper", "ice"].includes(kind)) geometry.scale(0.985, 0.985, 0.985);
  const edgeColor = edgeColors[kind];
  // Rounded castings (meat, gold) and the cut-cornered cards (paper) have no box edges to outline.
  const edgeOpacity =
    kind === "meat" || kind === "gold" || kind === "paper"
      ? 0
      : kind === "ice"
        ? 0.65
        : kind === "prismatic"
          ? 0.55
          : 1;

  if (kind === "prismatic") {
    // One clear stone: the same material on all six faces.
    const texture = faceTexture(identity, kind, false);
    const mask = clearMask(texture);
    const inHand = clearInHand(texture, kind, 0xffffff);
    const onTable = clearOnTable(texture, mask, kind, 0xffffff, size);
    return {
      geometry,
      textures: [texture, mask],
      materials: Array.from({ length: 6 }, () => inHand),
      boardMaterials: Array.from({ length: 6 }, () => onTable),
      edgeColor,
      edgeOpacity,
      extras: [createCrystalFire(geometry)],
    };
  }

  if (kind === "fire") {
    // An open iron frame with the fire burning inside: the openings are cut away
    // (alphaTest) and both sides drawn, so the far bars show through.
    const texture = faceTexture(identity, kind, false);
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
    return {
      geometry,
      textures: [texture, height],
      materials: Array.from({ length: 6 }, () => iron),
      edgeColor,
      edgeOpacity,
      extras: [createFireCore(size)],
    };
  }

  if (kind === "steel") {
    const angles = brushAngles(identity);
    const textures = angles.map((angle) => faceTexture(identity, kind, false, angle));
    const heights = angles.map((angle) => steelHeight(identity, angle));
    return {
      geometry,
      textures: [...textures, ...heights],
      materials: textures.map((texture, face) =>
        brushedSteel(texture, heights[face], angles[face]),
      ),
      edgeColor,
      edgeOpacity,
    };
  }

  const carvedHeight = (texture: THREE.CanvasTexture) =>
    kind === "gold"
      ? goldHeight(identity)
      : kind === "paper"
        ? paperHeight()
        : kind === "wood"
          ? woodHeight(texture, identity)
          : kind === "terracotta"
            ? terracottaHeight(texture, identity)
            : undefined;
  const sideTexture = faceTexture(identity, kind, false);
  const sideHeight = carvedHeight(sideTexture);
  const sideMaterial = surface(sideTexture, kind, sideHeight);
  // BoxGeometry order is +X, -X, +Y, -Y, +Z, -Z. Wood reveals end grain on Y.
  const endTexture = kind === "wood" ? faceTexture(identity, kind, true) : null;
  const endHeight = endTexture ? carvedHeight(endTexture) : undefined;
  const endMaterial = endTexture ? surface(endTexture, kind, endHeight) : sideMaterial;
  const materials = [
    sideMaterial,
    sideMaterial,
    endMaterial,
    endMaterial,
    sideMaterial,
    sideMaterial,
  ];
  return {
    geometry,
    textures: [sideTexture, endTexture, sideHeight, endHeight].filter(
      (texture): texture is THREE.CanvasTexture => texture !== null && texture !== undefined,
    ),
    materials,
    edgeColor,
    edgeOpacity,
  };
}
