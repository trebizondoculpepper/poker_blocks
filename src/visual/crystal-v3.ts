/**
 * Crystal v3 (#645; design in doc/crystal-v3.md): a clean-surface layered optics experiment. The
 * block keeps its own geometry, faces, bevels and print; two mapped layers over one shared smooth
 * spectral environment suggest depth:
 *
 * 1. **Rear:** the block's back faces, looking *through* the block. The lookup starts from the
 *    view direction and is bent, within the face plane, by a bounded amount that grows towards
 *    grazing angles.
 * 2. **Front:** the front faces, a reflection lookup offset the same way by its own response, and
 *    blended over the rear by a Fresnel weight (stronger towards grazing angles).
 * 3. **Print:** the existing print skin, drawn last and never displaced.
 *
 * Offsets move map lookups, never the surface; there is no noise, pattern, render target,
 * transmission, dispersion loop or crystal fire. The front blends over the rear: it does not read
 * or distort the rear's pixels. Tuning is a set of shared uniforms (`crystalV3Tuning`), so
 * developer controls change every v3 block live; one environment texture is shared and kept.
 */
import * as THREE from "three";

/** The experiment's tunable values (provisional defaults, judged by eye in dev17). */
export type CrystalV3Settings = {
  /** 0 is a white/grey environment; 1 is its full spectral colour. */
  spectral: number;
  frontIntensity: number;
  rearIntensity: number;
  /** How far, at most, each layer's lookup is offset towards grazing angles. */
  frontOffset: number;
  rearOffset: number;
  rearOpacity: number;
  /** Reflectance face-on, and how sharply it rises towards grazing angles. */
  fresnelBase: number;
  fresnelPower: number;
};

export const crystalV3Defaults: CrystalV3Settings = {
  spectral: 0.9,
  frontIntensity: 1.2,
  rearIntensity: 1.1,
  frontOffset: 0.35,
  rearOffset: 0.6,
  rearOpacity: 0.92,
  fresnelBase: 0.18,
  fresnelPower: 3,
};

/** The shared uniforms every v3 block reads, so a control changes all of them at once. */
export const crystalV3Tuning: { [K in keyof CrystalV3Settings]: { value: number } } = {
  spectral: { value: crystalV3Defaults.spectral },
  frontIntensity: { value: crystalV3Defaults.frontIntensity },
  rearIntensity: { value: crystalV3Defaults.rearIntensity },
  frontOffset: { value: crystalV3Defaults.frontOffset },
  rearOffset: { value: crystalV3Defaults.rearOffset },
  rearOpacity: { value: crystalV3Defaults.rearOpacity },
  fresnelBase: { value: crystalV3Defaults.fresnelBase },
  fresnelPower: { value: crystalV3Defaults.fresnelPower },
};

const environmentWidth = 256;
const environmentHeight = 128;

/**
 * The smooth spectral environment, as linear RGB in an equirectangular layout: hue turns slowly
 * with longitude at restrained saturation, with broad pale bands of light at a few latitudes.
 * Smooth everywhere, with no cells, and continuous across the longitude seam.
 */
export function spectralEnvironment(
  width = environmentWidth,
  height = environmentHeight,
): Float32Array {
  const data = new Float32Array(width * height * 4);
  const colour = new THREE.Color();
  for (let y = 0; y < height; y++) {
    const latitude = (y / (height - 1)) * Math.PI - Math.PI / 2;
    // Broad pale bands: soft studio lights above and a dimmer floor below.
    // Soft pale bands, kept low so they light the spectrum rather than wash it out.
    const band =
      0.3 * Math.exp(-(((latitude - 0.7) / 0.18) ** 2)) +
      0.12 * Math.exp(-(((latitude + 0.25) / 0.25) ** 2));
    const shade = 0.55 + 0.45 * (latitude / Math.PI + 0.5);
    for (let x = 0; x < width; x++) {
      // Hue turns six times around the horizon and drifts with height, so the small change in
      // lookup across one face, and any turn of the block, sweeps through the spectrum (#645).
      const hue = ((x / width) * 6 + (y / height) * 1.5) % 1;
      // Saturation fades to nothing at the poles, where every longitude meets one direction,
      // so the sphere has no pinwheel there (#647 review).
      const polar = Math.cos(latitude);
      colour.setHSL(hue, 0.9 * polar * polar, 0.55);
      const at = (y * width + x) * 4;
      data[at] = Math.min(1.5, colour.r * shade + band);
      data[at + 1] = Math.min(1.5, colour.g * shade + band);
      data[at + 2] = Math.min(1.5, colour.b * shade + band);
      data[at + 3] = 1;
    }
  }
  return data;
}

