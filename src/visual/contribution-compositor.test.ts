import * as THREE from "three";
import { describe, expect, it } from "vite-plus/test";
import { passRenderer } from "../tools/profiler/fake-pass-renderer";
import {
  contributionLayer,
  createContributionCompositor,
  crossfadeWeights,
  perlinKeepsSource,
  type ContributionFrame,
} from "./contribution-compositor";

/** A fake renderer that records each draw: its target, camera layers and scene. */
function recording(options: { throwOn?: number } = {}) {
  const base = passRenderer();
  const draws: { target: unknown; mask: number; scene: THREE.Scene }[] = [];
  const renderer = {
    ...base,
    autoClear: true,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      if (options.throwOn === draws.length) throw new Error("lost context");
      draws.push({ target: base.getRenderTarget(), mask: camera.layers.mask, scene });
    },
  };
  return { renderer, draws };
}

function setup(transition = "crossfade") {
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight();
  scene.add(light);
  const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 });
  const source = new THREE.Group();
  // Multi-card: two cubes sharing one material, plus an extra.
  source.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  source.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const endpoint = new THREE.LineSegments();
  const unrelated = new THREE.Mesh();
  scene.add(source, endpoint, unrelated);
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 5;
  const prepared: string[] = [];
  const compositor = createContributionCompositor({
    source: { root: source, prepare: () => prepared.push("source") },
    endpoint: { root: endpoint, prepare: () => prepared.push("endpoint") },
    transition,
    strength: 0.65,
    seed: 3,
  });
  return { scene, light, source, endpoint, unrelated, camera, material, compositor, prepared };
}

describe("contribution compositor (#1199; doc/drag-ghost-audition.md)", () => {
  it("weights source and endpoint at p = 0, intermediate and 1 (crossfade)", () => {
    expect(crossfadeWeights(0, 0.65)).toEqual({ source: 1, endpoint: 0 });
    expect(crossfadeWeights(0.5, 0.65)).toEqual({ source: 0.5, endpoint: 0.325 });
    expect(crossfadeWeights(1, 0.65)).toEqual({ source: 0, endpoint: 0.65 });
  });

  it("keeps all source at p = 0 and none at p = 1 (perlin), some in between", () => {
    const samples = Array.from({ length: 101 }, (_, i) => i / 101);
    expect(samples.every((n) => perlinKeepsSource(n, 0))).toBe(true);
    expect(samples.some((n) => perlinKeepsSource(n, 1))).toBe(false);
    const kept = samples.filter((n) => perlinKeepsSource(n, 0.5)).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(samples.length);
  });

  it("captures each side on its own layer, isolated, then composites into the host target", () => {
    const { scene, source, endpoint, unrelated, camera, compositor, prepared } = setup("perlin");
    const { renderer, draws } = recording();
    const host = new THREE.WebGLRenderTarget(4, 4);
    renderer.setRenderTarget(host);
    compositor.setProgress(0.4);
    compositor.render({ renderer, scene, camera } as unknown as ContributionFrame);
    expect(prepared).toEqual(["source", "endpoint"]);
    expect(draws).toHaveLength(3);
    expect(draws[0]!.mask).toBe(1 << contributionLayer);
    expect(draws[1]!.mask).toBe(1 << (contributionLayer + 1));
    expect(draws[0]!.target).not.toBe(host);
    expect(draws[1]!.target).not.toBe(draws[0]!.target);
    expect(draws[2]!.target).toBe(host);
    // The ordinary render (layer 0) no longer sees either side: no invisible depth blocker.
    source.traverse((o) => expect(o.layers.isEnabled(0)).toBe(false));
    expect(endpoint.layers.isEnabled(0)).toBe(false);
    expect(unrelated.layers.mask).toBe(1);
    expect(compositor.stats().passes).toBe(3);
  });

  it("restores target, clear state, camera layers, background, auto-clear and lights", () => {
    const { scene, light, camera, compositor } = setup();
    const { renderer } = recording();
    const host = new THREE.WebGLRenderTarget(4, 4);
    renderer.setRenderTarget(host);
    renderer.setClearColor(0x123456, 0.7);
    scene.background = new THREE.Color(0xff0000);
    const background = scene.background;
    camera.layers.set(2);
    compositor.render({ renderer, scene, camera } as unknown as ContributionFrame);
    expect(renderer.getRenderTarget()).toBe(host);
    expect(renderer.getClearColor(new THREE.Color()).getHex()).toBe(0x123456);
    expect(renderer.getClearAlpha()).toBe(0.7);
    expect(camera.layers.mask).toBe(1 << 2);
    expect(scene.background).toBe(background);
    expect(renderer.autoClear).toBe(true);
    expect(light.layers.mask).toBe(1);
  });

  it("restores renderer state when a capture fails", () => {
    const { scene, light, camera, compositor } = setup();
    const { renderer } = recording({ throwOn: 1 });
    renderer.setRenderTarget(null);
    expect(() =>
      compositor.render({ renderer, scene, camera } as unknown as ContributionFrame),
    ).toThrow("lost context");
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.autoClear).toBe(true);
    expect(light.layers.mask).toBe(1);
    expect(camera.layers.mask).toBe(1);
  });

  it("follows a moving endpoint and animated contribution: each frame captures it afresh", () => {
    const { scene, endpoint, camera, compositor } = setup();
    const { renderer, draws } = recording();
    const frame = { renderer, scene, camera } as unknown as ContributionFrame;
    compositor.render(frame);
    endpoint.position.x = 2;
    // A laser segment added mid-gesture joins the endpoint's layer.
    const added = new THREE.Line();
    endpoint.add(added);
    compositor.render(frame);
    expect(draws).toHaveLength(6);
    expect(added.layers.mask).toBe(1 << (contributionLayer + 1));
    expect(compositor.stats().frames).toBe(2);
  });

  it("disposes once, early or late, restoring layers and never touching shared materials", () => {
    const { scene, source, endpoint, camera, material, compositor } = setup();
    const { renderer, draws } = recording();
    const before = { opacity: material.opacity, transparent: material.transparent };
    compositor.dispose();
    compositor.dispose();
    source.traverse((o) => expect(o.layers.mask).toBe(1));
    expect(endpoint.layers.mask).toBe(1);
    compositor.render({ renderer, scene, camera } as unknown as ContributionFrame);
    expect(draws).toHaveLength(0);
    expect(compositor.stats().targets).toBe(0);
    expect({ opacity: material.opacity, transparent: material.transparent }).toEqual(before);
  });

  it("clamps captured progress and reports bounded cost", () => {
    const { scene, camera, compositor } = setup();
    compositor.setProgress(2);
    expect(compositor.progress).toBe(1);
    compositor.setProgress(-1);
    expect(compositor.progress).toBe(0);
    const { renderer } = recording();
    compositor.render({ renderer, scene, camera } as unknown as ContributionFrame);
    // Two half-float targets at the 320×180 drawing buffer.
    expect(compositor.stats()).toMatchObject({
      passes: 3,
      targets: 2,
      targetBytes: 2 * 320 * 180 * 8,
    });
    compositor.dispose();
  });
});
