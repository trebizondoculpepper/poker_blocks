/**
 * Faked background refraction for crystal blocks: a PROTOTYPE for the owner to judge (follows
 * Crystal v3, #645). Not yet a merged design: it goes to the designer with these results before any
 * production or dev-room merge.
 *
 * Per frame, by one capture pass per renderer (`createRefractionCapture`), for every block it draws:
 * 1. **Background capture.** The scene is drawn with the crystals hidden into one half-resolution
 *    target: what lies behind them.
 * 2. **Rear pass: the bend, once per rear facet.** Only the blocks' back faces are drawn, on their
 *    own camera layer, into an offset target. Each writes a 2D screen shift from its facet's normal
 *    in view space, larger towards grazing angles, plus a pull towards the block's centre, which
 *    magnifies. On a flat facet the shift is the same across the facet, so each rear facet moves its
 *    own patch of background, like a cut gem.
 * 3. **Front faces reuse it.** Each front pixel reads the rear shift under it, adds its own facet's
 *    bend, and samples the captured background there, with red, green and blue offset slightly
 *    differently (three taps). Crystal v3's spectral reflection is blended on by Fresnel. The front
 *    is opaque, so nothing behind it (such as far edges) shows except through the fake refraction.
 *
 * A preset (`refractionPresets`) supplies the settings, so several looks share this one shader.
 * Each may add a slow lookup ripple (src/visual/lookup-ripple.ts, #674).
 *
 * Limits: crystals do not refract each other (they are not in the capture); where blocks overlap,
 * the nearest rear facet's shift wins; the hand has no captured background.
 */
import * as THREE from "three";
import { Registry } from "../core/registry";
import { crystalV3Environment } from "./crystal-v3";
import {
  createLookupRipple,
  rippleShiftGlsl,
  rippleUniforms,
  type LookupRipple,
  type RippleSettings,
} from "./lookup-ripple";
import { preservingRenderState, type RenderPass } from "./render-pass";

/** The camera layer the rear (offset) pass draws: never the main view. */
export const refractionOffsetLayer = 7;

/** A refraction preset's tunable settings, as plain numbers (its defaults or a copied preset). */
export const crystalRefractionSettings = {
  /** How far a rear facet shifts the background. */
  rearStrength: 0.1,
  /** How far a front facet adds to that. */
  frontStrength: 0.04,
  /** How strongly the block magnifies what is behind it (pull towards its centre). */
  magnify: 0.3,
  /** How far apart the red and blue samples are, as a share of the shift. */
  dispersion: 0.12,
  /** Spectral reflection: how strong face-on, how sharply it rises towards grazing angles. */
  fresnelBase: 0.04,
  fresnelPower: 4,
  spectral: 0.85,
  /** How bright the spectral reflection is. */
  reflection: 0.6,
  /** A slight cool tint on what is seen through the crystal. */
  clarity: 0.92,
};

export type RefractionSettings = typeof crystalRefractionSettings;
export type RefractionTuning = { [K in keyof RefractionSettings]: { value: number } };

/**
 * One configured fake-refraction look (#674): its own tuning uniforms, its own lookup ripple
 * and the reflection map it shows. Presets share the shader program, the captures and the maps;
 * only their settings are their own, so tuning one never changes another.
 */
export type RefractionPreset = {
  tuning: RefractionTuning;
  ripple: LookupRipple;
  /** The reflection map: shared and immutable, never disposed by a block. */
  environment: () => THREE.Texture;
  /**
   * The drawn outline's opacity, live, when the preset owns it (#796; 0 removes the outline,
   * reflection is unaffected). Left out, a block keeps its material definition's own edge.
   */
  edgeOpacity?: { value: number };
};

export function createRefractionPreset(preset: {
  settings: RefractionSettings;
  ripple: RippleSettings;
  environment: () => THREE.Texture;
  edgeOpacity?: number;
}): RefractionPreset {
  return {
    tuning: Object.fromEntries(
      Object.entries(preset.settings).map(([key, value]) => [key, { value }]),
    ) as RefractionTuning,
    ripple: createLookupRipple(preset.ripple),
    environment: preset.environment,
    ...(preset.edgeOpacity !== undefined ? { edgeOpacity: { value: preset.edgeOpacity } } : {}),
  };
}

/**
 * The registered refraction presets: a block's `appearance.refraction` names one. The crystal
 * prototype is still; a preset brings its own ripple by its settings, not by a flag.
 */