let environment: THREE.DataTexture | null = null;

/** The shared environment, made once and kept: it is a uniform, never a map a block frees. */
export function crystalV3Environment(): THREE.DataTexture {
  if (environment) return environment;
  environment = new THREE.DataTexture(
    spectralEnvironment(),
    environmentWidth,
    environmentHeight,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  // Linear values: decoded nowhere, converted for output once by colorspace_fragment.
  environment.colorSpace = THREE.LinearSRGBColorSpace;
  environment.wrapS = THREE.RepeatWrapping;
  environment.wrapT = THREE.ClampToEdgeWrapping;
  environment.magFilter = environment.minFilter = THREE.LinearFilter;
  environment.needsUpdate = true;
  return environment;
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

/** Shared GLSL: the environment lookup, the incidence and the bounded in-plane offset. */
const common = /* glsl */ `
  uniform sampler2D environment;
  uniform float spectral;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  const float PI = 3.141592653589793;

  vec3 lookUp(vec3 direction) {
    vec3 d = normalize(direction);
    vec2 uv = vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
    vec3 light = texture2D(environment, uv).rgb;
    float grey = dot(light, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(grey), light, spectral);
  }

  // The view direction projected into the face's plane: where an offset points. Zero face-on.
  vec3 inPlane(vec3 n, vec3 v) {
    vec3 p = v - n * dot(n, v);
    float length2 = dot(p, p);
    return length2 > 1e-8 ? p * inversesqrt(length2) : vec3(0.0);
  }

  // How much of the offset applies: none face-on, rising smoothly and bounded towards grazing.
  float offsetAmount(float incidence) {
    return smoothstep(0.0, 1.0, 1.0 - incidence);
  }
`;

const rearFragment = /* glsl */ `
  uniform float rearIntensity;
  uniform float rearOffset;
  uniform float rearOpacity;
  ${common}
  void main() {
    vec3 v = normalize(cameraPosition - vWorldPosition);
    // A back face: its normal points away; turn it to face the viewer for the incidence.
    vec3 n = normalize(vWorldNormal);
    if (dot(n, v) < 0.0) n = -n;
    float incidence = abs(dot(n, v));
    // Looking through the block, bent within the face plane by a bounded amount.
    vec3 through = -v + inPlane(n, v) * (rearOffset * offsetAmount(incidence));
    vec3 light = lookUp(through) * rearIntensity;
    gl_FragColor = vec4(light, rearOpacity);
    #include <colorspace_fragment>
  }
`;

const frontFragment = /* glsl */ `
  uniform float frontIntensity;
  uniform float frontOffset;
  uniform float fresnelBase;
  uniform float fresnelPower;
  ${common}
  void main() {
    vec3 v = normalize(cameraPosition - vWorldPosition);
    vec3 n = normalize(vWorldNormal);
    float incidence = clamp(abs(dot(n, v)), 0.0, 1.0);
    // A reflection, offset by its own response: not the rear's lookup mirrored.
    vec3 reflected = reflect(-v, n) - inPlane(n, v) * (frontOffset * offsetAmount(incidence));
    vec3 light = lookUp(reflected) * frontIntensity;
    float fresnel = fresnelBase + (1.0 - fresnelBase) * pow(1.0 - incidence, fresnelPower);
    gl_FragColor = vec4(light, clamp(fresnel, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

/** The uniforms one v3 material reads: the shared environment and the shared tuning. */
function uniforms() {
  return { environment: { value: crystalV3Environment() }, ...crystalV3Tuning };
}

/**
 * The rear layer for one block: its back faces, drawn before its front layer and print. Owned by
 * the block (freed with its extras); the environment and tuning are shared.
 */
export function createCrystalV3Rear(geometry: THREE.BufferGeometry): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: rearFragment,
    uniforms: uniforms(),
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const rear = new THREE.Mesh(geometry, material);
  // Rear, then the front faces (0), then the print (20): see doc/crystal-v3.md on ordering.
  rear.renderOrder = -10;
  return rear;
}

/** The front layer: the block's own front faces, Fresnel-blended over the rear. */
export function createCrystalV3Front(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: frontFragment,
    uniforms: uniforms(),
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
}
