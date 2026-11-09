import * as THREE from "three";
import type { PassivePalette } from "./passives";

export type PassiveShape = "cube" | "octahedron" | "d10" | "icosahedron";
export type PassiveFaceDesign = { label: string; pips?: number };
export type PassiveAppearance = {
  symbol: string;
  palette: PassivePalette;
  shape?: PassiveShape;
  faces?: readonly PassiveFaceDesign[];
};

function markedTexture(appearance: PassiveAppearance, face: PassiveFaceDesign): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = appearance.palette.face;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = appearance.palette.edge;
  ctx.lineWidth = 9;
  ctx.strokeRect(12, 12, 232, 232);
  ctx.lineWidth = 2;
  ctx.strokeRect(23, 23, 210, 210);
  ctx.fillStyle = appearance.palette.ink;
  if (face.pips) {
    const positions: Record<number, number[][]> = {
      1: [[128, 128]], 2: [[66, 66], [190, 190]], 3: [[66, 66], [128, 128], [190, 190]],
      4: [[66, 66], [190, 66], [66, 190], [190, 190]],
      5: [[66, 66], [190, 66], [128, 128], [66, 190], [190, 190]],
      6: [[66, 56], [66, 128], [66, 200], [190, 56], [190, 128], [190, 200]],
    };
    for (const [x, y] of positions[face.pips] ?? []) {
      ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `bold ${face.label.length > 2 ? 76 : 104}px system-ui, sans-serif`;
    ctx.fillText(face.label, 128, 132, 202);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function polyhedronGeometry(shape: PassiveShape): THREE.BufferGeometry {
  if (shape === "cube") return new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  if (shape === "octahedron") return new THREE.OctahedronGeometry(0.72, 0).toNonIndexed();
  if (shape === "icosahedron") return new THREE.IcosahedronGeometry(0.76, 0).toNonIndexed();
  // A ten-faced, non-cubic die: two pentagonal pyramids joined at their bases.
  // The shared pentagonal equator gives ten individually addressable numbered faces.
  const primal: THREE.Vector3[] = [];
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 5; i++) {
    const angle = (2 * Math.PI * i) / 5 + ring * (Math.PI / 5);
    primal.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), ring ? -0.48 : 0.48));
  }
  const faces: number[][] = [[0, 1, 2, 3, 4], [9, 8, 7, 6, 5]];
  for (let i = 0; i < 5; i++) {
    const n = (i + 1) % 5;
    faces.push([i, n, 5 + i], [n, 5 + n, 5 + i]);
  }
  const dual: THREE.Vector3[] = [];
  for (const face of faces) {
    const a = primal[face[0]!]!, b = primal[face[1]!]!, c = primal[face[2]!]!;
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    let distance = normal.dot(a);
    if (distance < 0) { normal.negate(); distance = -distance; }
    dual.push(normal.multiplyScalar(0.72 / distance));
  }
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let vertex = 0; vertex < primal.length; vertex++) {
    const incident = faces.map((face, index) => face.includes(vertex) ? index : -1).filter((index) => index >= 0);
    const center = dual[incident[0]!]!;
    const axis = primal[vertex]!.clone().normalize();
    const u = center.clone().sub(axis.clone().multiplyScalar(center.dot(axis))).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    incident.sort((left, right) => {
      const lp = dual[left]!.clone().sub(center);
      const rp = dual[right]!.clone().sub(center);
      return Math.atan2(lp.dot(v), lp.dot(u)) - Math.atan2(rp.dot(v), rp.dot(u));
    });
    const triangles = [
      [[incident[0]!, [0, 0]], [incident[1]!, [1, 0]], [incident[2]!, [1, 1]]],
      [[incident[0]!, [0, 0]], [incident[2]!, [1, 1]], [incident[3]!, [0, 1]]],
    ] as const;
    for (const tri of triangles) for (const [index, uv] of tri) {
      const p = dual[index]!; vertices.push(p.x, p.y, p.z); uvs.push(uv[0], uv[1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Shared geometry and per-face artwork builder used by rack tokens and shop previews. */
export function createPassiveVisual(appearance: PassiveAppearance, size: number): {
  geometry: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial[];
  textures: THREE.CanvasTexture[];
  edges: THREE.EdgesGeometry;
} {
  const shape = appearance.shape ?? "cube";
  const geometry = polyhedronGeometry(shape);
  geometry.clearGroups();
  const faceCount = shape === "cube" ? 6 : shape === "d10" ? 10 : geometry.getAttribute("position").count / 3;
  const verticesPerFace = shape === "cube" || shape === "d10" ? 6 : 3;
  let designs = appearance.faces ?? Array.from({ length: faceCount }, (_i) => ({ label: appearance.symbol }));
  if (shape === "cube" && appearance.faces?.some(({ pips }) => pips !== undefined))
    designs = [appearance.faces[0]!, appearance.faces[5]!, appearance.faces[1]!, appearance.faces[4]!, appearance.faces[2]!, appearance.faces[3]!];
  else if (shape !== "cube" && designs.length === faceCount) {
    const positions = geometry.getAttribute("position");
    const stride = verticesPerFace;
    const centers = Array.from({ length: faceCount }, (_, face) => {
      const center = new THREE.Vector3();
      for (let vertex = 0; vertex < stride; vertex++) center.add(new THREE.Vector3().fromBufferAttribute(positions, face * stride + vertex));
      return center.divideScalar(stride);
    });
    const remaining = new Set(centers.map((_, i) => i));
    const paired = [...designs];
    let value = 1;
    while (remaining.size) {
      const first = Math.min(...remaining);
      remaining.delete(first);
      if (!remaining.size) break;
      const direction = centers[first]!.clone().normalize().negate();
      const second = [...remaining].sort((a, b) => centers[a]!.clone().normalize().dot(direction) - centers[b]!.clone().normalize().dot(direction))[0]!;
      remaining.delete(second);
      paired[first] = { label: String(value) };
      paired[second] = { label: String(faceCount + 1 - value) };
      value++;
    }
    designs = paired;
  }
  if (shape !== "cube" && shape !== "d10") {
    const uvs = Array.from({ length: faceCount }, () => [0, 0, 1, 0, 0.5, 1]).flat();
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  }
  for (let face = 0; face < faceCount; face++) geometry.addGroup(face * verticesPerFace, verticesPerFace, face);
  geometry.scale(size, size, size);
  const textures = Array.from({ length: faceCount }, (_, i) => markedTexture(appearance, designs[i] ?? { label: appearance.symbol }));
  const materials = textures.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.12 }));
  return { geometry, materials, textures, edges: new THREE.EdgesGeometry(geometry) };
}