export const refractionPresets = new Registry<RefractionPreset>("refraction preset");
refractionPresets.register(
  "crystal",
  createRefractionPreset({
    settings: crystalRefractionSettings,
    ripple: { amplitude: 0, period: 10, scale: 2 },
    environment: crystalV3Environment,
  }),
);

/**
 * The uniform slots every refraction material reads its captures from. Each capture pass binds its
 * own targets to them as it renders, so the main render that follows samples that renderer's
 * capture of this frame, never another renderer's or a stale one.
 */
const captureSlots = {
  backgroundMap: { value: null as THREE.Texture | null },
  offsetMap: { value: null as THREE.Texture | null },
  screenSize: { value: new THREE.Vector2(1, 1) },
};

const size = new THREE.Vector2();

/**
 * The per-frame passes for one preset, run before the main render by whoever draws these blocks
 * (the dev17 room, a profiler recipe), as one instance per renderer: it moves the preset's ripple
 * on, then fills its own two targets (doc/profiler-render-passes.md). `hide` is the group holding
 * the blocks.
 */
export function createRefractionCapture(preset: string): RenderPass {
  const background = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const offsets = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  return {
    render(frame) {
      refractionPresets.get(preset).ripple.advance(frame);
      const { renderer, scene, camera, hide } = frame;
      renderer.getDrawingBufferSize(size);
      const width = Math.max(1, Math.floor(size.x));
      const height = Math.max(1, Math.floor(size.y));
      background.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
      offsets.setSize(width, height);
      captureSlots.backgroundMap.value = background.texture;
      captureSlots.offsetMap.value = offsets.texture;
      captureSlots.screenSize.value.set(width, height);
      preservingRenderState(frame, () => {
        // 1. What lies behind the blocks.
        const shown = hide.visible;
        hide.visible = false;
        try {
          renderer.setRenderTarget(background);
          renderer.render(scene, camera);
        } finally {
          hide.visible = shown;
        }
        // 2. The rear facets' shifts, alone, on a cleared target (zero shift where there is none).
        scene.background = null;
        camera.layers.set(refractionOffsetLayer);
        renderer.setRenderTarget(offsets);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
      });
    },
    dispose() {
      for (const slot of [captureSlots.backgroundMap, captureSlots.offsetMap])
        if (slot.value === background.texture || slot.value === offsets.texture) slot.value = null;
      background.dispose();
      offsets.dispose();
    },
  };
}

/**
 * Calm water (prototype, #675; doc/refractive-water-prototypes.md): the same fake refraction,
 * gentler. A lower bend and magnification, almost no colour split, a slight cool tint and a
 * restrained, colourless reflection of a soft sky, with a slow lookup ripple. No bubbles: it
 * composes none.
 */
export const calmWaterSettings: RefractionSettings = {
  rearStrength: 0.06,
  frontStrength: 0.02,
  magnify: 0.12,
  dispersion: 0.02,
  fresnelBase: 0.02,
  fresnelPower: 5,
  spectral: 0,
  reflection: 0.35,
  clarity: 0.9,
};

refractionPresets.register(
  "calmWater",
  createRefractionPreset({
    settings: calmWaterSettings,
    // One full loop in 0.5–8 s, 8 s by default (#795; doc/calm-water-refinements.md).
    ripple: {
      amplitude: 0.006,
      period: 8,
      scale: 1.6,
      periodBounds: { min: 0.5, max: 8, step: 0.5 },
    },
    environment: calmSkyEnvironment,
    // Faint outlines by default (#796; doc/calm-water-refinements.md): 0 hides them.
    edgeOpacity: 0.08,
  }),
);

let calmSky: THREE.DataTexture | null = null;

/**
 * A soft, colourless sky for water to reflect: bright overhead, pale at the horizon, dark below,
 * with one broad light. Its own map, so water never reflects the crystals' spectral map or follows
 * its pattern controls. Shared and immutable, like the spectral map.
 */
