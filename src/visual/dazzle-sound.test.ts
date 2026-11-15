import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const played: string[] = [];
vi.mock("../audio/sfx", () => ({ playSfx: (id: string) => void played.push(id) }));

/** Just enough DOM for the dazzle's overlay elements: no rendering is checked here. */
function fakeElement(): HTMLElement {
  const element = {
    style: {} as Record<string, string>,
    children: [] as unknown[],
    append(...nodes: unknown[]) {
      element.children.push(...nodes);
    },
    remove() {},
  };
  return element as unknown as HTMLElement;
}

describe("the dazzle's registered pop plays once per pop (#520)", () => {
  const original = globalThis.document;
  beforeEach(() => {
    played.length = 0;
    (globalThis as { document?: unknown }).document = { createElement: fakeElement };
  });
  afterEach(() => {
    (globalThis as { document?: unknown }).document = original;
  });

  async function dazzle() {
    const { createDazzle } = await import("./dazzle");
    const camera = new THREE.PerspectiveCamera();
    camera.position.z = 5;
    camera.updateMatrixWorld();
    return createDazzle(fakeElement(), camera, { random: () => 0.5 });
  }

  it("plays block.dazzle_pop through the shared API exactly once for each flash", async () => {
    const flashes = await dazzle();
    flashes.flash(new THREE.Vector3());
    expect(played).toEqual(["block.dazzle_pop"]);
    // Rapid pops: one sound each, never doubled by the visual's own frames.
    flashes.flash(new THREE.Vector3(0.2, 0, 0));
    flashes.flash(new THREE.Vector3(-0.2, 0, 0));
    expect(played).toEqual(["block.dazzle_pop", "block.dazzle_pop", "block.dazzle_pop"]);
  });

  it("still plays once for a pop out of view, and a flash's own look may name its sound", async () => {
    const flashes = await dazzle();
    flashes.flash(new THREE.Vector3(0, 0, 50));
    flashes.flash(new THREE.Vector3(), { look: { sound: "block.dazzle_pop" } });
    expect(played).toEqual(["block.dazzle_pop", "block.dazzle_pop"]);
  });
});
