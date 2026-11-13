import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { passRenderer } from "../tools/profiler/fake-pass-renderer";
import { createInternalCapture, createInternalFront } from "./crystal-internal";
import {
  createRefractionCapture,
  createRefractionFront,
  refractionOffsetLayer,
  refractionPresets,
} from "./crystal-refraction";
import type { PassFrame } from "./render-pass";

/** A renderer that remembers each target it drew into. */
function recording() {
  const base = passRenderer();
  const targets: (THREE.WebGLRenderTarget | null)[] = [];
  return {
    targets,
    renderer: {
      ...base,
      render() {
        targets.push(base.getRenderTarget());
      },
    },
  };
}

function frame(renderer: PassFrame["renderer"]): PassFrame {
  return {
    renderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    hide: new THREE.Group(),
    delta: 0.5,
    reducedMotion: false,
  };
}

describe("capture passes own their targets, per renderer (#764)", () => {
  it("binds each refraction capture's own targets before the main render samples them", () => {
    const front = createRefractionFront(refractionPresets.get("crystal"));
    const a = recording();
    const b = recording();
    const captureA = createRefractionCapture("crystal");
    const captureB = createRefractionCapture("crystal");
    captureA.render(frame(a.renderer));
    const [backgroundA, offsetsA] = a.targets;
    expect(front.uniforms.backgroundMap!.value).toBe(backgroundA!.texture);
    expect(front.uniforms.offsetMap!.value).toBe(offsetsA!.texture);
    captureB.render(frame(b.renderer));
    const [backgroundB] = b.targets;
    expect(backgroundB).not.toBe(backgroundA);
    expect(front.uniforms.backgroundMap!.value).toBe(backgroundB!.texture);
    // Disposing A, no longer bound, leaves B's binding alone.
    captureA.dispose();
    expect(front.uniforms.backgroundMap!.value).toBe(backgroundB!.texture);
    captureB.dispose();
    expect(front.uniforms.backgroundMap!.value).toBeNull();
    front.dispose();
  });

  it("puts back the target, clear colour, layers, background and visibility it changes", () => {
    const { renderer } = recording();
    renderer.setClearColor(0x336699, 0.75);
    const each = frame(renderer);
    each.scene.background = new THREE.Color(0x111111);
    const background = each.scene.background;
    const capture = createRefractionCapture("crystal");
    capture.render(each);
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x336699);
    expect(renderer.getClearAlpha()).toBe(0.75);
    expect(each.camera.layers.mask).toBe(1);
    expect(each.camera.layers.isEnabled(refractionOffsetLayer)).toBe(false);
    expect(each.scene.background).toBe(background);
    expect(each.hide.visible).toBe(true);
    capture.dispose();
  });

  it("moves its preset's ripple on by the frame's delta", () => {
    const ripple = refractionPresets.get("calmWater").ripple;
    const before = ripple.phase.value;
    const capture = createRefractionCapture("calmWater");
    capture.render(frame(recording().renderer));
    expect(ripple.phase.value).not.toBe(before);
    capture.dispose();
  });

  it("binds each internal capture's own target", () => {
    const front = createInternalFront();
    const a = recording();
    const b = recording();
    const captureA = createInternalCapture();
    const captureB = createInternalCapture();
    captureA.render(frame(a.renderer));
    expect(front.uniforms.innerMap!.value).toBe(a.targets[0]!.texture);
    captureB.render(frame(b.renderer));
    expect(front.uniforms.innerMap!.value).toBe(b.targets[0]!.texture);
    expect(b.targets[0]).not.toBe(a.targets[0]);
    captureA.dispose();
    captureB.dispose();
    front.dispose();
  });
});