export function calmSkyEnvironment(): THREE.DataTexture {
  if (calmSky) return calmSky;
  const width = 64;
  const height = 32;
  const data = new Float32Array(width * height * 4);
  const mix = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      // Rows run bottom (straight down) to top (straight up), as the lookup's latitude does.
      const up = (row + 0.5) / height;
      const below = [0.05, 0.08, 0.1];
      const horizon = [0.55, 0.62, 0.68];
      const above = [0.78, 0.86, 0.94];
      const light = Math.exp(-(((column / width - 0.3) * 6) ** 2 + ((up - 0.78) * 8) ** 2));
      const index = (row * width + column) * 4;
      for (let channel = 0; channel < 3; channel++)
        data[index + channel] =
          (up < 0.5
            ? mix(below[channel]!, horizon[channel]!, (up - 0.35) / 0.15)
            : mix(horizon[channel]!, above[channel]!, (up - 0.5) / 0.3)) +
          light * 0.8;
      data[index + 3] = 1;
    }
  calmSky = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  calmSky.colorSpace = THREE.LinearSRGBColorSpace;
  calmSky.wrapS = THREE.RepeatWrapping;
  calmSky.wrapT = THREE.ClampToEdgeWrapping;
  calmSky.magFilter = calmSky.minFilter = THREE.LinearFilter;
  calmSky.needsUpdate = true;
  calmSky.userData.shared = true;
  return calmSky;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec4 vCentre;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    // The block's own centre on screen, for the magnifying pull.
    vCentre = projectionMatrix * viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const rearFragment = /* glsl */ `
  uniform vec2 screenSize;
  uniform float rearStrength;
  uniform float magnify;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec4 vCentre;
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPosition);
    float incidence = abs(dot(n, v));
    // The facet's normal in view space: its screen direction is where the background shifts.
    vec3 viewNormal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
    vec2 shift = viewNormal.xy * rearStrength * (0.4 + 0.6 * (1.0 - incidence));
    vec2 uv = gl_FragCoord.xy / screenSize;
    vec2 centre = vCentre.xy / vCentre.w * 0.5 + 0.5;
    shift += (centre - uv) * magnify;
    // b = 1 marks a pixel a rear facet covered.
    gl_FragColor = vec4(shift, 1.0, 1.0);
  }
`;

const frontFragment = /* glsl */ `
  uniform sampler2D backgroundMap;
  uniform sampler2D offsetMap;
  uniform sampler2D environment;
  uniform vec2 screenSize;
  uniform float frontStrength;
  uniform float dispersion;
  uniform float fresnelBase;
  uniform float fresnelPower;
  uniform float spectral;
  uniform float clarity;
  uniform float reflection;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  const float PI = 3.141592653589793;

  vec3 lookUp(vec3 direction) {
    vec3 d = normalize(direction);
    vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
    vec3 light = texture2D(environment, uv).rgb;
    return mix(vec3(dot(light, vec3(0.2126, 0.7152, 0.0722))), light, spectral);
  }

  ${rippleShiftGlsl}

  vec3 behind(vec2 uv) {
    return texture2D(backgroundMap, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / screenSize;
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPosition);
    float incidence = clamp(abs(dot(n, v)), 0.0, 1.0);
    // The rear facet's shift under this pixel, reused, plus this front facet's own bend.
    vec4 rear = texture2D(offsetMap, uv);
    vec2 shift = rear.b > 0.5 ? rear.rg : vec2(0.0);
    vec3 viewNormal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
    shift -= viewNormal.xy * frontStrength * (1.0 - incidence);
    // The preset's slow cyclic ripple: the lookup moves, the outline never does.
    shift += rippleShift(vLocal);
    // Three taps: red bent least, blue most.
    vec3 seen = vec3(
      behind(uv + shift * (1.0 - dispersion)).r,
      behind(uv + shift).g,
      behind(uv + shift * (1.0 + dispersion)).b
    ) * vec3(clarity, clarity, 1.0);
    vec3 reflected = lookUp(reflect(-v, n)) * reflection;
    float fresnel = clamp(fresnelBase + (1.0 - fresnelBase) * pow(1.0 - incidence, fresnelPower), 0.0, 1.0);
    gl_FragColor = vec4(mix(seen, reflected, fresnel), 1.0);
    #include <colorspace_fragment>
  }
`;

/** The rear (offset) layer for one block: drawn only in the offset pass. */
export function createRefractionRear(
  geometry: THREE.BufferGeometry,
  preset: RefractionPreset,
): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: rearFragment,
    uniforms: { ...captureSlots, ...preset.tuning },
    side: THREE.BackSide,
  });
  const rear = new THREE.Mesh(geometry, material);
  rear.layers.set(refractionOffsetLayer);
  return rear;
}

/** The front faces: the faked refraction of what is behind, with the spectral reflection. */
export function createRefractionFront(preset: RefractionPreset): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: frontFragment,
    uniforms: {
      ...captureSlots,
      ...preset.tuning,
      ...rippleUniforms(preset.ripple),
      environment: { value: preset.environment() },
    },
    side: THREE.FrontSide,
  });
}
