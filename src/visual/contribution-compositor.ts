/**
 * Render-layer contribution compositor (#1199; doc/drag-ghost-audition.md, "Transition and mask
 * capability"). Given explicit **source** and **endpoint** visual handles, a camera and a captured
 * numeric progress, it captures each side's rendered contribution (everything under its root,
 * including declared extras and prepasses, as currently animated) into owned transparent targets
 * and composites the two over the ordinary scene with a registered transition:
 *
 * - **crossfade**: source × (1 − p) + endpoint × (p × strength);
 * - **perlin**: a stable, gesture-local Perlin mask (`materialise.ts`'s noise) replaces source
 *   samples with endpoint samples; p = 0 is all source, p = 1 is all endpoint at strength.
 *
 * Binding API (the explicit appearance/transition extension the contract asks for):
 * `createContributionCompositor({ source, endpoint, transition, strength, seed })` returns a handle
 * with `setProgress(p)`, `render(frame)` (call after the ordinary scene render, each frame), `stats()`
 * and `dispose()`. A side is `{ root, prepare? }`: `prepare` runs the side's declared prepasses
 * before its capture.
 *
 * Isolation and ownership:
 * - While composed, each side's objects are moved onto the compositor's own camera layers, so the
 *   ordinary render never draws them: there is no invisible opaque depth blocker left behind.
 *   Lights are lit onto those layers only for the capture. Each object's layer mask is restored on
 *   dispose. No material, geometry or shared asset is touched.
 * - The renderer's target, clear colour and alpha, camera layers, scene background and auto-clear
 *   are restored after every render, even if a draw throws (`preservingRenderState`).
 * - It owns its two targets and its composite material and quad, freed once by `dispose`; render
 *   after dispose does nothing.
 *
 * It knows no gesture timing, drag policy or room controls: a controller (#1084) feeds it progress.
 * Composited contributions sit over the scene (a carried group is in front of it); depth against
 * other scene content is not resolved here.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import { NOISE } from "./materialise";
import { preservingRenderState, type PassRenderer } from "./render-pass";

/** A transition's fragment: `vec4 transition(vec4 source, vec4 endpoint, vec2 local)`. */
export type ContributionTransition = {
  /** GLSL defining `transition`; may use `progress`, `strength`, `seed`, `frequency`. */
  glsl: string;
};

export const contributionTransitions = new Registry<ContributionTransition>(
  "contribution transition",
);

contributionTransitions.register("crossfade", {
  glsl: `
vec4 transition(vec4 source, vec4 endpoint, vec2 local) {
  return source * (1.0 - progress) + endpoint * (progress * strength);
}`,
});

contributionTransitions.register("perlin", {
  glsl: `${NOISE}
vec4 transition(vec4 source, vec4 endpoint, vec2 local) {
  float n = clamp(matFbm(vec3(local * frequency, seed)) + 0.5, 0.0, 0.9999);
  return n >= progress ? source : endpoint * strength;
}`,
});

/** The crossfade's weights at progress `p`: a reference for the shader, used by tests. */
export const crossfadeWeights = (p: number, strength: number) => ({
  source: 1 - p,
  endpoint: p * strength,
});

/** Whether the Perlin mask keeps the source at noise value `n` (in [0, 1)) and progress `p`. */
export const perlinKeepsSource = (n: number, p: number) => Math.min(n, 0.9999) >= p;

/** One side: everything under `root` is its contribution; `prepare` runs its prepasses. */
export type ContributionSide = { root: THREE.Object3D; prepare?(): void };

export type ContributionFrame = {
  renderer: PassRenderer & { autoClear: boolean };
  scene: THREE.Scene;
  camera: THREE.Camera;
};

export type ContributionStats = {
  /** Capture plus composite passes run by the last render. */
  passes: number;
  /** Owned targets and their approximate bytes. */
  targets: number;
  targetBytes: number;
  frames: number;
};

/** The compositor's default first layer; it uses this one and the next. */
export const contributionLayer = 11;

const vertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragment = (glsl: string) => `
uniform sampler2D sourceMap;
uniform sampler2D endpointMap;
uniform float progress;
uniform float strength;
uniform float seed;
uniform float frequency;
uniform vec2 origin;
uniform float aspect;
varying vec2 vUv;
${glsl}
void main() {
  // Gesture-local: the mask follows the carried group's projected centre, not the screen.
  vec2 local = (vUv - origin) * vec2(aspect, 1.0);
  vec4 s = texture2D(sourceMap, vUv);
  vec4 e = texture2D(endpointMap, vUv);
  // Premultiplied, so a faded contribution never leaves a solid colour.
  vec4 c = transition(vec4(s.rgb * s.a, s.a), vec4(e.rgb * e.a, e.a), local);
  gl_FragColor = c;
  // The targets hold linear colour: convert to the output's colour space like any scene draw.
  #include <colorspace_fragment>
}`;

