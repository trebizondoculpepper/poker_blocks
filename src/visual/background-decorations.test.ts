import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { createBackgroundDecorationHost } from "./background-decorations";

/** A renderer double that records draws and reports a drawing-buffer size. */
function renderer(width = 1600, height = 900, fail = false) {
  const draws: { scene: THREE.Scene; camera: THREE.Camera }[] = [];
  return {
    draws,
    autoClear: true,
    depthCleared: 0,
    clearDepth() {
      this.depthCleared++;
    },
    getDrawingBufferSize: (into: THREE.Vector2) => into.set(width, height),
    render(scene: THREE.Scene, camera: THREE.Camera) {
      if (fail) throw new Error("lost");
      draws.push({ scene, camera });
    },
  };
}

describe("background-decoration host (#1373; doc/room-scenery.md)", () => {
  it("places a mount by normalized anchor and offset under its own orthographic camera", () => {
    const host = createBackgroundDecorationHost({ layoutHeight: 10 });
    const picture = new THREE.Group();
    host.mount(picture, { anchor: [1, 1], offset: [-2, -1] });
    const target = renderer(1600, 800);
    host.render(target);
    // 2:1 surface, 10 units high: 20 wide. Top-right corner, then the offset inward.
    const at = picture.getWorldPosition(new THREE.Vector3());
    expect(at.x).toBeCloseTo(8);
    expect(at.y).toBeCloseTo(4);
    expect(target.draws[0]!.camera).toBe(host.camera);
    expect((host.camera as THREE.OrthographicCamera).isOrthographicCamera).toBe(true);
  });

  it("re-lays out on resize without touching the mounted object's own pose", () => {
    const host = createBackgroundDecorationHost({ layoutHeight: 10 });
    const picture = new THREE.Group();
    picture.rotation.z = 0.4; // mid-swing: the effect's own local pose
    picture.position.set(0.3, -0.2, 0);
    host.mount(picture, { anchor: [1, 0.5] });
    host.render(renderer(1000, 1000));
    expect(host.extent.width).toBeCloseTo(10);
    host.render(renderer(2000, 1000));
    expect(host.extent.width).toBeCloseTo(20);
    expect(picture.parent!.position.x).toBeCloseTo(10);
    expect(picture.rotation.z).toBe(0.4);
    expect(picture.position.toArray()).toEqual([0.3, -0.2, 0]);
  });

  it("draws over the colour already there on its own depth, restoring auto-clear even on failure", () => {
    const host = createBackgroundDecorationHost();
    host.mount(new THREE.Group(), { anchor: [0.5, 0.5] });
    const ok = renderer();
    host.render(ok);
    expect(ok.depthCleared).toBe(1);
    expect(ok.autoClear).toBe(true);
    const failing = renderer(1600, 900, true);
    expect(() => host.render(failing)).toThrow("lost");
    expect(failing.autoClear).toBe(true);
  });

  it("disposes a mount and the host once, leaving mounted objects to their owners", () => {
    const host = createBackgroundDecorationHost();
    const picture = new THREE.Group();
    const mount = host.mount(picture, { anchor: [0, 0] });
    mount.dispose();
    mount.dispose();
    expect(picture.parent).toBeNull();
    const target = renderer();
    host.render(target);
    expect(target.draws).toEqual([]);
    const other = new THREE.Group();
    host.mount(other, { anchor: [0, 0] });
    host.dispose();
    host.dispose();
    host.render(target);
    expect(target.draws).toEqual([]);
    expect(other.parent?.parent ?? null).toBeNull();
  });
});
