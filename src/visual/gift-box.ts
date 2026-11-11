/**
 * The gift box (#496, part of #492): a wrapped-present look as a block assembly, `giftBox` in the
 * appearance's assembly registry, so a material names it and no rendering code knows what a
 * Present is.
 *
 * - **Wrap:** foil-like paper on the block's (rounded) geometry. A painted texture of bright and dark
 *   creases doubles as the bump map, on a metallic, low-roughness clearcoated surface, so it
 *   catches the light like foil rather than reading as a flat colour.
 * - **Ribbon:** a shiny band up each side, a cross on top (+y) under the rosette, and folded-paper
 *   seams and flaps underneath (−y), always opposite the rosette however the block turns: the faces
 *   are the geometry's own +y and −y groups.
 * - **Rosette:** no reusable model exists in the project, and downloading one needs the owner's
 *   approval, so this is the ticket's simple fallback: radial ribbon loops round a knot, built once
 *   per box from small shared shapes, in the ribbon's colour.
 * - **Colours:** red, green or blue wrap; a ribbon from a contrasting set that never shares the wrap's
 *   colour. Both come from the block's own art seed: cosmetic, the same every time it's drawn, and
 *   never the run's random stream. No rank or suit is printed.
 * - **Resources:** the box owns its textures and materials (released by the block's usual cleanup);
 *   the rosette's geometry goes with its material.
 */
import * as THREE from "three";
import {
  getReflectionEnvironment,
  type AssemblyContext,
  type BlockAppearance,
} from "./block-appearance";
import type { FaceArt } from "./face-art";

/** Wrapping colours, and ribbon colours that contrast with them. */
const wraps = [
  { name: "red", colour: 0xc0182a },
  { name: "green", colour: 0x1f8a3c },
  { name: "blue", colour: 0x1f4fb8 },
];
const ribbons = [
  { name: "gold", colour: 0xe8c25a },
  { name: "silver", colour: 0xd8dde6 },
  { name: "white", colour: 0xf4f1ea },
  { name: "red", colour: 0xc0182a },
  { name: "green", colour: 0x1f8a3c },
  { name: "blue", colour: 0x1f4fb8 },
];

