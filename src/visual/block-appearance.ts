import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { IdentityTrait } from "../cards";
import type { BlockMaterial } from "../materials";

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

function drawSteel(g: CanvasRenderingContext2D, random: () => number): void {
  gradient(g, [
    [0, "#87959a"],
    [0.35, "#465259"],
    [0.62, "#77858b"],
    [1, "#29343a"],
  ]);
  for (let y = 0; y < SIZE; y += 3) {
    g.fillStyle = y % 9 === 0 ? "#dce6e414" : "#111b2312";
    g.fillRect(0, y, SIZE, 1);
  }
  flecks(g, random, 230, "#7a3e2780", 2);
  border(g, "#202b32", 9);
  border(g, "#c1cac59a", 2);
  for (const x of [29, SIZE - 29])
    for (const y of [29, SIZE - 29]) {
      g.beginPath();
      g.fillStyle = "#263036";
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.fillStyle = "#c3c7bd";
      g.arc(x - 1, y - 1, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#555d5e";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 5, y + 2);
      g.lineTo(x + 5, y - 3);
      g.stroke();
    }
}

/**
 * Glass: a pane of clear glass in a lead-and-steel came, like one panel of a stained-glass
 * lantern (each face of the block is one pane; the material tints them). The pane carries
 * low alpha so it reads as clear; the frame and print are solid.
 */
function drawGlass(g: CanvasRenderingContext2D, random: () => number): void {
  g.clearRect(0, 0, SIZE, SIZE);
  gradient(g, [
    [0, "#f4fbff38"],
    [0.5, "#dff1f730"],
    [1, "#f8fdff38"],
  ]);
  // Seeds: the small bubbles of hand-made glass.
  for (let n = 0; n < 14; n++) {
    g.strokeStyle = "#ffffff70";
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(
      30 + random() * 196,
      30 + random() * 196,
      1 + random() * 3,
      1 + random() * 2,
      random() * 3,
      0,
      Math.PI * 2,
    );
    g.stroke();
  }
  // The came: a dark metal frame with a bright bevel along its inner edge.
  g.strokeStyle = "#262b30";
  g.lineWidth = 30;
  g.strokeRect(0, 0, SIZE, SIZE);
  g.strokeStyle = "#8c969e";
  g.lineWidth = 3;
  g.strokeRect(16, 16, SIZE - 32, SIZE - 32);
  g.strokeStyle = "#4a535b";
  g.lineWidth = 2;
  g.strokeRect(3, 3, SIZE - 6, SIZE - 6);
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

function drawGold(g: CanvasRenderingContext2D, random: () => number): void {
  gradient(g, [
    [0, "#fff0a4"],
    [0.22, "#a96d18"],
    [0.5, "#f4cf54"],
    [0.75, "#b57a22"],
    [1, "#ffdf6d"],
  ]);
  for (let n = 0; n < 34; n++) {
    g.fillStyle = n % 3 === 0 ? "#fff5bd22" : "#51310818";
    g.fillRect(0, random() * SIZE, SIZE, 1 + random() * 2);
  }
  border(g, "#714710", 8);
  border(g, "#ffef9e", 2);
  for (const x of [29, SIZE - 29])
    for (const y of [29, SIZE - 29]) {
      g.fillStyle = "#ffe9a2";
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
}

function drawDelft(g: CanvasRenderingContext2D): void {
  gradient(g, [
    [0, "#faf8ed"],
    [0.5, "#d7e8ed"],
    [1, "#f9f6e9"],
  ]);
  border(g, "#315c8d", 7);
  border(g, "#7bacc3", 2);
  for (const x of [37, SIZE - 37])
    for (const y of [37, SIZE - 37]) {
      g.strokeStyle = "#426a9d";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 14, 0.2, Math.PI * 1.8);
      g.stroke();
      g.fillStyle = "#bd4850";
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  g.strokeStyle = "#7bacc3";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(76, 64);
  g.quadraticCurveTo(128, 46, 180, 64);
  g.moveTo(76, 192);
  g.quadraticCurveTo(128, 210, 180, 192);
  g.stroke();
}

function drawTerracotta(g: CanvasRenderingContext2D, random: () => number): void {
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
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas 2D is unavailable");
  const random = randomFor(identity, kind, endGrain);
  switch (kind) {
    case "paper":
      g.fillStyle = "#f6f0e3";
      g.fillRect(0, 0, SIZE, SIZE);
      border(g, "#b8b0a2", 6);
      break;
    case "wood":
      drawWood(g, random, endGrain);
      break;
    case "steel":
      drawSteel(g, random);
      break;
    case "glass":
      drawGlass(g, random);
      break;
    case "prismatic":
      drawPrismatic(g, random);
      break;
    case "gold":
      drawGold(g, random);
      break;
    case "delft":
      drawDelft(g);
      break;
    case "terracotta":
      drawTerracotta(g, random);
      break;
    case "ice":
      drawIce(g, random);
      break;
    case "meat":
      drawMeat(g, random);
      break;
  }
  const dark = ["wood", "steel", "gold", "terracotta", "meat"].includes(kind);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = dark ? "#28170caa" : "#ffffffbb";
  g.shadowBlur = dark ? 5 : 3;
  g.fillStyle =
    identity.suit.color === "#bd3651"
      ? kind === "wood"
        ? "#a32536"
        : kind === "steel"
          ? "#ff8790"
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

/** Reflections for glass and crystal; set once by the game (see setGlassEnvironment). */
let glassEnvironment: THREE.Texture | null = null;

/** Give glass and crystal something to reflect (a PMREM environment map). */
export function setGlassEnvironment(texture: THREE.Texture): void {
  glassEnvironment = texture;
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

/** Stained glass: each of the six panes has its own tint. BoxGeometry face order. */
const paneTints = [0xff9aa8, 0xffd27a, 0xf4fbff, 0x8fe3b0, 0x8fb4ff, 0xc9a6ff];

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
    envMap: glassEnvironment,
    envMapIntensity: kind === "prismatic" ? 1.6 : 1.1,
    transparent: true,
    depthWrite: false,
    ...(kind === "prismatic" ? prismaticFire : {}),
  });
}

/** Thin-film colour play that shifts with the view angle: the crystal's fire. */
const prismaticFire = {
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
    envMap: glassEnvironment,
    envMapIntensity: prismatic ? 1.6 : 1.1,
    ...(prismatic ? prismaticFire : {}),
  });
}

