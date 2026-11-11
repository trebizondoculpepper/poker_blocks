/**
 * Wall-coating storage candidates for the contained-components proof (#346, design #329).
 *
 * A coating remembers, for each place on a vessel's inner wall, how long ago the fluid last
 * wetted it, and fades it from there. Each vessel owns its own history; the fluid never knows a
 * coating exists. Every frame the coating is handed the fluid's surface (a plane in the vessel's
 * own space) and asks, for each of its samples, "is this point under the fluid?": a wet sample's
 * age goes back to zero (rewetting refreshes it), a dry one ages.
 *
 * Two storages are compared, registered by name so the room never asks which it holds:
 *
 * - **vertex:** one age per vertex of a subdivided box drawn just inside the wall. Detail is
 *   bounded by the mesh, so it needs a dense mesh of its own (a rounded block shell has too few
 *   vertices across a face to carry a wet line).
 * - **faceTexture:** one age per texel of a six-face atlas (one square per face). The shader
 *   finds the face and its texel from the fragment's local position, so detail is set by the
 *   texture's resolution and is independent of the wall mesh.
 *
 * Developer-only: nothing in the game imports this.
 */
import * as THREE from "three";

/** The fluid's top in the vessel's own (unscaled) space: inside where dot(p, normal) <= height. */
export type LiquidSurface = { normal: THREE.Vector3; height: number };

export type CoatingConfig = {
  /** Seconds for a wetted place to fade to about a third of its strength. */
  seconds: number;
  /** The film's strength where it is freshest. */
  opacity: number;
  /** The film's colour. */
  colour: number;
  /** Samples per face edge: vertices for `vertex`, texels for `faceTexture`. */
  resolution: number;
};

export type Coating = {
  mesh: THREE.Mesh;
  /** Age every sample by `delta` seconds and refresh the ones the surface now covers. */
  update(surface: LiquidSurface, delta: number): void;
  /**
   * Bytes of history this vessel keeps on the CPU (the GPU holds its texture or attribute
   * again). Shared, immutable sample positions are not counted here: see `texelCentres`.
   */
  readonly bytes: number;
  /** How many samples are tested each frame. */
  readonly samples: number;
  dispose(): void;
};

export type CoatingStorage = (scale: number, config: CoatingConfig) => Coating;

/** Ages are stored as a strength from 1 (just wet) down toward 0 (long dry). */
const fadeFor = (delta: number, seconds: number) => Math.exp(-delta / seconds);

const filmVertex = /* glsl */ `
  attribute float wet;
  uniform vec3 surfaceNormal;
  uniform float height;
  varying float vWet;
  varying vec3 vLocal;
  void main() {
    vWet = wet;
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const vertexFragment = /* glsl */ `
  uniform vec3 surfaceNormal;
  uniform float height;
  uniform vec3 colour;
  uniform float opacity;
  varying float vWet;
  varying vec3 vLocal;
  void main() {
    // Under the fluid the film is hidden by the fluid itself; only the wall above it shows.
    if (dot(vLocal, surfaceNormal) <= height) discard;
    float strength = vWet * opacity;
    if (strength < 0.01) discard;
    gl_FragColor = vec4(colour, strength);
  }
`;

/** One age per vertex of a box subdivided `resolution` times along each edge. */
function vertexCoating(scale: number, config: CoatingConfig): Coating {
  const geometry = new THREE.BoxGeometry(
    1,
    1,
    1,
    config.resolution,
    config.resolution,
    config.resolution,
  );
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  const wet = new Float32Array(positions.count);
  const attribute = new THREE.BufferAttribute(wet, 1);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("wet", attribute);
  const uniforms = filmUniforms(config);
  const mesh = filmMesh(geometry, scale, uniforms, filmVertex, vertexFragment);
  const p = new THREE.Vector3();
  return {
    mesh,
    update(surface, delta) {
      const fade = fadeFor(delta, config.seconds);
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i);
        wet[i] = p.dot(surface.normal) <= surface.height ? 1 : wet[i]! * fade;
      }
      attribute.needsUpdate = true;
      uniforms.surfaceNormal.value.copy(surface.normal);
      uniforms.height.value = surface.height;
    },
    bytes: wet.byteLength,
    samples: positions.count,
    dispose() {
      geometry.dispose();
      mesh.material.dispose();
    },
  };
}

const textureVertex = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The atlas is one column of six squares, face f at rows [f, f + 1) / 6. The face is the
 * dominant axis of the local position and its sign, so it needs no UVs from the mesh.
 */
const textureFragment = /* glsl */ `
  uniform sampler2D history;
  uniform float resolution;
  uniform vec3 surfaceNormal;
  uniform float height;
  uniform vec3 colour;
  uniform float opacity;
  varying vec3 vLocal;
  void main() {
    if (dot(vLocal, surfaceNormal) <= height) discard;
    vec3 a = abs(vLocal);
    float face;
    vec2 uv;
    if (a.x >= a.y && a.x >= a.z) { face = vLocal.x > 0.0 ? 0.0 : 1.0; uv = vLocal.zy / a.x; }
    else if (a.y >= a.z) { face = vLocal.y > 0.0 ? 2.0 : 3.0; uv = vLocal.xz / a.y; }
    else { face = vLocal.z > 0.0 ? 4.0 : 5.0; uv = vLocal.xy / a.z; }
    // Keep within this face's own texel centres, so filtering never blends in the next tile.
    uv = clamp(uv * 0.5 + 0.5, 0.5 / resolution, 1.0 - 0.5 / resolution);
    float strength = texture2D(history, vec2(uv.x, (face + uv.y) / 6.0)).r * opacity;
    if (strength < 0.01) discard;
    gl_FragColor = vec4(colour, strength);
  }