/** A random stream from the block's art seed: cosmetic, and the same every time it's drawn. */
function seeded(art: FaceArt): () => number {
  let seed = 2166136261;
  for (const char of `gift-${art.seed}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}

/** The box's wrap and ribbon colours: the ribbon never shares the wrap's colour. */
export function giftColours(art: FaceArt): { wrap: number; ribbon: number } {
  const random = seeded(art);
  const wrap = wraps[Math.floor(random() * wraps.length)]!;
  const contrasting = ribbons.filter(({ name }) => name !== wrap.name);
  const ribbon = contrasting[Math.floor(random() * contrasting.length)]!;
  return { wrap: wrap.colour, ribbon: ribbon.colour };
}

const SIZE = 256;
const css = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;

/** Paint foil: the wrap colour with a sheen and scattered creases (bright and dark). */
function paintFoil(g: CanvasRenderingContext2D, wrap: number, random: () => number): void {
  g.fillStyle = css(wrap);
  g.fillRect(0, 0, SIZE, SIZE);
  const sheen = g.createLinearGradient(0, 0, SIZE, SIZE);
  sheen.addColorStop(0, "rgba(255,255,255,0.35)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0.2)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, SIZE, SIZE);
  for (let crease = 0; crease < 40; crease++) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const angle = random() * Math.PI;
    const length = 20 + random() * 60;
    g.strokeStyle = random() < 0.5 ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.22)";
    g.lineWidth = 1 + random() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    g.stroke();
  }
}

/** A shiny ribbon band across the face, vertically or horizontally. */
function paintBand(g: CanvasRenderingContext2D, ribbon: number, across: boolean): void {
  const width = SIZE * 0.18;
  const from = (SIZE - width) / 2;
  g.fillStyle = css(ribbon);
  if (across) g.fillRect(0, from, SIZE, width);
  else g.fillRect(from, 0, width, SIZE);
  g.fillStyle = "rgba(255,255,255,0.3)";
  if (across) g.fillRect(0, from + width * 0.15, SIZE, width * 0.12);
  else g.fillRect(from + width * 0.15, 0, width * 0.12, SIZE);
}

/** Folded paper underneath: diagonal flaps meeting in a seam, with a tape strip. */
function paintFolds(g: CanvasRenderingContext2D): void {
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(SIZE * 0.5, SIZE * 0.32);
  g.lineTo(SIZE, 0);
  g.moveTo(0, SIZE);
  g.lineTo(SIZE * 0.5, SIZE * 0.68);
  g.lineTo(SIZE, SIZE);
  g.moveTo(SIZE * 0.5, SIZE * 0.32);
  g.lineTo(SIZE * 0.5, SIZE * 0.68);
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.fillRect(SIZE * 0.44, SIZE * 0.3, SIZE * 0.12, SIZE * 0.4);
}

/** One face's canvas, painted by `paint`. */
function faceCanvas(paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas 2D is unavailable");
  paint(g);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Foil: metallic, glossy and clearcoated, its creases also its bump map. */
function foil(texture: THREE.CanvasTexture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 1.2,
    metalness: 0.55,
    roughness: 0.28,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    envMap: getReflectionEnvironment(),
  });
}

/** A rosette: radial ribbon loops round a knot, `size` across, in the ribbon colour. */
function rosette(ribbon: number, size: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const loops = 8;
  for (let i = 0; i < loops; i++) {
    const loop = new THREE.TorusGeometry(size * 0.16, size * 0.035, 6, 14);
    loop.scale(1, 0.55, 1);
    loop.rotateX(Math.PI / 2);
    loop.translate(size * 0.15, 0, 0);
    loop.rotateZ(0.35);
    loop.rotateY((i / loops) * Math.PI * 2);
    parts.push(loop);
  }
  parts.push(new THREE.SphereGeometry(size * 0.07, 10, 8));
  const geometry = mergeParts(parts);
  const material = new THREE.MeshPhysicalMaterial({
    color: ribbon,
    metalness: 0.35,
    roughness: 0.3,
    clearcoat: 0.8,
    envMap: getReflectionEnvironment(),
  });
  material.addEventListener("dispose", () => geometry.dispose());
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = size * 0.5;
  return mesh;
}

/** Merge parts into one geometry (positions and normals only), freeing the parts. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => part.toNonIndexed());
  const count = flat.reduce((sum, part) => sum + part.getAttribute("position").count, 0);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  let at = 0;
  for (const part of flat) {
    positions.set(part.getAttribute("position").array as Float32Array, at * 3);
    normals.set(part.getAttribute("normal").array as Float32Array, at * 3);
    at += part.getAttribute("position").count;
  }
  [...parts, ...flat].forEach((part) => part.dispose());
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return merged;
}

/** The `giftBox` assembly, listed in the block appearance's assembly registry. */
export function giftBox({ art, definition, geometry, size }: AssemblyContext): BlockAppearance {
  const { wrap, ribbon } = giftColours(art);
  const random = seeded(art);
  const sideTexture = faceCanvas((g) => {
    paintFoil(g, wrap, random);
    paintBand(g, ribbon, false);
  });
  const topTexture = faceCanvas((g) => {
    paintFoil(g, wrap, random);
    paintBand(g, ribbon, false);
    paintBand(g, ribbon, true);
  });
  const bottomTexture = faceCanvas((g) => {
    paintFoil(g, wrap, random);
    paintFolds(g);
  });
  const [side, upper, under] = [foil(sideTexture), foil(topTexture), foil(bottomTexture)];
  // A box geometry's groups in order: +x, −x, +y (top: ribbon cross under the rosette),
  // −y (bottom: the folds, so always opposite the rosette), +z, −z.
  const materials = [side, side, upper, under, side, side];
  return {
    geometry,
    textures: [sideTexture, topTexture, bottomTexture],
    materials,
    edgeColor: definition.appearance.edge.color,
    edgeOpacity: definition.appearance.edge.opacity,
    extras: [rosette(ribbon, size)],
  };
}
