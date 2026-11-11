/**
 * A fading wall film (#334): the residue a fluid leaves on the inside of its container, with a
 * local history. The wall is divided into a six-face atlas (one square per face, `resolution`
 * texels along each edge; the representation chosen by the #346 proof). Each frame every texel
 * asks the contents' published `liquidSurface` whether it is wet: a wet texel goes back to full
 * strength (rewetting refreshes it), a dry one fades by its own age, `exp(-delta / seconds)`.
 * So recently exposed and older patches show different strengths and fade to nothing.
 *
 * The fluid never knows the film exists; the film keeps its own history per vessel. Above the
 * surface the film shows; below it the fluid hides the wall anyway. One byte per texel: 6 KB per
 * vessel at 32. The texel positions are shared by every film of a resolution.
 */
import * as THREE from "three";
import { containedResidues, type ResidueHandler } from "./contained";

export type FadingFilmConfig = {
  /** The film's colour (hex). */
  fill: number;
  /** Its opacity where it is freshest. */
  opacity: number;
  /** Seconds for an exposed patch to fade to about a third of its strength. */
  seconds: number;
  /** Texels along each face edge. */
  resolution: number;
};

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The face is the dominant axis of the local position and its sign, so the film needs no UVs
 * from the wall mesh; each face reads only its own texel centres, so filtering never blends in
 * the next tile.
 */
const fragmentShader = /* glsl */ `
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
    uv = clamp(uv * 0.5 + 0.5, 0.5 / resolution, 1.0 - 0.5 / resolution);
    float strength = texture2D(history, vec2(uv.x, (face + uv.y) / 6.0)).r * opacity;
    if (strength < 0.01) discard;
    gl_FragColor = vec4(colour, strength);
  }
`;

const centresByResolution = new Map<number, Float32Array>();

/** The centre of every texel of an `n`-per-edge atlas on a unit cube, made once per `n`. */
export function texelCentres(n: number): Float32Array {
  const cached = centresByResolution.get(n);
  if (cached) return cached;
  const centres = new Float32Array(n * n * 6 * 3);
  // [axis, sign, u axis, v axis], in the shader's face order.
  const axes: [number, number, number, number][] = [
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

export const fadingFilm: ResidueHandler = {
  requires: "liquidSurface",
  build(boundary, { liquidSurface }, raw) {
    const config = raw as FadingFilmConfig;
    const surface = liquidSurface!;
    const n = config.resolution;
    const centres = texelCentres(n);
    const strength = new Uint8Array(n * n * 6);
    const texture = new THREE.DataTexture(strength, n, n * 6, THREE.RedFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const uniforms = {
      history: { value: texture },
      resolution: { value: n },
      surfaceNormal: { value: surface.normal },
      // The published height is block-local; the wall mesh's own units are scaled by wallScale.
      height: { value: surface.height / boundary.wallScale },
      colour: { value: new THREE.Color(config.fill) },
      opacity: { value: config.opacity },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    material.addEventListener("dispose", () => texture.dispose());
    const film = boundary.wall(material, "residue");
    // A texel centre on the unit cube, placed on the wall in block-local space.
    const toBlock = boundary.halfSize * 2 * boundary.wallScale;
    const point = new THREE.Vector3();
    return {
      meshes: [film],
      update({ delta }) {
        const keep = Math.exp(-delta / config.seconds);
        for (let i = 0; i < strength.length; i++) {
          point
            .set(centres[i * 3]!, centres[i * 3 + 1]!, centres[i * 3 + 2]!)
            .multiplyScalar(toBlock);
          strength[i] = surface.wet(point) ? 255 : Math.floor(strength[i]! * keep);
        }
        texture.needsUpdate = true;
      },
    };
  },
};

containedResidues.register("fadingFilm", fadingFilm);