`;

/** One age per texel of a six-face atlas, `resolution` texels along each face edge. */
function faceTextureCoating(scale: number, config: CoatingConfig): Coating {
  const n = config.resolution;
  const data = new Uint8Array(n * n * 6);
  const texture = new THREE.DataTexture(data, n, n * 6, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // Texel centres are immutable for a resolution: shared by every vessel (#329 tier 1).
  const centres = texelCentres(n);
  const strength = new Float32Array(n * n * 6);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uniforms = {
    ...filmUniforms(config),
    history: { value: texture },
    resolution: { value: n },
  };
  const mesh = filmMesh(geometry, scale, uniforms, textureVertex, textureFragment);
  return {
    mesh,
    update(surface, delta) {
      const fade = fadeFor(delta, config.seconds);
      const { x, y, z } = surface.normal;
      for (let i = 0; i < strength.length; i++) {
        const along = centres[i * 3]! * x + centres[i * 3 + 1]! * y + centres[i * 3 + 2]! * z;
        strength[i] = along <= surface.height ? 1 : strength[i]! * fade;
        data[i] = Math.round(strength[i]! * 255);
      }
      texture.needsUpdate = true;
      uniforms.surfaceNormal.value.copy(surface.normal);
      uniforms.height.value = surface.height;
    },
    bytes: strength.byteLength + data.byteLength,
    samples: strength.length,
    dispose() {
      geometry.dispose();
      texture.dispose();
      mesh.material.dispose();
    },
  };
}

const centresByResolution = new Map<number, Float32Array>();

/** The local position at the centre of every texel of a `n`-per-edge atlas, made once per `n`. */
export function texelCentres(n: number): Float32Array {
  const cached = centresByResolution.get(n);
  if (cached) return cached;
  const centres = new Float32Array(n * n * 6 * 3);
  const axes: [number, number, number, number][] = [
    // [axis, sign, u axis, v axis], in the shader's face order.
    [0, 1, 2, 1],
    [0, -1, 2, 1],
    [1, 1, 0, 2],
    [1, -1, 0, 2],
    [2, 1, 0, 1],
    [2, -1, 0, 1],
  ];
  axes.forEach(([axis, sign, u, v], face) => {
    for (let row = 0; row < n; row++)
      for (let column = 0; column < n; column++) {
        const point = [0, 0, 0];
        point[axis] = 0.5 * sign;
        point[u] = (column + 0.5) / n - 0.5;
        point[v] = (row + 0.5) / n - 0.5;
        centres.set(point, ((face * n + row) * n + column) * 3);
      }
  });
  centresByResolution.set(n, centres);
  return centres;
}

function filmUniforms(config: CoatingConfig) {
  return {
    surfaceNormal: { value: new THREE.Vector3(0, 1, 0) },
    height: { value: 0 },
    colour: { value: new THREE.Color(config.colour) },
    opacity: { value: config.opacity },
  };
}

/** The film just inside the wall, drawn from the back (the inner wall facing the viewer). */
function filmMesh(
  geometry: THREE.BufferGeometry,
  scale: number,
  uniforms: Record<string, THREE.IUniform>,
  vertexShader: string,
  fragmentShader: string,
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.scale.setScalar(scale);
  return mesh;
}

/** The storages under comparison, by name. */
export const coatingStorages = new Map<string, CoatingStorage>([
  ["vertex", vertexCoating],
  ["faceTexture", faceTextureCoating],
]);