function surface(texture: THREE.CanvasTexture, kind: BlockMaterial): THREE.MeshStandardMaterial {
  if (kind === "ice") {
    return new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.48,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.38,
      transparent: true,
      opacity: 0.94,
    });
  }
  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: kind === "gold" ? 0.28 : kind === "steel" ? 0.5 : 0.75,
    metalness: kind === "gold" ? 0.55 : kind === "steel" ? 0.42 : 0,
  });
}

const edgeColors: Record<BlockMaterial, number> = {
  paper: 0x6b6c73,
  wood: 0x76502b,
  steel: 0x303a40,
  // The came between panes: dark metal.
  glass: 0x2a2f34,
  // Facet lines of the cut stone.
  prismatic: 0xf2e8ff,
  gold: 0x9c661e,
  delft: 0x48709c,
  terracotta: 0x733d2b,
  ice: 0xd3f7ff,
  meat: 0x6b2538,
};

export function createBlockAppearance(
  identity: IdentityTrait,
  kind: BlockMaterial,
  size: number,
): BlockAppearance {
  const geometry =
    kind === "meat"
      ? new RoundedBoxGeometry(size, size, size, 3, size * 0.09)
      : kind === "prismatic"
        ? // One segment makes the rounding a flat bevel: chamfered edges, like a square cut.
          new RoundedBoxGeometry(size, size, size, 1, size * 0.14)
        : new THREE.BoxGeometry(size, size, size);
  const edgeColor = edgeColors[kind];
  const edgeOpacity = kind === "meat" ? 0 : kind === "ice" ? 0.65 : kind === "prismatic" ? 0.55 : 1;

  if (kind === "glass" || kind === "prismatic") {
    const texture = faceTexture(identity, kind, false);
    const mask = clearMask(texture);
    // Glass panes are each tinted; crystal is one clear stone.
    const tints = kind === "glass" ? paneTints : paneTints.map(() => 0xffffff);
    const inHand = tints.map((tint) => clearInHand(texture, kind, tint));
    const onTable = tints.map((tint) => clearOnTable(texture, mask, kind, tint, size));
    return {
      geometry,
      textures: [texture, mask],
      materials: inHand,
      boardMaterials: onTable,
      edgeColor,
      edgeOpacity,
    };
  }

  const sideTexture = faceTexture(identity, kind, false);
  const sideMaterial = surface(sideTexture, kind);
  // BoxGeometry order is +X, -X, +Y, -Y, +Z, -Z. Wood reveals end grain on Y.
  const endTexture = kind === "wood" ? faceTexture(identity, kind, true) : null;
  const endMaterial = endTexture ? surface(endTexture, kind) : sideMaterial;
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
    textures: endTexture ? [sideTexture, endTexture] : [sideTexture],
    materials,
    edgeColor,
    edgeOpacity,
  };
}
