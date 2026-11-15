/**
 * How a passive token is drawn (#125): a registered **shape** and the artwork on each of its
 * faces, both data on the passive's definition. The rack and the shop build their tokens here,
 * so neither knows what shape a passive has.
 *
 * A shape registers only its geometry; nothing here asks which shape it is. Faces are listed in
 * a logical order, and every shape places them the same way: face `i` sits opposite face
 * `count - 1 - i`. So a die whose faces read 1 to N has opposite faces summing to N + 1 (a six-
 * sided die's 1-6, 2-5 and 3-4) without any die-specific code.
 */
import * as THREE from "three";
import type { PrepassReference } from "./visual/appearance-prepass";
import { Registry } from "./core/registry";
import type { PassivePalette } from "./passives";

/** One face's artwork: a label, or a standard pip pattern (1 to 6) instead of the label. */
export type PassiveFaceDesign = {
  label: string;
  pips?: number;
  /** This face's artwork colour; its category palette's ink when absent (#1005). */
  ink?: string;
};

/** A token's look. With no shape it is a cube; with no faces every face shows the symbol. */
export type PassiveTokenAppearance = {
  symbol: string;
  palette: PassivePalette;
  shape?: string;
  faces?: readonly PassiveFaceDesign[];
  /**
   * A registered visual builder and its configuration (#391), for a token drawn some other way
   * than a painted shape (a transmogrifier is a plain block of its material). The painted
   * token when absent.
   */
  visual?: { builder: string; config: unknown };
};

/** A registered token shape: its own geometry, and nothing else. */
export type PassiveShape = {
  /**
   * Unit-sized, non-indexed geometry whose UVs map each face onto a whole face texture. The
   * faces are runs of `verticesPerFace` vertices, in order.
   */
  geometry(): THREE.BufferGeometry;
  /** Vertices that make one face: 6 for a quad (two triangles), 3 for a triangle. */
  verticesPerFace: number;
  /**
   * The part of the face texture a face actually shows, as a UV polygon (#1002). Its artwork is
   * framed along this outline and its label fitted inside it. The whole square when absent.
   */
  faceOutline?: FaceOutline;
};

/** A face's visible region in its texture: UV points (u right, v up), in order. */
export type FaceOutline = readonly (readonly [number, number])[];

/** The visible part of a face texture under the triangle UVs below. */
export const triangleFaceOutline: FaceOutline = [
  [0, 0],
  [1, 0],
  [0.5, 1],
];

export const passiveShapes = new Registry<PassiveShape>("passive shape");

/** The shape a token takes when its appearance names none: the original cube. */
export const defaultPassiveShape = "cube";

/** Paints one face's artwork; injectable so tests can build tokens without a canvas. */
export type PassiveFacePainter = (
  palette: PassivePalette,
  face: PassiveFaceDesign,
  outline?: FaceOutline,
) => THREE.Texture;

