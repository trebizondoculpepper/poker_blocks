/**
 * Internal reflections, ignoring the background: a PROTOTYPE for the owner to judge (follows
 * Crystal v3, #645, and the refraction prototype). Not yet a merged design.
 *
 * Per frame, shared by every block:
 * 1. **Rear pass: the inside of the crystal.** Only the blocks' back faces are drawn, on their own
 *    camera layer, into a shared screen-sized colour target. Each pixel is the rainbow map seen by
 *    the view ray reflecting off that back facet from inside. Nothing behind the block is used.
 * 2. **Front faces distort it.** Each front pixel reads that inner image displaced on screen by
 *    the difference between the facet's external reflection and the ray bent into the crystal
 *    (its internal direction), plus a share of the facet's own normal, all projected to the
 *    screen and growing towards grazing angles. Red, green and blue are displaced slightly apart.
 *    The external rainbow reflection is blended on by Fresnel. The front is opaque.
 *
 * Flat facets keep their own constant normal, so each facet shows its own displaced piece of the
 * inner reflections, which breaks up and shifts as the block turns.
 */
import * as THREE from "three";
import { crystalV3Environment } from "./crystal-v3";

/** The camera layer the rear (inner image) pass draws: never the main view. */
export const internalLayer = 8;

export const internalTuning = {
  /** How strongly the external/internal ray difference displaces the inner image. */
  distortion: { value: 0.08 },
  /** How much the facet's own normal adds to the displacement. */
  normalShift: { value: 0.03 },
  /** The crystal's index of refraction, for the ray bent into it. */
  ior: { value: 2.0 },
  /** How bright the inner reflections are, and how bright the outer one. */
  inner: { value: 1.0 },
  outer: { value: 0.8 },
  /** How far apart the red and blue samples are, as a share of the displacement. */
  dispersion: { value: 0.15 },
  fresnelBase: { value: 0.08 },
  fresnelPower: { value: 3.5 },
  spectral: { value: 0.9 },
};

const shared = {
  inner: null as THREE.WebGLRenderTarget | null,
  uniforms: {
    innerMap: { value: null as THREE.Texture | null },
    screenSize: { value: new THREE.Vector2(1, 1) },
  },
};

const size = new THREE.Vector2();
const clearColour = new THREE.Color();

/** The rear pass, run before the main render by whoever draws these blocks (its `frame` hook). */
export function internalFrame(context: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}): void {
  const { renderer, scene, camera } = context;
  renderer.getDrawingBufferSize(size);
  const width = Math.max(1, Math.floor(size.x));
  const height = Math.max(1, Math.floor(size.y));
  shared.inner ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  shared.inner.setSize(width, height);
  shared.uniforms.innerMap.value = shared.inner.texture;
  shared.uniforms.screenSize.value.set(width, height);

  const previous = renderer.getRenderTarget();
  const alpha = renderer.getClearAlpha();
  renderer.getClearColor(clearColour);
  const mask = camera.layers.mask;
  const background = scene.background;
  scene.background = null;
  camera.layers.set(internalLayer);
  renderer.setRenderTarget(shared.inner);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  camera.layers.mask = mask;
  scene.background = background;
  renderer.setClearColor(clearColour, alpha);
  renderer.setRenderTarget(previous);
}

/** Free the shared target (the room's dispose). */
export function disposeInternal(): void {
  shared.inner?.dispose();
  shared.inner = null;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const lookUp = /* glsl */ `
  uniform sampler2D environment;
  uniform float spectral;
  const float PI = 3.141592653589793;
  vec3 lookUp(vec3 direction) {
    vec3 d = normalize(direction);
    vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
    vec3 light = texture2D(environment, uv).rgb;
    return mix(vec3(dot(light, vec3(0.2126, 0.7152, 0.0722))), light, spectral);
  }
`;

const rearFragment = /* glsl */ `
  uniform float inner;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  ${lookUp}
  void main() {
    vec3 v = normalize(cameraPosition - vWorldPosition);
    vec3 n = normalize(vWorldNormal);
    // The view ray, inside the crystal, reflecting off this back facet.
    vec3 bounced = reflect(-v, n);
    gl_FragColor = vec4(lookUp(bounced) * inner, 1.0);
  }
`;

const frontFragment = /* glsl */ `
  uniform sampler2D innerMap;
  uniform vec2 screenSize;
  uniform float distortion;
  uniform float normalShift;
  uniform float ior;
  uniform float outer;
  uniform float dispersion;
  uniform float fresnelBase;
  uniform float fresnelPower;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  ${lookUp}

  vec3 insideAt(vec2 uv, vec3 fallback) {
    vec4 seen = texture2D(innerMap, clamp(uv, vec2(0.001), vec2(0.999)));
    return seen.a > 0.5 ? seen.rgb : fallback;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / screenSize;
    vec3 v = normalize(cameraPosition - vWorldPosition);
    vec3 n = normalize(vWorldNormal);
    float incidence = clamp(abs(dot(n, v)), 0.0, 1.0);
    vec3 outward = reflect(-v, n);
    vec3 internal = refract(-v, n, 1.0 / ior);
    // Total internal reflection can't happen entering the crystal; guard anyway.
    if (dot(internal, internal) < 1e-4) internal = -n;
    // The displacement: how far the outer and inner rays part, plus the facet's own tilt, on
    // screen, growing towards grazing angles.
    vec3 apart = (outward - internal) * distortion + n * normalShift;
    vec2 shift = (viewMatrix * vec4(apart, 0.0)).xy * (0.35 + 0.65 * (1.0 - incidence));
    vec3 fallback = lookUp(internal);
    vec3 seen = vec3(
      insideAt(uv + shift * (1.0 - dispersion), fallback).r,
      insideAt(uv + shift, fallback).g,
      insideAt(uv + shift * (1.0 + dispersion), fallback).b
    );
    vec3 reflected = lookUp(outward) * outer;
    float fresnel = clamp(fresnelBase + (1.0 - fresnelBase) * pow(1.0 - incidence, fresnelPower), 0.0, 1.0);
    gl_FragColor = vec4(mix(seen, reflected, fresnel), 1.0);
    #include <colorspace_fragment>
  }
`;

const environmentUniform = () => ({ environment: { value: crystalV3Environment() } });

/** The rear (inner image) layer for one block: drawn only in the rear pass. */
export function createInternalRear(geometry: THREE.BufferGeometry): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: rearFragment,
    uniforms: { ...shared.uniforms, ...internalTuning, ...environmentUniform() },
    side: THREE.BackSide,
  });
  const rear = new THREE.Mesh(geometry, material);
  rear.layers.set(internalLayer);
  return rear;
}

/** The front faces: the inner reflections displaced, with the outer reflection on top. */
export function createInternalFront(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: frontFragment,
    uniforms: { ...shared.uniforms, ...internalTuning, ...environmentUniform() },
    side: THREE.FrontSide,
  });
}
