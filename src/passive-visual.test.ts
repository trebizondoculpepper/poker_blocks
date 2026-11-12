import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import { passiveDefinitions } from "./passives";
import {
  addExtras,
  createPassiveVisual,
  defaultPassiveShape,
  passiveShapes,
  type PassiveFaceDesign,
  type PassiveFacePainter,
} from "./passive-visual";

const palette = { face: "#ffffff", ink: "#000000", edge: "#888888" };
/** Records each face's artwork instead of painting a canvas. */
const painter: PassiveFacePainter = (_palette, face) => {
  const texture = new THREE.Texture();
  texture.name = face.pips ? `pips:${face.pips}` : face.label;
  return texture;
};
const numbered = (count: number): PassiveFaceDesign[] =>
  Array.from({ length: count }, (_, index) => ({ label: String(index + 1) }));

/** For each face, its outward direction (the mean of its vertices). */
function faceDirections(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const positions = geometry.getAttribute("position");
  return geometry.groups.map(({ start, count }) => {
    const centre = new THREE.Vector3();
    for (let vertex = start; vertex < start + count; vertex++)
      centre.add(new THREE.Vector3().fromBufferAttribute(positions, vertex));
    return centre.divideScalar(count).normalize();
  });
}

/** The label on the face most nearly opposite face `index`. */
function oppositeLabel(visual: ReturnType<typeof createPassiveVisual>, index: number): string {
  const directions = faceDirections(visual.geometry);
  const away = directions[index]!.clone().negate();
  const opposite = directions
    .map((direction, face) => ({ face, dot: direction.dot(away) }))
    .sort((a, b) => b.dot - a.dot)[0]!.face;
  return visual.faces[opposite]!.label;
}

describe("passive token visuals (#125)", () => {
  it.each([
    ["cube", 6],
    ["octahedron", 8],
    ["d10", 10],
    ["icosahedron", 20],
  ])(
    "draws a %s with %i labelled faces, each opposite face summing to count + 1",
    (shape, count) => {
      const visual = createPassiveVisual(
        { symbol: "?", palette, shape, faces: numbered(count) },
        1,
        painter,
      );
      expect(visual.geometry.groups).toHaveLength(count);
      expect(visual.materials).toHaveLength(count);
      expect(visual.faces.map(({ label }) => Number(label)).sort((a, b) => a - b)).toEqual(
        numbered(count).map(({ label }) => Number(label)),
      );
      for (let face = 0; face < count; face++)
        expect(Number(visual.faces[face]!.label) + Number(oppositeLabel(visual, face))).toBe(
          count + 1,
        );
      expect(visual.materials.map(({ map }) => map!.name)).toEqual(
        visual.faces.map(({ label }) => label),
      );
    },
  );

  it("puts standard pips on a cube with opposite faces summing to seven", () => {
    const pips = [1, 2, 3, 4, 5, 6].map((count) => ({ label: String(count), pips: count }));
    const visual = createPassiveVisual(
      { symbol: "⚄", palette, shape: "cube", faces: pips },
      1,
      painter,
    );
    expect(visual.materials.map(({ map }) => map!.name).sort()).toEqual([
      "pips:1",
      "pips:2",
      "pips:3",
      "pips:4",
      "pips:5",
      "pips:6",
    ]);
    for (let face = 0; face < 6; face++)
      expect(Number(visual.faces[face]!.label) + Number(oppositeLabel(visual, face))).toBe(7);
  });

  it("keeps the original look by default: a cube with the symbol on every face, one texture", () => {
    const visual = createPassiveVisual({ symbol: "×2", palette }, 1.45, painter);
    expect(defaultPassiveShape).toBe("cube");
    expect(visual.geometry.groups).toHaveLength(6);
    expect(new Set(visual.faces.map(({ label }) => label))).toEqual(new Set(["×2"]));
    expect(visual.textures).toHaveLength(1);
    visual.geometry.computeBoundingBox();
    expect(visual.geometry.boundingBox!.max.x).toBeCloseTo(1.45 / 2);
  });

  it("draws a test-only shape without editing the renderer or the rack", () => {
    passiveShapes.register("test-tetrahedron", {
      geometry: () => new THREE.TetrahedronGeometry(0.7, 0).toNonIndexed(),
      verticesPerFace: 3,
    });
    const visual = createPassiveVisual(
      { symbol: "T", palette, shape: "test-tetrahedron", faces: numbered(4) },
      1,
      painter,
    );
    expect(visual.geometry.groups).toHaveLength(4);
    expect(new Set(visual.faces.map(({ label }) => label))).toEqual(new Set(["1", "2", "3", "4"]));
  });

  it("refuses an unregistered shape", () => {
    expect(() => createPassiveVisual({ symbol: "?", palette, shape: "nope" }, 1, painter)).toThrow(
      'Unknown passive shape "nope"',
    );
  });

  it("gives every passive definition a registered shape", () => {
    for (const id of passiveDefinitions.names()) {
      const { shape } = passiveDefinitions.get(id);
      expect(passiveShapes.has(shape ?? defaultPassiveShape), id).toBe(true);
    }
  });
});

describe("adding a token's extras (#630)", () => {
  it("logs no three.js error when a token has none", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mesh = new THREE.Mesh();
    addExtras(mesh, undefined);
    addExtras(mesh, []);
    expect(errors).not.toHaveBeenCalled();
    const extra = new THREE.Mesh();
    addExtras(mesh, [extra]);
    expect(mesh.children).toEqual([extra]);
    errors.mockRestore();
  });
});
