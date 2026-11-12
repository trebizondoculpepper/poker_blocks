/**
 * Approximate crystal optics (#523): a crystal-compatible look with no physical transmission, no
 * scene refraction and no crystal fire, for side-by-side comparison with the current look
 * (doc/game-architecture.md, "Approximate crystal optics and the comparison room").
 *
 * - **Outer:** a tinted, see-through standard material carrying the block's own face artwork,
 *   with a clearcoat and the shared static reflection environment for facet highlights.
 * - **Inner:** a back-face shell drawn additively. Its shader samples one shared procedural facet
 *   texture at coordinates offset by the view direction in the face's own plane (parallax), so
 *   inner facets seem to lie at depth and slide as the block turns; a tight glint adds sparkle.
 *
 * The facet texture is shared by every approximate crystal and never disposed per block. Each
 * block's shell has its own small shader material (freed with the block, as every extra's is),
 * whose identical source lets three.js reuse one compiled program.
 */
import * as THREE from "three";
import { additiveLight } from "./additive-light";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vParallax;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    // The view direction in the block's own space, split along the face's plane.
    vec3 toCamera = normalize((inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position);
    vec3 n = normalize(normal);
    vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t);
    vParallax = vec2(dot(toCamera, t), dot(toCamera, b)) / max(abs(dot(toCamera, n)), 0.25);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D facets;
  uniform float depth;
  uniform float intensity;
  uniform vec3 tint;
  varying vec2 vUv;
  varying vec2 vParallax;
  varying vec3 vWorldPosition;
  void main() {
    vec3 facet = texture2D(facets, fract(vUv + vParallax * depth)).rgb;
    vec3 view = normalize(vWorldPosition - cameraPosition);
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (dot(normal, view) > 0.0) normal = -normal;
    float sparkle = pow(max(dot(reflect(view, normal), normalize(vec3(0.3, 0.9, 0.3))), 0.0), 200.0) * 3.0;
    vec3 light = min((facet * tint + sparkle) * intensity, vec3(1.0));
    gl_FragColor = vec4(light, max(light.r, max(light.g, light.b)));
  }
`;

const facetSize = 128;

/** A seeded pattern of bright, faintly coloured facets (cells around scattered points). */
export function facetPattern(size = facetSize, points = 18, seed = 7): Uint8Array {
  let state = seed >>> 0 || 1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const sites = Array.from({ length: points }, () => ({
    x: random() * size,
    y: random() * size,
    colour: [0.6 + random() * 0.4, 0.6 + random() * 0.4, 0.7 + random() * 0.3],
    shade: 0.15 + random() * 0.85,
  }));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Nearest and second-nearest site, wrapping, so the pattern tiles.
      let first = Infinity;
      let second = Infinity;
      let nearest = sites[0]!;
      for (const site of sites) {
        const dx = Math.min(Math.abs(x - site.x), size - Math.abs(x - site.x));
        const dy = Math.min(Math.abs(y - site.y), size - Math.abs(y - site.y));
        const distance = dx * dx + dy * dy;
        if (distance < first) {
          second = first;
          first = distance;
          nearest = site;
        } else if (distance < second) second = distance;
      }
      // Bright edges between facets, each facet's own shade inside.
      const edge = Math.max(0, 1 - (Math.sqrt(second) - Math.sqrt(first)) / 3);
      const value = Math.min(1, nearest.shade * 0.6 + edge);
      const at = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        data[at + channel] = Math.round(255 * value * nearest.colour[channel]!);
      data[at + 3] = 255;
    }
  return data;
}

let facets: THREE.DataTexture | null = null;

/** The shared facet texture, made once and kept: it is a uniform, never a map a block frees. */
export function facetTexture(): THREE.DataTexture {
  if (facets) return facets;
  facets = new THREE.DataTexture(facetPattern(), facetSize, facetSize);
  facets.wrapS = facets.wrapT = THREE.RepeatWrapping;
  facets.needsUpdate = true;
  return facets;
}

/** The inner facet shell for one block: its geometry is the block's, its texture shared. */
export function createFacetShell(geometry: THREE.BufferGeometry, tint = 0xffffff): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      facets: { value: facetTexture() },
      depth: { value: 0.18 },
      intensity: { value: 0.3 },
      tint: { value: new THREE.Color(tint) },
    },
    side: THREE.BackSide,
    transparent: false,
    ...additiveLight,
    depthWrite: false,
  });
  const shell = new THREE.Mesh(geometry, material);
  shell.scale.setScalar(0.96);
  shell.renderOrder = 10;
  return shell;
}

/** The outer layer on the table: tinted and see-through, no transmission pass. */
export function approximateOuter(
  texture: THREE.Texture,
  tint: number,
  environment: THREE.Texture | null,
  environmentIntensity: number,
  /** Thin-film colour from the material's optics, which needs no transmission pass. */
  iridescence: THREE.MeshPhysicalMaterialParameters = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    color: tint,
    roughness: 0.04,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMap: environment,
    envMapIntensity: environmentIntensity,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    ...iridescence,
  });
}
