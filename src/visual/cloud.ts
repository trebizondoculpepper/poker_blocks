/**
 * A contained cloud (#336): soft, drifting cloud inside a container's interior, as contents.
 * It is a light raymarch through the interior volume (a few steps of soft noise density), in
 * the contents' transparent layer, so it never writes depth over the container's other parts.
 * Its drift comes from the block's one contained frame (`update`), not a clock of its own. It
 * publishes nothing: a cloud has no liquid surface, so residue that needs one cannot pair with it.
 *
 * Colour, density and drift speed are configuration; nothing here knows its container.
 */
import * as THREE from "three";
import { containedContents } from "./contained";

export type CloudConfig = {
  /** The cloud's colour (hex). */
  colour: number;
  /** How thick it looks, 0 (none) to about 2 (dense). */
  density: number;
  /** How fast it drifts, in interior widths per second. */
  drift: number;
};

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vOrigin;
  void main() {
    vLocal = position;
    // The camera in the volume's own space, so the march needs no per-frame uniform.
    vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform float halfSize;
  uniform vec3 colour;
  uniform float density;
  uniform float drift;
  varying vec3 vLocal;
  varying vec3 vOrigin;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float cloud(vec3 p) {
    vec3 q = p / halfSize * 1.6 + vec3(time * drift, time * drift * 0.4, 0.0);
    float n = noise(q) * 0.6 + noise(q * 2.1) * 0.3 + noise(q * 4.3) * 0.1;
    // Fade out towards the walls, so the cloud stays inside its container.
    float edge = 1.0 - smoothstep(0.55, 0.98, max(max(abs(p.x), abs(p.y)), abs(p.z)) / halfSize);
    return max(n - 0.42, 0.0) * edge * density * 3.0;
  }
  void main() {
    // March from where the ray enters the back face, toward the camera, through the box.
    vec3 dir = normalize(vLocal - vOrigin);
    vec3 p = vLocal;
    float step = halfSize * 2.0 / 14.0;
    float alpha = 0.0;
    for (int i = 0; i < 14; i++) {
      p -= dir * step;
      if (any(greaterThan(abs(p), vec3(halfSize)))) break;
      float d = cloud(p) * step / halfSize;
      alpha += (1.0 - alpha) * clamp(d, 0.0, 1.0);
      if (alpha > 0.95) break;
    }
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(colour, alpha);
  }
`;

containedContents.register("cloud", (boundary, raw) => {
  const config = raw as CloudConfig;
  const uniforms = {
    time: { value: 0 },
    halfSize: { value: boundary.halfSize },
    colour: { value: new THREE.Color(config.colour) },
    density: { value: config.density },
    drift: { value: config.drift },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const mesh = boundary.volume(material, "contentsTransparent");
  return {
    meshes: [mesh],
    capabilities: {},
    update: ({ seconds }) => void (uniforms.time.value = seconds),
  };
});
