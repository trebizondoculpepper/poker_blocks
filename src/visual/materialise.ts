import { Box3, Color, Mesh, Sphere } from "three";
import type { Material, Object3D, WebGLProgramParametersWithUniforms } from "three";
// Adapted from ../shrew_farmer/src/hud/materialise.ts, which was adapted from
// encabulator/src/toolkit/components/core/views/materialise.ts.
function materialiseAt(seconds: number, duration: number): number {
  if (duration <= 0) return 1;
  const t = Math.min(1, Math.max(0, seconds / duration));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 3D gradient (Perlin) noise and a few octaves of it, for the shader. */
const NOISE = `
vec3 matHash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float matPerlin(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define MAT_CORNER(o) dot(matHash(i + o), f - o)
  return mix(
    mix(mix(MAT_CORNER(vec3(0, 0, 0)), MAT_CORNER(vec3(1, 0, 0)), u.x),
        mix(MAT_CORNER(vec3(0, 1, 0)), MAT_CORNER(vec3(1, 1, 0)), u.x), u.y),
    mix(mix(MAT_CORNER(vec3(0, 0, 1)), MAT_CORNER(vec3(1, 0, 1)), u.x),
        mix(MAT_CORNER(vec3(0, 1, 1)), MAT_CORNER(vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float matFbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * matPerlin(p);
    p = p * 2.03 + 17.0;
    amplitude *= 0.5;
  }
  return sum;
}`;

/** How wide the glowing edge is, as a share of the noise's range. */
const EDGE = 0.12;
/** How many blobs of noise lie across the thing. */
const BLOBS = 8;

/**
 * Make `root` materialise: its meshes boil in from nothing. A field of
 * Perlin noise, fixed in space and slowly churning, decides where it is
 * drawn: a threshold sweeps through the field (`materialiseAt`) so the
 * thing appears in islands that spread and join, each edge burning hot,
 * until it is whole. Each mesh draws meanwhile with a copy of its own
 * material, the noise added to its shader; at the end its own material is
 * put back and the copies freed, so the thing is as it was made. Under
 * reduced motion it simply fades in, briefly.
 *
 * Its noise is scaled to the thing, about eight blobs across it, so a
 * small card boils as a big cabinet does; call `update` each frame until
 * it returns false.
 *
 * `out` runs it backwards, to despawn a thing: it boils away, holes
 * opening in islands that spread and join, each edge burning, until
 * nothing is left; then it is hidden (and its materials put back), for
 * its owner to take away.
 */
export function createMaterialise(
  root: Object3D,
  {
    seconds = 1.6,
    reduced = false,
    glow = "#ffb347",
    out = false,
    replaced = false,
  }: {
    seconds?: number;
    reduced?: boolean;
    glow?: string;
    /** Boil away instead of in. */
    out?: boolean;
    /**
     * Give way to another object dissolving in at the same place and moment: shown exactly
     * where that one is not yet, so between them nothing is ever missing.
     */
    replaced?: boolean;
  } = {},
) {
  const progress = { value: out ? 1 : 0 };
  const time = { value: 0 };
  const uniforms = {
    matProgress: progress,
    matTime: time,
    matFrequency: {
      value:
        BLOBS /
        Math.max(1e-6, new Box3().setFromObject(root).getBoundingSphere(new Sphere()).radius * 2),
    },
    matEdge: { value: reduced ? 0 : EDGE },
    matGlow: { value: new Color(glow) },
    matReduced: { value: reduced ? 1 : 0 },
    matReplaced: { value: replaced ? 1 : 0 },
  };
  const copies = new Map<Material, Material>();
  const meshes: {
    mesh: Mesh;
    material: Material | Material[];
    castShadow: boolean;
  }[] = [];
  const copy = (original: Material) => {
    let made = copies.get(original);
    if (made) return made;
    made = original.clone();
    // Share, not copy, what the original's own shader reads from it.
    made.userData = original.userData;
    const before = original.onBeforeCompile.bind(original);
    const key = original.customProgramCacheKey.bind(original);
    made.customProgramCacheKey = () => `${key()}|materialise`;
    // Reduced, it fades: drawn see-through until whole.
    if (reduced) made.transparent = true;
    made.onBeforeCompile = function (shader: WebGLProgramParametersWithUniforms, renderer) {
      before(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `varying vec3 matWorld;\n${shader.vertexShader}`.replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
        matWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
      shader.fragmentShader = `varying vec3 matWorld;
        uniform float matProgress;
        uniform float matTime;
        uniform float matFrequency;
        uniform float matEdge;
        uniform vec3 matGlow;
        uniform float matReduced;
        uniform float matReplaced;
        ${NOISE}
        ${shader.fragmentShader}`
        .replace(
          "void main() {",
          `void main() {
          // Where the noise, churning, is under the rising threshold, it
          // is there; at the threshold it burns; beyond, nothing yet.
          float matRim = 0.0;
          if (matReduced < 0.5) {
            vec3 matAt = matWorld * matFrequency
              + vec3(0.0, matTime * 0.9, matTime * 0.4);
            // Layered noise gathers near its middle: spread it over the
            // whole sweep, so the thing comes in steadily, not all at once.
            float matNoise = clamp(matFbm(matAt) * 1.6 + 0.5, 0.0, 1.0);
            float matCut = mix(-matEdge, 1.0 + matEdge, matProgress);
            if (matReplaced > 0.5) {
              // The complement: here only where the arriving object is not yet.
              if (matNoise <= matCut) discard;
            } else {
              if (matNoise > matCut) discard;
              matRim = 1.0 - smoothstep(0.0, matEdge, matCut - matNoise);
            }
          }`,
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          // The burning edge: orange, white-hot at its very front.
          gl_FragColor.rgb += mix(matGlow, vec3(1.0, 0.97, 0.9), matRim * matRim) * matRim * 4.0;
          if (matReduced > 0.5) gl_FragColor.a *= matReplaced > 0.5 ? 1.0 - matProgress : matProgress;`,
        );
    };
    copies.set(original, made);
    return made;
  };
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as Material | Material[];
    meshes.push({ mesh: object, material, castShadow: object.castShadow });
    object.material = Array.isArray(material) ? material.map(copy) : copy(material);
    // A shadow would show it whole before it is.
    object.castShadow = false;
  });
  let elapsed = 0;
  let running = true;
  const duration = reduced ? Math.min(seconds, 0.4) : seconds;
  /** Put every mesh's own material back, and free the copies. */
  const finish = () => {
    if (!running) return;
    running = false;
    // Boiled away (or replaced): nothing of it left to see.
    if (out || replaced) root.visible = false;
    for (const { mesh, material, castShadow } of meshes) {
      mesh.material = material;
      mesh.castShadow = castShadow;
    }
    for (const made of copies.values()) made.dispose();
    copies.clear();
  };
  return {
    /** Advance it; false once it is whole and its materials restored. */
    update(delta: number) {
      if (!running) return false;
      elapsed += delta;
      time.value += delta;
      const at = materialiseAt(elapsed, duration);
      progress.value = out ? 1 - at : at;
      if (elapsed >= duration) finish();
      return running;
    },
    get running() {
      return running;
    },
    /** Make it whole at once (or, going `out`, gone). */
    finish,
  };
}
