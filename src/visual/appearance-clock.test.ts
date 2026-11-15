import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { appearanceSeconds, useAppearanceClock } from "./appearance-clock";
import { composeContained, containedContents } from "./contained";
import { createFireCore } from "./fire-core";
import "./glass-shells";

describe("the appearance clock (#972)", () => {
  it("is frame time by default, an installed clock until restored, then frame time again", () => {
    let seconds = 100;
    const restore = useAppearanceClock(() => seconds);
    expect(appearanceSeconds()).toBe(100);
    seconds = 101.5;
    expect(appearanceSeconds()).toBe(101.5);
    restore();
    expect(appearanceSeconds()).not.toBe(101.5);
  });

  it("drives the flame's shader time, so a host's clock repeats it exactly", () => {
    let seconds = 10;
    const restore = useAppearanceClock(() => seconds);
    try {
      const core = createFireCore(1);
      const material = core.material as THREE.ShaderMaterial;
      material.userData.speed = 2;
      const draw = () =>
        core.onBeforeRender(
          null as never,
          null as never,
          new THREE.PerspectiveCamera(),
          null as never,
          material,
          null as never,
        );
      seconds = 10.5;
      draw();
      expect(material.uniforms.time!.value).toBeCloseTo(1);
      seconds = 11;
      draw();
      expect(material.uniforms.time!.value).toBeCloseTo(2);
      material.dispose();
    } finally {
      restore();
    }
  });

  it("gives contained parts their frame seconds and delta from it", () => {
    const frames: { seconds: number; delta: number }[] = [];
    if (!containedContents.has("testClockedContents"))
      containedContents.register("testClockedContents", () => ({
        meshes: [new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())],
        capabilities: {},
        update: ({ seconds, delta }) => void frames.push({ seconds, delta }),
      }));
    let seconds = 5;
    const restore = useAppearanceClock(() => seconds);
    try {
      const { extras } = composeContained(
        {
          geometry: new THREE.BoxGeometry(1, 1, 1),
          size: 1,
          environment: null,
          faceTexture: () => new THREE.Texture() as THREE.CanvasTexture,
          ownSurface: (texture) => new THREE.MeshStandardMaterial({ map: texture }),
        },
        { shell: "framedGlass", config: { inset: 0.97 } },
        { effect: "testClockedContents", config: {} },
      );
      const contents = extras.find((mesh) => mesh.userData.containedContents)!;
      const draw = () =>
        contents.onBeforeRender(
          null as never,
          null as never,
          null as never,
          null as never,
          null as never,
          null as never,
        );
      draw();
      seconds = 5.05;
      draw();
      draw(); // the same frame: no second tick
      expect(frames).toEqual([
        { seconds: 0, delta: 0 },
        { seconds: expect.closeTo(0.05), delta: expect.closeTo(0.05) },
      ]);
    } finally {
      restore();
    }
  });
});
