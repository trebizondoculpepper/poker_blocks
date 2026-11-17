import * as THREE from "three";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

/** Every scene each fake WebGL renderer was asked to draw, in order. */
const drawn: {
  canvas: "back" | "front";
  scene: THREE.Scene;
  renderer?: unknown;
  /** The scene's background as it was at that draw. */
  background?: unknown;
}[] = [];
let made = 0;

vi.mock("three", async (importOriginal) => {
  const real = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    readonly canvas = made++ === 0 ? ("back" as const) : ("front" as const);
    readonly domElement = {
      classList: { add() {} },
      setAttribute() {},
      remove() {},
      addEventListener() {},
    };
    readonly shadowMap = { enabled: false, type: 0 };
    autoClear = true;
    outputColorSpace = "";
    target: unknown = null;
    viewport = new real.Vector4(0, 0, 100, 100);
    scissor = new real.Vector4(0, 0, 100, 100);
    scissorTest = false;
    clearColour = new real.Color(0x000000);
    clearAlpha = 1;
    setPixelRatio() {}
    setClearColor(colour: THREE.ColorRepresentation, alpha = 1) {
      this.clearColour.set(colour);
      this.clearAlpha = alpha;
    }
    getClearColor(into: THREE.Color) {
      return into.copy(this.clearColour);
    }
    getClearAlpha() {
      return this.clearAlpha;
    }
    getRenderTarget() {
      return this.target;
    }
    setRenderTarget(target: unknown) {
      this.target = target;
    }
    getViewport(into: THREE.Vector4) {
      return into.copy(this.viewport);
    }
    setViewport(next: THREE.Vector4) {
      this.viewport.copy(next);
    }
    getScissor(into: THREE.Vector4) {
      return into.copy(this.scissor);
    }
    setScissor(next: THREE.Vector4) {
      this.scissor.copy(next);
    }
    getScissorTest() {
      return this.scissorTest;
    }
    setScissorTest(on: boolean) {
      this.scissorTest = on;
    }
    clear() {}
    clearDepth() {}
    dispose() {}
    render(scene: THREE.Scene) {
      drawn.push({ canvas: this.canvas, scene, renderer: this, background: scene.background });
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

describe("ordered back composition (#1373; doc/room-scenery.md)", () => {
  it("draws backdrop, then each background contribution, then the table, restoring state", async () => {
    const { createTableRenderer } = await import("./table-renderer");
    const table = createTableRenderer(element(), element());
    const backdrop = new THREE.Texture();
    table.scene.background = backdrop;
    table.tableEntered(true);
    const camera = new THREE.PerspectiveCamera();
    const order: string[] = [];
    const remove = table.addBackground({ render: () => void order.push("decorations") });
    const autoClear = table.renderer.autoClear;
    drawn.length = 0;
    table.render(camera, camera);
    const back = drawn.filter(({ renderer }) => renderer === table.renderer);
    // The backdrop alone first (drawn with it), then the table scene without a background.
    expect(back[0]!.scene).not.toBe(table.scene);
    expect(back[0]!.background).toBe(backdrop);
    expect(back.at(-1)!.background).toBe(null);
    expect(order).toEqual(["decorations"]);
    expect(back.at(-1)!.scene).toBe(table.scene);
    expect(table.scene.background).toBe(backdrop);
    expect(table.renderer.autoClear).toBe(autoClear);
    remove();
    order.length = 0;
    table.render(camera, camera);
    expect(order).toEqual([]);
  });

  it("puts the backdrop, auto-clear and camera layers back when a contribution throws", async () => {
    const { createTableRenderer } = await import("./table-renderer");
    const table = createTableRenderer(element(), element());
    const backdrop = new THREE.Texture();
    table.scene.background = backdrop;
    table.tableEntered(true);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.set(3);
    const autoClear = table.renderer.autoClear;
    const renderer = table.renderer as unknown as {
      viewport: THREE.Vector4;
      scissorTest: boolean;
      clearAlpha: number;
      target: unknown;
    };
    const remove = table.addBackground({
      render: () => {
        // A contribution that changes the shared renderer, then fails.
        renderer.viewport.set(1, 2, 3, 4);
        renderer.scissorTest = true;
        renderer.clearAlpha = 0;
        renderer.target = {};
        throw new Error("lost");
      },
    });
    expect(() => table.render(camera, camera)).toThrow("lost");
    expect(renderer.viewport.toArray()).toEqual([0, 0, 100, 100]);
    expect(renderer.scissorTest).toBe(false);
    expect(renderer.clearAlpha).toBe(1);
    expect(renderer.target).toBeNull();
    expect(table.scene.background).toBe(backdrop);
    expect(table.renderer.autoClear).toBe(autoClear);
    expect(camera.layers.mask).toBe(1 << 3);
    remove();
  });
});
