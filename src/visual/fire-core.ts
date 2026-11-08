/**
 * The burning heart of a fire block: a raymarched, volumetric flame inside the frame.
 *
 * A box the size of the block is drawn (back faces, additive). For each pixel the shader
 * walks the view ray through the box, sampling a flame-shaped density that is torn up by
 * rising, animated noise, and adds up glowing colour from deep red at the edges to yellow
 * white in the hot core. The flame sits just below the block's centre, as if burning on
 * a grate. It is a fake (no lighting, no shadows) but reads as a fire seen through glass.
 */
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float time;
  uniform float halfSize;
  uniform vec3 cameraLocal;
  uniform float intensity;
  // World "up" in the block's own space: flames always rise, however the block is turned.
  uniform vec3 upLocal;
  varying vec3 vLocal;

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
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      sum += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return sum;
  }

  // Flame density at q (the block spans -1..1), and how hot it is there.
  vec2 flame(vec3 q) {
    // Work in a frame whose y is world up, so the flame sits just below the centre (on the
    // "down" side, wherever that is now) and always points upwards.
    vec3 up = normalize(upLocal);
    vec3 side = normalize(abs(up.x) < 0.9 ? cross(up, vec3(1, 0, 0)) : cross(up, vec3(0, 0, 1)));
    vec3 front = cross(side, up);
    q = vec3(dot(q, side), dot(q, up), dot(q, front));
    float base = -0.45; // just below the centre
    float height = q.y - base;
    if (height < -0.08) return vec2(0.0);
    // Sway, more towards the tip.
    q.x += 0.07 * sin(time * 2.7 + q.y * 3.0) * height;
    q.z += 0.06 * cos(time * 2.1 + q.y * 2.5) * height;
    float turbulence = fbm(q * 3.0 + vec3(0.0, -time * 1.8, 0.0));
    float radius = 0.6 * (1.0 - smoothstep(0.0, 1.35, height)) + 0.05;
    float distance = length(q.xz) + (turbulence - 0.5) * 0.45 * (0.3 + height);
    float density = smoothstep(radius, radius * 0.25, distance);
    density *= smoothstep(-0.08, 0.06, height) * (1.0 - smoothstep(0.7, 1.35, height));
    float heat = density * (1.0 - height * 0.55) * (0.75 + 0.5 * turbulence);
    return vec2(density, heat);
  }

  vec3 fireColour(float heat) {
    vec3 ember = vec3(0.55, 0.04, 0.0);
    vec3 orange = vec3(1.0, 0.42, 0.04);
    vec3 yellow = vec3(1.0, 0.86, 0.45);
    return heat < 0.5 ? mix(ember, orange, heat * 2.0) : mix(orange, yellow, (heat - 0.5) * 2.0);
  }

  void main() {
    vec3 origin = cameraLocal;
    vec3 direction = normalize(vLocal - origin);
    // Where the view ray enters and leaves the box.
    vec3 inverse = 1.0 / direction;
    vec3 t0 = (-vec3(halfSize) - origin) * inverse;
    vec3 t1 = (vec3(halfSize) - origin) * inverse;
    vec3 near = min(t0, t1);
    vec3 far = max(t0, t1);
    float enter = max(max(max(near.x, near.y), near.z), 0.0);
    float leave = min(min(far.x, far.y), far.z);
    const int steps = 40;
    float stepLength = (leave - enter) / float(steps);
    vec3 colour = vec3(0.0);
    for (int i = 0; i < steps; i++) {
      vec3 p = origin + direction * (enter + stepLength * (float(i) + 0.5));
      vec2 flameAt = flame(p / halfSize);
      colour += fireColour(clamp(flameAt.y, 0.0, 1.0)) * flameAt.x * stepLength / halfSize;
    }
    gl_FragColor = vec4(colour * intensity, 1.0);
  }
`;

/** The fire inside one fire block; add it as a child of the block's mesh. */
export function createFireCore(size: number): THREE.Mesh {
  const halfSize = (size / 2) * 0.96;
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      time: { value: 0 },
      halfSize: { value: halfSize },
      cameraLocal: { value: new THREE.Vector3() },
      intensity: { value: 3.2 },
      upLocal: { value: new THREE.Vector3(0, 1, 0) },
    },
    side: THREE.BackSide,
    // Listed with the solid objects (not "transparent"), so glass and crystal on the
    // table, which refract only solid objects, show it bent through them. Additive and
    // drawn last among them (renderOrder), so nothing behind paints over it.
    transparent: false,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(halfSize * 2, halfSize * 2, halfSize * 2),
    material,
  );
  core.renderOrder = 10;
  // Each frame: advance the flames and give the shader the camera in the block's own space.
  const start = performance.now();
  const turned = new THREE.Quaternion();
  core.onBeforeRender = (_renderer, _scene, camera) => {
    material.uniforms.time.value = (performance.now() - start) / 1000;
    core.updateMatrixWorld();
    material.uniforms.cameraLocal.value.setFromMatrixPosition(camera.matrixWorld);
    core.worldToLocal(material.uniforms.cameraLocal.value);
    core.getWorldQuaternion(turned);
    material.uniforms.upLocal.value.set(0, 1, 0).applyQuaternion(turned.invert());
  };
  return core;
}
