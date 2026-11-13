import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

/** Every scene each fake WebGL renderer was asked to draw, in order. */
const drawn: { canvas: "back" | "front"; scene: THREE.Scene }[] = [];
let made = 0;

vi.mock("three", async (importOriginal) => {
  const real = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    readonly canvas = made++ === 0 ? ("back" as const) : ("front" as const);
    readonly domElement = { classList: { add() {} }, setAttribute() {}, remove() {} };
    readonly shadowMap = { enabled: false, type: 0 };
    autoClear = true;
    outputColorSpace = "";
    setPixelRatio() {}
    setClearColor() {}
    clear() {}
    clearDepth() {}
    dispose() {}
    render(scene: THREE.Scene) {
      drawn.push({ canvas: this.canvas, scene });
    }
  }
  class FakePmrem {
    fromScene() {
      return { texture: new real.Texture() };
    }
  }
  return { ...real, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePmrem };
});
vi.mock("three/addons/environments/RoomEnvironment.js", () => ({ RoomEnvironment: class {} }));
vi.mock("./visual/card-room", () => ({
  createCardRoom: () => ({ setShadowQuality() {}, frame() {} }),
}));
vi.mock("./visual/block-appearance", () => ({ setReflectionEnvironment() {} }));

const element = () => ({ append() {} }) as unknown as HTMLElement;

beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= { devicePixelRatio: 1 };
});

describe("table renderer layer ownership (#789)", () => {
  it("draws the field only while a scene composing tableBackground is on the stack", async () => {
    const { createTableRenderer } = await import("./table-renderer");
    const table = createTableRenderer(element(), element());
    table.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const camera = new THREE.PerspectiveCamera();
    const fieldDrawn = () => {
      drawn.length = 0;
      table.render(camera, camera);
      return drawn.some(({ canvas, scene }) => canvas === "front" && scene === table.scene);
    };

    // The title: no table scene, so neither the room nor the old field is drawn.
    expect(fieldDrawn()).toBe(false);
    expect(drawn.some(({ canvas }) => canvas === "back")).toBe(false);
    // A stage, then a pause menu over it (both compose the table): the field shows throughout.
    table.tableEntered(true);
    expect(fieldDrawn()).toBe(true);
    table.tableEntered(true);
    table.tableEntered(false);
    expect(fieldDrawn()).toBe(true);
    // Quit to the title: the last table scene leaves, and later frames draw no field either.
    table.tableEntered(false);
    expect(fieldDrawn()).toBe(false);
    expect(fieldDrawn()).toBe(false);
    // Continue: the same field is drawn again, untouched.
    table.tableEntered(true);
    expect(fieldDrawn()).toBe(true);
    expect(table.scene.children.some((child) => (child as THREE.Mesh).isMesh)).toBe(true);
  });

  it("draws the hand on its own count, whatever the table does", async () => {
    const { createTableRenderer } = await import("./table-renderer");
    const table = createTableRenderer(element(), element());
    const camera = new THREE.PerspectiveCamera();
    table.handEntered(true);
    drawn.length = 0;
    table.render(camera, camera);
    expect(drawn.some(({ scene }) => scene === table.handScene)).toBe(true);
    expect(drawn.some(({ scene }) => scene === table.scene)).toBe(false);
  });
});
