import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { additiveLight } from "./additive-light";

export type LaserOutlineConfig = {
  frequency: number;
  drift: readonly [number, number, number];
  evolution: number;
  /** Radii as a fraction of the outlined object's size. */
  coreRadius: number;
  glowRadius: number;
};
export const defaultLaserOutline: LaserOutlineConfig = {
  frequency: 2.4,
  drift: [0.12, -0.07, 0.09],
  evolution: 0.22,
  coreRadius: 0.004,
  glowRadius: 0.025,
};

// Four-dimensional gradient noise with quintic interpolation. The fourth coordinate evolves
// independently of spatial drift, so the field changes shape rather than merely translating.
export const laserNoise = `
vec4 gradient4(vec4 cell) {
  vec4 h = vec4(dot(cell, vec4(127.1,311.7,74.7,269.5)),
                dot(cell, vec4(269.5,183.3,246.1,113.5)),
                dot(cell, vec4(113.5,271.9,124.6,199.3)),
                dot(cell, vec4(419.2,371.9,128.5,213.7)));
  vec4 g = fract(sin(h) * 43758.5453) * 2.0 - 1.0;
  return g * inversesqrt(max(dot(g,g), .001));
}
float gradientNoise4(vec4 point) {
  vec4 cell = floor(point), local = fract(point);
  vec4 fade = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
  float result = 0.0;
  for (int index = 0; index < 16; index++) {
    float n = float(index);
    vec4 corner = vec4(mod(n,2.0), mod(floor(n/2.0),2.0), mod(floor(n/4.0),2.0), floor(n/8.0));
    vec4 weight = mix(1.0-fade, fade, corner);
    result += dot(gradient4(cell+corner), local-corner) * weight.x*weight.y*weight.z*weight.w;
  }
  return result;
}
`;

/** One shared shader/geometry pair per outline; no simulation per edge or per clone. */
export function createLaserOutline(
  source: THREE.BufferGeometry,
  colour: number,
  size: number,
  options: Partial<LaserOutlineConfig> = {},
) {
  const config = { ...defaultLaserOutline, ...options };
  const edges = new THREE.EdgesGeometry(source);
  const positions = edges.getAttribute("position");
  const uniforms = {
    time: { value: 0 },
    tint: { value: new THREE.Color(colour) },
    opacity: { value: 1 },
    frequency: { value: config.frequency / size },
    drift: { value: new THREE.Vector3(...config.drift) },
    evolution: { value: config.evolution },
  };
  const object = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  function tubes(radius: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    for (let index = 0; index < positions.count; index += 2) {
      const start = new THREE.Vector3().fromBufferAttribute(positions, index);
      const end = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
      const direction = end.clone().sub(start);
      const tube = new THREE.CylinderGeometry(
        radius * size,
        radius * size,
        direction.length(),
        10,
        1,
        true,
      );
      tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
      tube.translate(...start.add(end).multiplyScalar(0.5).toArray());
      parts.push(tube);
    }
    const geometry = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    return geometry;
  }
  function material(strength: number) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      ...additiveLight,
      uniforms: { ...uniforms, strength: { value: strength } },
      vertexShader: `varying vec3 edgePosition; varying vec3 surfaceNormal; varying vec3 viewDirection;
        void main() { vec4 view = modelViewMatrix * vec4(position,1.0);
          edgePosition = position; surfaceNormal = normalMatrix * normal; viewDirection = -view.xyz;
          gl_Position = projectionMatrix * view; }`,
      fragmentShader: `uniform float time,frequency,evolution,opacity,strength; uniform vec3 drift,tint;
        varying vec3 edgePosition; varying vec3 surfaceNormal; varying vec3 viewDirection;
        ${laserNoise}
        void main() {
          vec4 point = vec4(edgePosition*frequency + drift*time, time*evolution);
          float smoke = .65*gradientNoise4(point) + .35*gradientNoise4(point*2.03 + vec4(13.7));
          float density = smoothstep(.25,.72, .5 + smoke*1.25);
          float radial = pow(max(0.0,dot(normalize(surfaceNormal),normalize(viewDirection))),1.7);
          float light = (.05 + density*1.5) * radial * strength * opacity;
          gl_FragColor = vec4(mix(tint,vec3(1.0),density*.4)*light,clamp(light,0.0,1.0));
        }`,
    });
  }
  const coreGeometry = tubes(config.coreRadius),
    glowGeometry = tubes(config.glowRadius);
  const core = material(1),
    glow = material(0.18);
  const coreMesh = new THREE.Mesh(coreGeometry, core),
    glowMesh = new THREE.Mesh(glowGeometry, glow);
  coreMesh.renderOrder = glowMesh.renderOrder = 12;
  // Opacity is presentation state owned by the caller (including release fades).
  coreMesh.onBeforeRender = glowMesh.onBeforeRender = () => {
    uniforms.opacity.value = core.opacity;
  };
  object.add(glowMesh, coreMesh);
  let disposed = false;
  return {
    object,
    material: core,
    update(seconds: number, reducedMotion = false) {
      if (!reducedMotion) uniforms.time.value = seconds;
      uniforms.opacity.value = core.opacity;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      edges.dispose();
      coreGeometry.dispose();
      glowGeometry.dispose();
      core.dispose();
      glow.dispose();
      object.removeFromParent();
      object.clear();
    },
  };
}