export function createContributionCompositor(options: {
  source: ContributionSide;
  endpoint: ContributionSide;
  /** A registered transition's name. */
  transition: string;
  strength?: number;
  /** Stable for the gesture: the Perlin pattern's seed. */
  seed?: number;
  /** Perlin frequency in mask units across the view's height. */
  frequency?: number;
  layer?: number;
}) {
  const transition = contributionTransitions.get(options.transition);
  const layers = [options.layer ?? contributionLayer, (options.layer ?? contributionLayer) + 1];
  const sides = [options.source, options.endpoint];
  const targets = sides.map(
    () =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
      }),
  );
  const uniforms = {
    sourceMap: { value: targets[0]!.texture },
    endpointMap: { value: targets[1]!.texture },
    progress: { value: 0 },
    strength: { value: options.strength ?? 1 },
    seed: { value: options.seed ?? 0 },
    frequency: { value: options.frequency ?? 6 },
    origin: { value: new THREE.Vector2(0.5, 0.5) },
    aspect: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment(transition.glsl),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const compositeScene = new THREE.Scene();
  compositeScene.add(quad);
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Move each side onto its own layer, remembering every object's mask to restore once.
  const saved = new Map<THREE.Object3D, number>();
  const assign = () =>
    sides.forEach((side, index) =>
      side.root.traverse((object) => {
        if (!saved.has(object)) saved.set(object, object.layers.mask);
        object.layers.set(layers[index]!);
      }),
    );
  assign();

  const size = new THREE.Vector2();
  const centre = new THREE.Vector3();
  let passes = 0;
  let frames = 0;
  let disposed = false;

  const captureSide = (frame: ContributionFrame, index: number) => {
    const side = sides[index]!;
    side.prepare?.();
    // Objects added to a side since the last frame join its layer too.
    side.root.traverse((object) => {
      if (!saved.has(object)) saved.set(object, object.layers.mask);
      object.layers.set(layers[index]!);
    });
    frame.camera.layers.set(layers[index]!);
    frame.renderer.setRenderTarget(targets[index]!);
    frame.renderer.setClearColor(0x000000, 0);
    frame.renderer.clear();
    frame.renderer.render(frame.scene, frame.camera);
    passes++;
  };

  return {
    /** The captured numeric progress, clamped to 0..1. */
    setProgress(p: number) {
      uniforms.progress.value = Math.min(1, Math.max(0, p));
    },
    get progress() {
      return uniforms.progress.value;
    },
    /** Capture both sides and composite them over whatever is in the current target. */
    render(frame: ContributionFrame) {
      if (disposed) return;
      passes = 0;
      frames++;
      frame.renderer.getDrawingBufferSize(size);
      for (const target of targets)
        if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
      uniforms.aspect.value = size.y > 0 ? size.x / size.y : 1;
      options.source.root.getWorldPosition(centre);
      centre.project(frame.camera);
      uniforms.origin.value.set(centre.x * 0.5 + 0.5, centre.y * 0.5 + 0.5);
      const autoClear = frame.renderer.autoClear;
      // Lights reach the capture layers only while capturing.
      const lights: [THREE.Object3D, number][] = [];
      frame.scene.traverse((object) => {
        if ((object as THREE.Light).isLight) lights.push([object, object.layers.mask]);
      });
      try {
        preservingRenderState(frame, () => {
          frame.scene.background = null;
          frame.renderer.autoClear = false;
          for (const [light] of lights) layers.forEach((layer) => light.layers.enable(layer));
          sides.forEach((_side, index) => captureSide(frame, index));
        });
        // `preservingRenderState` has put the host's target back: composite into it.
        frame.renderer.autoClear = false;
        frame.renderer.render(compositeScene, compositeCamera);
        passes++;
      } finally {
        for (const [light, mask] of lights) light.layers.mask = mask;
        frame.renderer.autoClear = autoClear;
      }
    },
    stats(): ContributionStats {
      const bytes = targets.reduce((sum, t) => sum + t.width * t.height * 8, 0);
      return {
        passes,
        targets: disposed ? 0 : targets.length,
        targetBytes: disposed ? 0 : bytes,
        frames,
      };
    },
    /** Free targets, material and quad, and restore every object's layers: once. */
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [object, mask] of saved) object.layers.mask = mask;
      saved.clear();
      targets.forEach((target) => target.dispose());
      material.dispose();
      quad.geometry.dispose();
    },
  };
}

export type ContributionCompositor = ReturnType<typeof createContributionCompositor>;
