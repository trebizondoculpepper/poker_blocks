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
    ["dodecahedron", 12],
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

  it("paints a face's own ink over its category palette: Seeing Red's red suits (#1005)", () => {
    const definition = passiveDefinitions.get("seeing-red");
    const inks: string[] = [];
    const visual = createPassiveVisual(
      { symbol: definition.symbol, palette, faces: definition.faces },
      1,
      (used, face) => {
        inks.push(face.ink ?? used.ink);
        return painter(used, face);
      },
    );
    expect(visual.faces.every(({ label }) => label === "♥♦")).toBe(true);
    expect(new Set(inks)).toEqual(new Set(["#ff5a52"]));
    // Same artwork on every face: one shared texture.
    expect(visual.textures).toHaveLength(1);
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

describe("face artwork fitted to its shape's outline (#1002)", async () => {
  const { faceLayout, passiveShapes, triangleFaceOutline } = await import("./passive-visual");
  it("centres a triangular face's label at its incentre, inside every edge", () => {
    const { points, centre, radius } = faceLayout(triangleFaceOutline);
    expect(points).toEqual([
      { x: 0, y: 256 },
      { x: 256, y: 256 },
      { x: 128, y: 0 },
    ]);
    expect(centre.x).toBeCloseTo(128, 9);
    // The incircle touches the bottom edge: centre.y + radius is the bottom.
    expect(centre.y + radius).toBeCloseTo(256, 6);
    expect(radius).toBeGreaterThan(60);
    expect(radius).toBeLessThan(128);
  });

  it("gives triangle-faced dice their outline, and leaves the cube's square face alone", () => {
    expect(passiveShapes.get("icosahedron").faceOutline).toBe(triangleFaceOutline);
    expect(passiveShapes.get("octahedron").faceOutline).toBe(triangleFaceOutline);
    expect(passiveShapes.get("cube").faceOutline).toBeUndefined();
  });

  it("hands the painter its shape's outline", () => {
    const outlines: unknown[] = [];
    createPassiveVisual(
      { symbol: "20", palette, shape: "icosahedron" },
      1,
      (used, face, outline) => {
        outlines.push(outline);
        return painter(used, face);
      },
    );
    expect(new Set(outlines)).toEqual(new Set([triangleFaceOutline]));
  });
});

describe("mass passive artwork (#1009)", async () => {
  const { faceIcons, iconCluster } = await import("./passive-visual");
  const { passiveDefinitions } = await import("./passives");
  await import("./trial-modifiers");
  const iconOf = (id: string) => passiveDefinitions.get(id).faces?.[0]?.icon;

  it("registers drawn feather and anvil icons", () => {
    expect(faceIcons.has("feather")).toBe(true);
    expect(faceIcons.has("anvil")).toBe(true);
    // Ace Exchange's bin of Aces (#1004).
    expect(faceIcons.has("aceBin")).toBe(true);
    expect(passiveDefinitions.get("ace-exchange").faces?.[0]?.icon).toEqual({
      name: "aceBin",
      count: 1,
    });
    expect(iconCluster(1)).toHaveLength(1);
    expect(iconCluster(3)).toHaveLength(3);
  });

  it("gives Light a feather and Heavy an anvil: one for Mean, three for Total", () => {
    expect(iconOf("trial-light-mean-mass")).toEqual({ name: "feather", count: 1 });
    expect(iconOf("trial-light-total-mass")).toEqual({ name: "feather", count: 3 });
    expect(iconOf("trial-heavy-mean-mass")).toEqual({ name: "anvil", count: 1 });
    expect(iconOf("trial-heavy-total-mass")).toEqual({ name: "anvil", count: 3 });
    expect(iconOf("light-stack")).toEqual({ name: "feather", count: 3 });
    expect(iconOf("heavy-stack")).toEqual({ name: "anvil", count: 3 });
    // Mean and Total stay in the names.
    expect(passiveDefinitions.get("trial-heavy-mean-mass").name).toMatch(/mean/);
    expect(passiveDefinitions.get("trial-light-total-mass").name).toMatch(/total/);
  });
});

describe("the dodecahedron's pentagon faces (#1003)", () => {
  it("maps each pentagonal face onto the pentagon outline, unmirrored", () => {
    const visual = createPassiveVisual(
      { symbol: "?", palette, shape: "dodecahedron", faces: numbered(12) },
      1,
      painter,
    );
    const positions = visual.geometry.getAttribute("position");
    const uvs = visual.geometry.getAttribute("uv");
    const point = (i: number) => new THREE.Vector3().fromBufferAttribute(positions, i);
    for (let face = 0; face < 12; face++) {
      const first = face * 9;
      // One pentagon: five distinct corners.
      const corners = new Set(
        Array.from({ length: 9 }, (_, k) =>
          point(first + k)
            .toArray()
            .map((n) => n.toFixed(4))
            .join(),
        ),
      );
      expect(corners.size).toBe(5);
      for (let triangle = 0; triangle < 3; triangle++) {
        const [a, b, c] = [0, 1, 2].map((k) => first + triangle * 3 + k);
        const outward = new THREE.Vector3()
          .subVectors(point(b!), point(a!))
          .cross(new THREE.Vector3().subVectors(point(c!), point(a!)));
        expect(outward.dot(point(a!))).toBeGreaterThan(0);
        // Anticlockwise in UV space too, so the artwork reads the right way round.
        const uv = (i: number) => [uvs.getX(i), uvs.getY(i)] as const;
        const [ua, ub, uc] = [uv(a!), uv(b!), uv(c!)];
        const area = (ub[0] - ua[0]) * (uc[1] - ua[1]) - (ub[1] - ua[1]) * (uc[0] - ua[0]);
        expect(area).toBeGreaterThan(0);
      }
    }
  });
});