/** Each triangular face shows a triangle cut from its face texture. */
function withTriangleFaceUvs(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const faces = geometry.getAttribute("position").count / 3;
  const uvs = Array.from({ length: faces }, () => triangleFaceOutline.flat()).flat();
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

passiveShapes.register("cube", {
  geometry: () => new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  verticesPerFace: 6,
});
passiveShapes.register("octahedron", {
  geometry: () => withTriangleFaceUvs(new THREE.OctahedronGeometry(0.72, 0).toNonIndexed()),
  verticesPerFace: 3,
  faceOutline: triangleFaceOutline,
});
passiveShapes.register("icosahedron", {
  geometry: () => withTriangleFaceUvs(new THREE.IcosahedronGeometry(0.76, 0).toNonIndexed()),
  verticesPerFace: 3,
  faceOutline: triangleFaceOutline,
});
passiveShapes.register("d10", { geometry: () => trapezohedronGeometry(), verticesPerFace: 6 });

/** A pentagonal trapezohedron: ten kite-shaped faces, each two triangles with quad UVs. */
function trapezohedronGeometry(): THREE.BufferGeometry {
  // The dual of a pentagonal antiprism: each antiprism vertex becomes one kite face.
  const primal: THREE.Vector3[] = [];
  for (let ring = 0; ring < 2; ring++)
    for (let i = 0; i < 5; i++) {
      const angle = (2 * Math.PI * i) / 5 + ring * (Math.PI / 5);
      primal.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), ring ? -0.48 : 0.48));
    }
  const faces: number[][] = [
    [0, 1, 2, 3, 4],
    [9, 8, 7, 6, 5],
  ];
  for (let i = 0; i < 5; i++) {
    const n = (i + 1) % 5;
    faces.push([i, n, 5 + i], [n, 5 + n, 5 + i]);
  }
  const dual = faces.map((face) => {
    const [a, b, c] = face.map((index) => primal[index]!);
    const normal = new THREE.Vector3()
      .subVectors(b!, a!)
      .cross(new THREE.Vector3().subVectors(c!, a!))
      .normalize();
    const distance = Math.abs(normal.dot(a!));
    return normal.multiplyScalar(Math.sign(normal.dot(a!)) * (0.72 / distance));
  });
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let vertex = 0; vertex < primal.length; vertex++) {
    const incident = faces.flatMap((face, index) => (face.includes(vertex) ? [index] : []));
    const center = dual[incident[0]!]!;
    const axis = primal[vertex]!.clone().normalize();
    const u = center
      .clone()
      .sub(axis.clone().multiplyScalar(center.dot(axis)))
      .normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    incident.sort((left, right) => {
      const lp = dual[left]!.clone().sub(center);
      const rp = dual[right]!.clone().sub(center);
      return Math.atan2(lp.dot(v), lp.dot(u)) - Math.atan2(rp.dot(v), rp.dot(u));
    });
    const corners: [number, [number, number]][] = [
      [incident[0]!, [0, 0]],
      [incident[1]!, [1, 0]],
      [incident[2]!, [1, 1]],
      [incident[0]!, [0, 0]],
      [incident[2]!, [1, 1]],
      [incident[3]!, [0, 1]],
    ];
    for (const [index, uv] of corners) {
      const point = dual[index]!;
      vertices.push(point.x, point.y, point.z);
      uvs.push(...uv);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** The centre of each face, in geometry order. */
function faceCentres(geometry: THREE.BufferGeometry, verticesPerFace: number): THREE.Vector3[] {
  const positions = geometry.getAttribute("position");
  const count = positions.count / verticesPerFace;
  return Array.from({ length: count }, (_, face) => {
    const centre = new THREE.Vector3();
    for (let vertex = 0; vertex < verticesPerFace; vertex++)
      centre.add(
        new THREE.Vector3().fromBufferAttribute(positions, face * verticesPerFace + vertex),
      );
    return centre.divideScalar(verticesPerFace);
  });
}

/**
 * Where each logical face goes: `order[i]` is the geometry face for logical face `i`, chosen so
 * that logical faces `i` and `count - 1 - i` are the most nearly opposite pair. The same rule
 * for every shape.
 */
export function oppositePairOrder(centres: readonly THREE.Vector3[]): number[] {
  const count = centres.length;
  const order: number[] = Array.from({ length: count }, () => 0);
  const remaining = new Set(centres.keys());
  for (let slot = 0; remaining.size; slot++) {
    const first = Math.min(...remaining);
    remaining.delete(first);
    order[slot] = first;
    const away = centres[first]!.clone().normalize().negate();
    const opposite = [...remaining].sort(
      (a, b) =>
        centres[b]!.clone().normalize().dot(away) - centres[a]!.clone().normalize().dot(away),
    )[0];
    if (opposite === undefined) continue;
    remaining.delete(opposite);
    order[count - 1 - slot] = opposite;
  }
  return order;
}

/** The look every current passive had: its symbol in a framed face, or a pip pattern. */
/**
 * Where a face's artwork goes, in 256-pixel canvas space (#1002): the outline's points, its
 * label centre and the radius of the largest circle there that stays inside every edge.
 */
export function faceLayout(outline: FaceOutline): {
  points: { x: number; y: number }[];
  centre: { x: number; y: number };
  radius: number;
} {
  // Canvas rows run down; a CanvasTexture is flipped, so v = 1 is the canvas's top.
  const points = outline.map(([u, v]) => ({ x: u * 256, y: (1 - v) * 256 }));
  const n = points.length;
  // The incentre for a triangle (vertices weighted by opposite side); the vertex mean otherwise.
  const side = (i: number) => {
    const a = points[(i + 1) % n]!;
    const b = points[(i + 2) % n]!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const weights = n === 3 ? points.map((_, i) => side(i)) : points.map(() => 1);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const centre = {
    x: points.reduce((sum, p, i) => sum + p.x * weights[i]!, 0) / total,
    y: points.reduce((sum, p, i) => sum + p.y * weights[i]!, 0) / total,
  };
  const radius = Math.min(
    ...points.map((a, i) => {
      const b = points[(i + 1) % n]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      return Math.abs((b.x - a.x) * (a.y - centre.y) - (a.x - centre.x) * (b.y - a.y)) / length;
    }),
  );
  return { points, centre, radius };
}

const squareOutline: FaceOutline = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export function paintPassiveFace(
  palette: PassivePalette,
  face: PassiveFaceDesign,
  outline?: FaceOutline,
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = palette.face;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = palette.edge;
  const { points, centre, radius } = faceLayout(outline ?? squareOutline);
  /** The outline drawn `inset` pixels in from the face's edges, towards its centre. */
  const frame = (inset: number, width: number) => {
    const scale = (radius - inset) / radius;
    context.lineWidth = width;
    context.beginPath();
    points.forEach(({ x, y }, i) => {
      const px = centre.x + (x - centre.x) * scale;
      const py = centre.y + (y - centre.y) * scale;
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.closePath();
    context.stroke();
  };
  if (outline) {
    frame(17, 10);
    frame(28, 2);
  } else {
    // The square face keeps its original frame exactly.
    context.lineWidth = 10;
    context.strokeRect(12, 12, 232, 232);
    context.lineWidth = 2;
    context.strokeRect(24, 24, 208, 208);
  }
  context.fillStyle = face.ink ?? palette.ink;
  for (const [x, y] of pipLayouts[face.pips ?? 0] ?? []) {
    context.beginPath();
    context.arc(x, y, 17, 0, Math.PI * 2);
    context.fill();
  }
  // A pip face carries no label: its pips are the artwork.
  const label = face.pips ? "" : face.label;
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (!outline) {
    // The square face keeps its original lettering exactly.
    context.font = `bold ${label.length > 2 ? 92 : 116}px system-ui, sans-serif`;
    context.fillText(label, 128, 131, 206);
  } else {
    // Fitted inside the frame: the text's box stays within the inner circle, with a margin.
    const room = radius - 34;
    let size = Math.floor(room * 1.25);
    context.font = `bold ${size}px system-ui, sans-serif`;
    const width = context.measureText(label).width;
    if (width > room * 1.6) size = Math.floor((size * room * 1.6) / width);
    context.font = `bold ${size}px system-ui, sans-serif`;
    context.fillText(label, centre.x, centre.y + size * 0.04);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Standard pip positions on a 256-pixel face, by pip count. */
const pipLayouts: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  0: [],
  1: [[128, 128]],
  2: [
    [66, 66],
    [190, 190],
  ],
  3: [
    [66, 66],
    [128, 128],
    [190, 190],
  ],
  4: [
    [66, 66],
    [190, 66],
    [66, 190],
    [190, 190],
  ],
  5: [
    [66, 66],
    [190, 66],
    [128, 128],
    [66, 190],
    [190, 190],
  ],
  6: [
    [66, 56],
    [66, 128],
    [66, 200],
    [190, 56],
    [190, 128],
    [190, 200],
  ],
};

export type PassiveVisual = {
  geometry: THREE.BufferGeometry;
  /** One material per face, indexed by the geometry's face groups. */
  materials: THREE.MeshStandardMaterial[];
  /** The distinct face textures (faces with the same artwork share one). */
  textures: THREE.Texture[];
  edges: THREE.EdgesGeometry;
  /** The artwork on each geometry face, in geometry order. */
  faces: readonly PassiveFaceDesign[];
  /**
   * Meshes drawn inside the token (a material block's fire core or fluid, #391): consumers
   * attach them to the token mesh; `dispose` releases them.
   */
  extras?: readonly (THREE.Mesh | THREE.Points)[];
  /** Passes its look needs before its host's render (#970): its block appearance's, if any. */
  prepasses?: readonly PrepassReference[];
  dispose(): void;
};

/**
 * Attach a token's extras to its mesh, one at a time: spreading an empty list into `add()` makes
 * three.js log an error for every token without extras (#630).
 */
export function addExtras(mesh: THREE.Object3D, extras: PassiveVisual["extras"]): void {
  for (const extra of extras ?? []) mesh.add(extra);
}

/** Builds a token's visual some other way than the painted shape (#391), by name. */
export type PassiveVisualBuilder = (
  appearance: PassiveTokenAppearance,
  size: number,
  config: unknown,
) => PassiveVisual;
export const passiveVisualBuilders = new Registry<PassiveVisualBuilder>("passive visual builder");

/**
 * A token's geometry and per-face materials, shared by the rack, the shop and the browser: its
 * appearance's registered builder, or the painted shape.
 */
export function createPassiveVisual(
  appearance: PassiveTokenAppearance,
  size: number,
  paint: PassiveFacePainter = paintPassiveFace,
): PassiveVisual {
  return (
    [appearance.visual ?? []]
      .flat()
      .reduce<PassiveVisual | null>(
        (_, { builder, config }) => passiveVisualBuilders.get(builder)(appearance, size, config),
        null,
      ) ?? paintedVisual(appearance, size, paint)
  );
}

/** The painted token: a registered shape with artwork on each face (#125). */
function paintedVisual(
  appearance: PassiveTokenAppearance,
  size: number,
  paint: PassiveFacePainter,
): PassiveVisual {
  const shape = passiveShapes.get(appearance.shape ?? defaultPassiveShape);
  const geometry = shape.geometry();
  const centres = faceCentres(geometry, shape.verticesPerFace);
  const order = oppositePairOrder(centres);
  const designs = Array.from(
    { length: centres.length },
    (_, index) => appearance.faces?.[index] ?? { label: appearance.symbol },
  );
  const faces: PassiveFaceDesign[] = Array.from({ length: centres.length }, () => designs[0]!);
  order.forEach((geometryFace, logical) => (faces[geometryFace] = designs[logical]!));
  geometry.clearGroups();
  for (let face = 0; face < faces.length; face++)
    geometry.addGroup(face * shape.verticesPerFace, shape.verticesPerFace, face);
  geometry.scale(size, size, size);
  const painted = new Map<string, THREE.Texture>();
  const textureFor = (face: PassiveFaceDesign) => {
    const key = `${face.label}\u0000${face.pips ?? ""}\u0000${face.ink ?? ""}`;
    const texture = painted.get(key) ?? paint(appearance.palette, face, shape.faceOutline);
    painted.set(key, texture);
    return texture;
  };
  const materials = faces.map(
    (face) =>
      new THREE.MeshStandardMaterial({ map: textureFor(face), roughness: 0.7, metalness: 0.12 }),
  );
  const edges = new THREE.EdgesGeometry(geometry);
  const textures = [...painted.values()];
  return {
    geometry,
    materials,
    textures,
    edges,
    faces,
    dispose() {
      geometry.dispose();
      edges.dispose();
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
    },
  };
}
